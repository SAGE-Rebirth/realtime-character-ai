"""Environment settings for the worker. Reads the repo-root .env in development."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(_ROOT / ".env")

AGENT_NAME = "meta-avatar"


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str
    gemini_model: str
    gemini_api_version: str
    default_voice: str
    livekit_url: str
    livekit_api_key: str
    livekit_api_secret: str


def load_settings() -> Settings:
    return Settings(
        # LIVE_MODEL_API_KEY wins over GEMINI_API_KEY, so a dedicated live key can sit in .env while an
        # older GEMINI_API_KEY is still exported in the shell.
        gemini_api_key=(
            os.environ.get("LIVE_MODEL_API_KEY") or os.environ.get("GEMINI_API_KEY") or ""
        ).strip(),
        gemini_model=os.environ.get("GEMINI_LIVE_MODEL", "gemini-3.1-flash-live-preview"),
        # Live models answer on v1alpha for this key type; v1beta returns 404.
        gemini_api_version=os.environ.get("GEMINI_API_VERSION", "v1alpha"),
        default_voice=os.environ.get("GEMINI_VOICE", "Kore"),
        livekit_url=os.environ.get("LIVEKIT_URL", "ws://localhost:7880"),
        livekit_api_key=os.environ.get("LIVEKIT_API_KEY", "devkey"),
        livekit_api_secret=os.environ.get("LIVEKIT_API_SECRET", "secret"),
    )


_LOOPBACK = {"localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"}


def livekit_proxy(livekit_url: str, env: dict[str, str] | None = None) -> str | None:
    """Proxy for the worker's LiveKit connection.

    LiveKit Agents uses HTTPS_PROXY/HTTP_PROXY for every connection, including localhost. Local
    tools (e.g. package-security proxies injected by pnpm/uv wrappers) set those variables but can't
    forward WebSockets, which shows up as "502 Invalid response status". Never proxy loopback
    addresses or hosts listed in NO_PROXY.
    """
    from urllib.parse import urlparse

    env = dict(os.environ) if env is None else env
    host = (urlparse(livekit_url).hostname or "").lower()
    if host in _LOOPBACK:
        return None
    no_proxy = [
        h.strip().lower().lstrip(".") for h in (env.get("NO_PROXY") or env.get("no_proxy") or "").split(",")
    ]
    if any(h and (h == "*" or host == h or host.endswith("." + h)) for h in no_proxy):
        return None
    return env.get("HTTPS_PROXY") or env.get("https_proxy") or env.get("HTTP_PROXY") or env.get("http_proxy")
