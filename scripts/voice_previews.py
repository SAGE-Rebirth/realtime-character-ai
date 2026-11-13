"""Generates a short preview clip for every Gemini voice into apps/studio/public/voices/<Name>.m4a.

    make voices           # skips voices that already have a clip
    make voices ARGS=--force

Uses Gemini text-to-speech once per voice (free tier is fine) and macOS `afconvert` to compress to AAC.
The clips are committed, so Studio plays them without any API calls.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from google import genai
from google.genai import types

from agent_worker.settings import load_settings

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps" / "studio" / "public" / "voices"
PROTOCOL = ROOT / "packages" / "protocol" / "src" / "index.ts"
MODEL = "gemini-3.8-flash-lite-tts"


def voices() -> list[str]:
    """Reads the voice names from the protocol package so the list has one source of truth."""
    block = PROTOCOL.read_text().split("export const VOICES", 1)[1].split("];", 1)[0]
    return re.findall(r'name: "([A-Za-z]+)"', block)


def main() -> None:
    sys.stdout.reconfigure(line_buffering=True)  # type: ignore[union-attr]
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="regenerate clips that already exist")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    client = genai.Client(api_key=load_settings().gemini_api_key, http_options=types.HttpOptions(api_version="v1beta"))
    names = voices()
    todo = [n for n in names if args.force or not (OUT / f"{n}.m4a").exists()]
    print(f"{len(names)} voices, {len(todo)} to generate")
    failed = []
    for i, name in enumerate(todo, 1):
        line = f"Hi, I'm {name}. This is how I sound when we talk."
        for attempt in range(3):
            try:
                r = client.models.generate_content(
                    model=MODEL,
                    contents=f"Say in a natural, friendly way: {line}",
                    config=types.GenerateContentConfig(
                        response_modalities=["AUDIO"],
                        speech_config=types.SpeechConfig(
                            voice_config=types.VoiceConfig(
                                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=name)
                            )
                        ),
                    ),
                )
                data = r.candidates[0].content.parts[0].inline_data.data  # type: ignore[index,union-attr]
                with tempfile.TemporaryDirectory() as d:
                    wav = Path(d) / "v.wav"
                    wav.write_bytes(data)  # type: ignore[arg-type]
                    subprocess.run(
                        ["afconvert", "-f", "m4af", "-d", "aac", "-b", "48000", str(wav), str(OUT / f"{name}.m4a")],
                        check=True,
                    )
                print(f"  [{i}/{len(todo)}] {name}")
                break
            except Exception as e:  # noqa: BLE001 - report and retry any API/conversion failure
                wait = 20 * (attempt + 1)
                print(f"  {name}: {str(e)[:120]} (retrying in {wait}s)")
                time.sleep(wait)
        else:
            failed.append(name)
        time.sleep(3)  # stay well under free-tier rate limits
    if failed:
        print("Failed:", ", ".join(failed))
        sys.exit(1)


if __name__ == "__main__":
    main()
