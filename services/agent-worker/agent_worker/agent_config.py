"""Loads the AgentConfig the API attached to the dispatch, with a safe fallback."""

from __future__ import annotations

import json
import logging

from pydantic import ValidationError

from .protocol_models import AgentConfig, ProceduralAvatarRef

log = logging.getLogger(__name__)

DEFAULT_AGENT = AgentConfig(
    id="demo-ava",
    name="Ava",
    instructions=(
        "You are Ava, a warm and curious guide. Keep answers short and conversational, "
        "usually one to three sentences, because you are speaking out loud."
    ),
    greeting="Hi! I'm Ava. What would you like to talk about?",
    avatar=ProceduralAvatarRef(kind="procedural"),
)


def parse_agent_config(metadata: str | None) -> AgentConfig:
    """Parse dispatch metadata. Anything missing or invalid falls back to the demo agent."""
    if not metadata:
        return DEFAULT_AGENT
    try:
        data = json.loads(metadata)
        return AgentConfig.model_validate(data.get("agent", data))
    except (ValueError, ValidationError) as exc:
        log.warning("invalid agent metadata, using default agent: %s", exc)
        return DEFAULT_AGENT
