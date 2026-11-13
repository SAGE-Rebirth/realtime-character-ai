"""Web-search citations: reads the pages Gemini's Google Search grounding drew on.

The LiveKit Google plugin doesn't pass grounding metadata on, so we wrap the session's handler for
server content. That handler is a private method: if a plugin update renames it, citations are
skipped with one warning and conversations carry on unaffected.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

log = logging.getLogger(__name__)

WebSource = tuple[str, str]  # (title, url)


def web_sources(server_content: Any, limit: int = 4) -> list[WebSource]:
    """Pages cited in one server message, without duplicates, in the order Gemini listed them."""
    meta = getattr(server_content, "grounding_metadata", None)
    found: dict[str, str] = {}
    for chunk in getattr(meta, "grounding_chunks", None) or []:
        web = getattr(chunk, "web", None)
        url = getattr(web, "uri", None)
        if not url:
            continue
        title = (getattr(web, "title", None) or getattr(web, "domain", None) or "Web page").strip()
        # Several chunks often come from the same site; show each site once.
        if title not in found.values():
            found.setdefault(url, title)
    return [(title, url) for url, title in list(found.items())[:limit]]


def watch_grounding(model: Any, on_sources: Callable[[list[WebSource]], None]) -> bool:
    """Calls `on_sources` whenever a session of `model` receives search citations."""
    make_session = getattr(model, "session", None)
    if make_session is None:
        log.warning("web citations unavailable: the realtime model has no session()")
        return False

    def session(*args: Any, **kwargs: Any) -> Any:
        sess = make_session(*args, **kwargs)
        handle = getattr(sess, "_handle_server_content", None)
        if handle is None:
            log.warning("web citations unavailable: the Google plugin changed its internals")
            return sess

        def handle_and_cite(server_content: Any) -> None:
            try:
                found = web_sources(server_content)
                if found:
                    on_sources(found)
            except Exception:  # a citation must never break the conversation
                log.exception("reading web citations failed")
            handle(server_content)

        sess._handle_server_content = handle_and_cite
        return sess

    model.session = session
    return True
