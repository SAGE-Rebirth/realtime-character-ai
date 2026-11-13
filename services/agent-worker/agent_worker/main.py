"""MetaAvatar agent worker.

One job per LiveKit room: loads the AgentConfig from the dispatch metadata, opens a Gemini Live
session, and publishes avatar events (state, emotion, gesture, flush, transcripts) on the data
channel so the browser runtime can animate the avatar.

Run locally:  uv run python -m agent_worker.main dev
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Coroutine
from typing import Any, Literal

from google.genai import types as genai_types
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    AgentStateChangedEvent,
    CloseEvent,
    ConversationItemAddedEvent,
    JobContext,
    SpeechCreatedEvent,
    UserInputTranscribedEvent,
    cli,
    function_tool,
)
from livekit.agents.voice import SpeechHandle
from livekit.plugins import google

from .agent_config import parse_agent_config
from .events import EventPublisher
from .gestures import plan_cues
from .knowledge import format_passages, search_documents, unique_sources
from .protocol_models import AgentConfig, Emotion, Gesture
from .safety import build_instructions
from .settings import AGENT_NAME, livekit_proxy, load_settings

log = logging.getLogger("agent_worker")

EmotionName = Literal["neutral", "happy", "sad", "angry", "surprised", "relaxed", "thinking"]
GestureName = Literal["none", "wave", "nod", "shake_head", "shrug", "explain", "point", "celebrate", "think"]


# The model calling `express` before each answer costs a full extra round trip (~1 s per turn), so it
# is opt-in. By default gestures and emotions come from the reply text (gestures.plan_cues).
EXPRESS_TOOL_ENABLED = os.environ.get("AVATAR_EXPRESS_TOOL") == "1"


class AvatarAgent(Agent):
    def __init__(self, config: AgentConfig, publisher: EventPublisher) -> None:
        tools: list[Any] = [function_tool(self._express, name="express")] if EXPRESS_TOOL_ENABLED else []
        if config.knowledge:
            tools.append(function_tool(self._search_knowledge_base, name="search_knowledge_base"))
        if config.groundingSearch:
            tools.append(google.tools.GoogleSearch())
        super().__init__(instructions=build_instructions(config, EXPRESS_TOOL_ENABLED), tools=tools)
        self._config = config
        self._pub = publisher

    async def _express(self, emotion: EmotionName, gesture: GestureName = "none") -> None:
        """Set the avatar's facial emotion and optionally play a body gesture. Call silently.

        Args:
            emotion: Facial emotion to show.
            gesture: Body gesture to play, or "none".
        """
        await self._pub.emotion(Emotion(emotion))
        if gesture != "none":
            await self._pub.gesture(Gesture(gesture))

    async def _search_knowledge_base(self, query: str) -> str:
        """Search the organisation's documents and return the most relevant passages.

        Args:
            query: A short search phrase describing what to look up, in the user's language.
        """
        passages = await search_documents(
            load_settings().platform_api_url, list(self._config.knowledge or []), query
        )
        log.info("knowledge search %r -> %s passages", query, "failed" if passages is None else len(passages))
        if passages:
            await self._pub.sources(unique_sources(passages))
        return format_passages(passages)


def build_model(config: AgentConfig) -> google.realtime.RealtimeModel:
    s = load_settings()
    if not s.gemini_api_key:
        raise RuntimeError("LIVE_MODEL_API_KEY (or GEMINI_API_KEY) is not set (see .env.example)")
    return google.realtime.RealtimeModel(
        model=s.gemini_model,
        api_key=s.gemini_api_key,
        api_version=s.gemini_api_version,
        voice=config.voice or s.default_voice,
        temperature=0.8,
        # Long conversations: Gemini trims old context instead of hitting the session limit, and the
        # plugin reconnects with the resumption handle when the server recycles the connection.
        # Decide the user has finished after ~500 ms of silence instead of Gemini's slower default.
        realtime_input_config=genai_types.RealtimeInputConfig(
            automatic_activity_detection=genai_types.AutomaticActivityDetection(
                end_of_speech_sensitivity=genai_types.EndSensitivity.END_SENSITIVITY_HIGH,
                silence_duration_ms=int(os.environ.get("TURN_SILENCE_MS", "500")),
                prefix_padding_ms=100,
            ),
        ),
        context_window_compression=genai_types.ContextWindowCompressionConfig(
            sliding_window=genai_types.SlidingWindow(),
        ),
        session_resumption=genai_types.SessionResumptionConfig(),
        # Thinking before speaking adds latency to every turn; a conversation rarely needs it.
        # GEMINI_THINKING_LEVEL: minimal (default) | low | medium | high.
        thinking_config=genai_types.ThinkingConfig(
            thinking_level=genai_types.ThinkingLevel(
                os.environ.get("GEMINI_THINKING_LEVEL", "minimal").upper()
            ),
        ),
        # Default (blocking) tool behaviour on purpose: with NON_BLOCKING + SILENT the model treated an
        # `express` call as its whole turn and never spoke. `express` returns instantly, so the pause is
        # negligible.
    )


def user_message_for(error: object) -> str:
    """Short, non-technical explanation for the viewer; details stay in the worker log."""
    text = str(getattr(error, "error", error)).lower()
    if "credit" in text or "quota" in text or "429" in text or "resource_exhausted" in text:
        return "The AI service is out of quota right now. Please try again later."
    if "404" in text or "not found" in text or "permission" in text or "api key" in text:
        return "The AI service rejected this app's key or model. Check GEMINI_API_KEY and GEMINI_LIVE_MODEL."
    return "The AI service disconnected. Please start the conversation again."


server = AgentServer(http_proxy=livekit_proxy(load_settings().livekit_url))


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    config = parse_agent_config(ctx.job.metadata)
    log.info(
        "starting session room=%s agent=%s voice=%s language=%s audience=%s search=%s documents=%d",
        ctx.room.name,
        config.id,
        config.voice,
        config.language,
        config.audience,
        config.groundingSearch,
        len(config.knowledge or []),
    )

    await ctx.connect()
    pub = EventPublisher(ctx.room)
    session: AgentSession = AgentSession(llm=build_model(config))

    # asyncio keeps only weak references to tasks, so hold them until they finish.
    background: set[asyncio.Future[Any]] = set()

    def fire(coro: Coroutine[Any, Any, Any]) -> None:
        task = asyncio.ensure_future(coro)
        background.add(task)
        task.add_done_callback(background.discard)

    speeches: list[SpeechHandle] = []

    @session.on("speech_created")
    def _on_speech(ev: SpeechCreatedEvent) -> None:
        speeches[:] = [h for h in speeches if not h.done()] + [ev.speech_handle]

    @session.on("agent_state_changed")
    def _on_agent_state(ev: AgentStateChangedEvent) -> None:
        # Barge-in: the agent stopped because the user talked over it, so the client must drop
        # queued audio and close the avatar's mouth now. (With Gemini's server-side turn detection,
        # LiveKit's user_state is not reliable for this; the speech handle's interrupted flag is.)
        if ev.old_state == "speaking" and any(h.interrupted for h in speeches):
            log.info("barge-in: agent speech interrupted")
            fire(pub.flush())
            speeches.clear()
        fire(pub.state(ev.new_state))

    @session.on("user_input_transcribed")
    def _on_user_text(ev: UserInputTranscribedEvent) -> None:
        if ev.is_final:
            fire(pub.transcript("user", ev.transcript, True))

    @session.on("conversation_item_added")
    def _on_item(ev: ConversationItemAddedEvent) -> None:
        item = ev.item
        if getattr(item, "role", None) != "assistant":
            return
        text = getattr(item, "text_content", None) or ""
        if not text:
            return
        fire(pub.transcript("agent", text, True))
        for cue in plan_cues(text):
            if cue.emotion is not None:
                fire(pub.emotion(cue.emotion))
            if cue.gesture is not None:
                fire(pub.gesture(cue.gesture))

    @session.on("close")
    def _on_close(ev: CloseEvent) -> None:
        if ev.error is None:
            return
        log.error("session closed with error: %s", ev.error)
        # Tell the viewer instead of leaving them talking to a silent avatar.
        fire(pub.warning("ending", user_message_for(ev.error)))

    await session.start(agent=AvatarAgent(config, pub), room=ctx.room)

    if config.greeting:
        session.generate_reply(instructions=f"Greet the user warmly. Say something like: {config.greeting}")


def main() -> None:
    if os.environ.get("SKIP_GEMINI_PREFLIGHT") != "1":
        from .preflight import check_gemini

        # Keep running even if the check fails, so the viewer still gets a clear warning.
        check_gemini(load_settings())
    cli.run_app(server)


if __name__ == "__main__":
    main()
