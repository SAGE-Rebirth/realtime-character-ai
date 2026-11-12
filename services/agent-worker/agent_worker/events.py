"""Publishes protocol events to the room's data channel (topic avatar.v1)."""

from __future__ import annotations

import logging
import time

from livekit import rtc

from .protocol_models import (
    AgentState,
    AgentStateEvent,
    Code,
    Emotion,
    EmotionEvent,
    FlushEvent,
    Gesture,
    GestureEvent,
    Role,
    SessionWarningEvent,
    TranscriptEvent,
)

TOPIC = "avatar.v1"
log = logging.getLogger(__name__)


def _now_ms() -> float:
    return time.time() * 1000


class EventPublisher:
    def __init__(self, room: rtc.Room) -> None:
        self._room = room

    async def _send(self, event: object) -> None:
        payload = event.model_dump_json(exclude_none=True)  # type: ignore[attr-defined]
        try:
            await self._room.local_participant.publish_data(payload, reliable=True, topic=TOPIC)
        except Exception:  # never let a cosmetic event break the conversation
            log.exception("failed to publish %s", type(event).__name__)

    async def state(self, state: str) -> None:
        try:
            s = AgentState(state)
        except ValueError:
            return
        await self._send(AgentStateEvent(v=1, ts=_now_ms(), type="agent.state", state=s))

    async def emotion(self, emotion: Emotion, intensity: float = 0.7) -> None:
        await self._send(EmotionEvent(v=1, ts=_now_ms(), type="agent.emotion", emotion=emotion, intensity=intensity))

    async def gesture(self, gesture: Gesture, intensity: float = 0.7) -> None:
        await self._send(GestureEvent(v=1, ts=_now_ms(), type="agent.gesture", gesture=gesture, intensity=intensity))

    async def flush(self) -> None:
        await self._send(FlushEvent(v=1, ts=_now_ms(), type="agent.flush"))

    async def transcript(self, role: str, text: str, final: bool) -> None:
        await self._send(TranscriptEvent(v=1, ts=_now_ms(), type="transcript", role=Role(role), text=text, final=final))

    async def warning(self, code: str, message: str) -> None:
        await self._send(
            SessionWarningEvent(v=1, ts=_now_ms(), type="session.warning", code=Code(code), message=message)
        )
