"""Memory tools: lets an agent keep short notes about one visitor between conversations.

Notes live in the platform API (services/api/src/memory.ts). The API decides whether an agent may
remember at all (memory switched on, never for children), so the worker can't store notes for an
agent that shouldn't have them.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import aiohttp

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Visitor:
    """Who the agent is talking to, as far as memory is concerned."""

    end_user: str
    """Pseudonymous reference chosen by the embedding site; never a name or an email."""
    memories: list[str] = field(default_factory=list)
    """Notes saved in earlier conversations, newest first."""


def parse_visitor(metadata: dict[str, Any] | None) -> Visitor | None:
    """Reads the visitor from the dispatch metadata. None means: no memory in this session."""
    if not isinstance(metadata, dict):
        return None
    end_user = metadata.get("endUser")
    if not isinstance(end_user, str) or not end_user.strip():
        return None
    notes = metadata.get("memories")
    clean = [n.strip() for n in notes if isinstance(n, str) and n.strip()] if isinstance(notes, list) else []
    return Visitor(end_user=end_user.strip(), memories=clean[:20])


async def _post(api_url: str, path: str, body: dict[str, Any]) -> Any | None:
    try:
        async with (
            aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=4)) as http,
            http.post(f"{api_url.rstrip('/')}{path}", json=body) as res,
        ):
            res.raise_for_status()
            return await res.json()
    except Exception as exc:  # noqa: BLE001 - network, timeout, refused: all mean "didn't work"
        log.warning("memory request %s failed: %s", path, exc)
        return None


async def remember(api_url: str, agent_id: str, end_user: str, fact: str) -> str:
    """Saves one note. Returns what the model should be told."""
    fact = " ".join(fact.split())[:300]
    if not fact:
        return "Nothing to remember."
    saved = await _post(api_url, "/memory", {"agentId": agent_id, "endUser": end_user, "text": fact})
    return (
        "Saved." if saved else "That couldn't be saved right now. Don't tell the user you will remember it."
    )


async def recall(api_url: str, agent_id: str, end_user: str, query: str) -> str:
    """Finds notes about the visitor. Returns what the model should be told."""
    found = await _post(
        api_url,
        "/memory/search",
        {"agentId": agent_id, "endUser": end_user, "query": query[:300], "limit": 6},
    )
    if found is None:
        return "Your notes are unavailable right now. Don't guess what you knew."
    notes = [m["text"] for m in found if isinstance(m, dict) and m.get("text")]
    if not notes:
        return "You have no notes about this person on that."
    return "Your notes about this person:\n- " + "\n- ".join(notes)
