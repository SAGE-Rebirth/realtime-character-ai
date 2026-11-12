"""Startup check: fail loudly in the worker terminal if Gemini can't be used, instead of failing
silently later inside every conversation."""

from __future__ import annotations

import logging

from google import genai
from google.genai import types

from .settings import Settings

log = logging.getLogger("agent_worker.preflight")
# Own handler so the banner prints before LiveKit configures logging, without duplicating lines later.
if not log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(levelname)s %(message)s"))
    log.addHandler(_h)
    log.setLevel(logging.INFO)
    log.propagate = False

BANNER = "=" * 78


def check_gemini(s: Settings) -> bool:
    """Makes one tiny request (a few tokens). Returns True when the key works."""
    if not s.gemini_api_key:
        _fail("No Gemini key found.", "Set LIVE_MODEL_API_KEY (or GEMINI_API_KEY) in .env or your shell.")
        return False
    try:
        client = genai.Client(api_key=s.gemini_api_key)
        client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents="ping",
            config=types.GenerateContentConfig(max_output_tokens=1),
        )
    except Exception as exc:  # noqa: BLE001 - any failure is reported with its message
        msg = str(exc)
        hint = "Check the key and the model name in .env."
        if "credit" in msg.lower() or "billing" in msg.lower():
            hint = (
                "This key's Google project uses prepaid billing and has no credit left.\n"
                "Fix: top up at https://ai.studio/projects, or create a key in a project with no\n"
                "billing attached to use the free tier, then restart the worker."
            )
        elif "quota" in msg.lower() or "429" in msg:
            hint = "Free-tier quota used up; it refreshes daily. Check limits in AI Studio."
        _fail(f"Gemini rejected the API key: {msg[:300]}", hint)
        return False
    log.info("Gemini key OK (live model: %s, API %s)", s.gemini_model, s.gemini_api_version)
    return True


def _fail(problem: str, hint: str) -> None:
    log.error("\n%s\nGEMINI CHECK FAILED: conversations will not work.\n%s\n%s\n%s", BANNER, problem, hint, BANNER)
