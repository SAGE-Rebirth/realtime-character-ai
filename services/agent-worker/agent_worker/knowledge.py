"""Knowledge-base search for the agent: asks the platform API for passages from the agent's documents.

The API owns the documents and the index (services/api/src/knowledge); the worker only searches, so
there is one place that decides which documents an agent may read.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import aiohttp

log = logging.getLogger(__name__)

NO_RESULTS = (
    "No matching passage was found in the documents. Tell the user you don't have that information "
    "in your documents; do not guess."
)
UNAVAILABLE = (
    "The document search is unavailable right now. Tell the user you can't check your documents at "
    "the moment; do not guess."
)


@dataclass(frozen=True)
class Passage:
    document_id: str
    title: str
    text: str


async def search_documents(
    api_url: str, document_ids: list[str], query: str, limit: int = 4, timeout_s: float = 4.0
) -> list[Passage] | None:
    """Returns matching passages, or None when the search itself failed."""
    try:
        async with (
            aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout_s)) as http,
            http.post(
                f"{api_url.rstrip('/')}/knowledge/search",
                json={"query": query[:1000], "documentIds": document_ids, "limit": limit},
            ) as res,
        ):
            res.raise_for_status()
            body = await res.json()
    except Exception as exc:  # noqa: BLE001 - network, timeout, bad JSON: all mean "unavailable"
        log.warning("knowledge search failed: %s", exc)
        return None
    return [
        Passage(document_id=p["documentId"], title=p["title"], text=p["text"])
        for p in body.get("passages", [])
        if isinstance(p, dict) and p.get("text")
    ]


def format_passages(passages: list[Passage] | None) -> str:
    """What the model reads back from the tool: numbered passages, each with its document title."""
    if passages is None:
        return UNAVAILABLE
    if not passages:
        return NO_RESULTS
    lines = [f'[{i}] From "{p.title}": {p.text}' for i, p in enumerate(passages, 1)]
    return (
        "Passages from the documents, most relevant first. Answer only from these, and name the "
        "document you used in passing.\n\n" + "\n\n".join(lines)
    )


def unique_sources(passages: list[Passage]) -> list[tuple[str, str]]:
    """(document id, title) once per document, in ranking order, for the on-screen source list."""
    seen: dict[str, str] = {}
    for p in passages:
        seen.setdefault(p.document_id, p.title)
    return list(seen.items())
