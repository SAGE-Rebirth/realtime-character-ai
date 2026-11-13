"""Phase 1 acceptance eval: joins a real session like a browser does and measures what users feel.

    make eval                 # needs `make start` first
    make eval ARGS="--turns 5 --agent demo-tutor"

Measures, against the targets in docs/IMPLEMENTATION_GUIDE.md (Phase 1):
  - agent join time and greeting time
  - voice-to-voice: end of the user's spoken question -> first sound of the agent's reply (p50 <= 1.0 s)
  - typed message -> first sound of the reply
  - barge-in: user starts talking over the agent -> agent audio stops (< 200 ms after detection)

The "user" speaks with macOS text-to-speech (`say`), streamed in real time through a 20 ms queue so
the end of speech is timed accurately. Timestamps are taken when audio frames arrive here, which is
within a few ms of what a browser would play. Results are printed and saved under evals/results/.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import subprocess
import tempfile
import time
import urllib.request
import wave
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
from livekit import rtc

SR = 48_000
FRAME = SR // 100  # 10 ms
LOUD = 0.01  # RMS above this counts as the agent making sound
ROOT = Path(__file__).resolve().parent
API = os.environ.get("EVAL_API_URL", "http://localhost:8787")

QUESTIONS = [
    "What is the capital of France?",
    "How many legs does a spider have?",
    "What colour is the sky on a clear day?",
    "What is two plus three?",
    "Which ocean is the largest?",
]
LONG_REQUEST = "Please tell me a long story about a friendly dragon. Make it at least one minute long."
INTERRUPTION = "Sorry, stop there. Wait a moment."


def now() -> float:
    return time.monotonic()


def tts(text: str, workdir: Path) -> np.ndarray:
    """Speak `text` with macOS `say` and return 48 kHz mono int16 samples."""
    aiff, wav_path = workdir / "s.aiff", workdir / "s.wav"
    subprocess.run(["say", "-o", str(aiff), text], check=True)
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@48000", "-c", "1", str(aiff), str(wav_path)], check=True)
    with wave.open(str(wav_path)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)


class Ear:
    """Listens to the agent's audio and remembers when it was loud."""

    def __init__(self) -> None:
        self.loud: list[float] = []

    async def listen(self, track: rtc.Track) -> None:
        async for ev in rtc.AudioStream(track, sample_rate=SR, num_channels=1):
            a = np.frombuffer(ev.frame.data, dtype=np.int16).astype(np.float32) / 32768
            if a.size and float(np.sqrt((a * a).mean())) > LOUD:
                self.loud.append(now())

    async def first_sound_after(self, t: float, timeout: float = 15) -> float | None:
        end = now() + timeout
        while now() < end:
            hits = [x for x in self.loud[-500:] if x > t]
            if hits:
                return hits[0]
            await asyncio.sleep(0.005)
        return None

    async def silence_after(self, t: float, quiet: float, timeout: float = 90) -> float | None:
        """Time of the last loud frame after `t`, once the agent has been quiet for `quiet` seconds."""
        end = now() + timeout
        while now() < end:
            last = max([x for x in self.loud[-500:] if x > t], default=t)
            if now() - last >= quiet:
                return last
            await asyncio.sleep(0.01)
        return None


class Mouth:
    """Publishes a microphone track: silence by default, speech on request, paced in real time."""

    def __init__(self) -> None:
        self.src = rtc.AudioSource(SR, 1, queue_size_ms=20)
        self._speech: np.ndarray | None = None
        self._pos = 0
        self._done: asyncio.Future[float] | None = None
        self._task: asyncio.Task[None] | None = None
        self.started_at = 0.0

    async def publish(self, room: rtc.Room) -> None:
        track = rtc.LocalAudioTrack.create_audio_track("mic", self.src)
        opts = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        await room.local_participant.publish_track(track, opts)
        self._task = asyncio.create_task(self._pump())

    async def _pump(self) -> None:
        silence = np.zeros(FRAME, dtype=np.int16)
        while True:
            if self._speech is not None:
                if self._pos == 0:
                    self.started_at = now()
                chunk = self._speech[self._pos : self._pos + FRAME]
                self._pos += FRAME
                if len(chunk) < FRAME:
                    chunk = np.pad(chunk, (0, FRAME - len(chunk)))
                if self._pos >= len(self._speech):
                    self._speech = None
                    if self._done and not self._done.done():
                        self._done.set_result(now())
            else:
                chunk = silence
            await self.src.capture_frame(rtc.AudioFrame(chunk.tobytes(), SR, 1, FRAME))

    async def say(self, pcm: np.ndarray) -> tuple[float, float]:
        """Speak; returns (start, end) times. With a 20 ms queue, `end` is within ~20 ms of the real end."""
        self._done = asyncio.get_running_loop().create_future()
        self._pos = 0
        self._speech = pcm
        await asyncio.sleep(0)
        end = await self._done
        return self.started_at, end + 0.02

    async def close(self) -> None:
        if self._task:
            self._task.cancel()


@dataclass
class Results:
    agent: str
    join_s: float | None = None
    greeting_s: float | None = None
    voice_to_voice_s: list[float] = field(default_factory=list)
    text_reply_s: float | None = None
    barge_in_flush_s: float | None = None
    barge_in_stop_s: float | None = None
    missed_turns: int = 0
    transcript: list[str] = field(default_factory=list)


def create_session(agent: str) -> dict[str, str]:
    req = urllib.request.Request(
        f"{API}/sessions",
        data=json.dumps({"agentId": agent}).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        return json.loads(urllib.request.urlopen(req, timeout=5).read())
    except OSError as e:
        raise SystemExit(f"Can't reach the API at {API} ({e}). Start everything first: make start") from None


async def run(agent: str, turns: int, workdir: Path) -> Results:
    res = Results(agent=agent)
    print("Preparing speech…")
    questions = [tts(q, workdir) for q in QUESTIONS[:turns]]
    long_req, interrupt = tts(LONG_REQUEST, workdir), tts(INTERRUPTION, workdir)

    s = create_session(agent)
    room, ear, mouth = rtc.Room(), Ear(), Mouth()
    joined = asyncio.get_running_loop().create_future()
    flushes: list[float] = []

    def on_track(track: rtc.Track, _pub: object, p: rtc.RemoteParticipant) -> None:
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            asyncio.ensure_future(ear.listen(track))

    def on_participant(p: rtc.RemoteParticipant) -> None:
        if p.kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT and not joined.done():
            joined.set_result(now())

    def on_data(d: rtc.DataPacket) -> None:
        try:
            ev = json.loads(d.data)
        except ValueError:
            return
        if ev.get("type") == "agent.flush":
            flushes.append(now())
        elif ev.get("type") == "transcript" and ev.get("final"):
            res.transcript.append(f"{ev['role']}: {ev['text']}")

    room.on("track_subscribed", on_track)
    room.on("participant_connected", on_participant)
    room.on("data_received", on_data)

    t0 = now()
    await room.connect(s["livekitUrl"], s["token"])
    for p in room.remote_participants.values():
        on_participant(p)
    await mouth.publish(room)
    try:
        res.join_s = round(await asyncio.wait_for(joined, 15) - t0, 2)
        print(f"  agent joined after {res.join_s:.2f} s")
    except TimeoutError:
        print("  ✗ no agent joined within 15 s. Is the worker running? (make status)")
        await room.disconnect()
        return res

    greet = await ear.first_sound_after(t0, timeout=20)
    if greet:
        res.greeting_s = round(greet - t0, 2)
        print(f"  greeting started after {res.greeting_s:.2f} s")
        await ear.silence_after(greet, quiet=1.5)

    for i, pcm in enumerate(questions, 1):
        _, end = await mouth.say(pcm)
        reply = await ear.first_sound_after(end)
        if reply is None:
            res.missed_turns += 1
            print(f"  voice turn {i}: ✗ no reply")
            continue
        v2v = round(reply - end, 3)
        res.voice_to_voice_s.append(v2v)
        print(f"  voice turn {i}: reply after {v2v:.2f} s")
        await ear.silence_after(reply, quiet=1.5)

    sent = now()
    await room.local_participant.send_text("Name one planet in our solar system.", topic="lk.chat")
    reply = await ear.first_sound_after(sent)
    if reply:
        res.text_reply_s = round(reply - sent, 3)
        print(f"  typed message: reply after {res.text_reply_s:.2f} s")
        await ear.silence_after(reply, quiet=1.5)
    else:
        res.missed_turns += 1
        print("  typed message: ✗ no reply")

    _, end = await mouth.say(long_req)
    story = await ear.first_sound_after(end)
    if story:
        await asyncio.sleep(3)  # let the story get going
        flushes.clear()
        task = asyncio.create_task(mouth.say(interrupt))
        await asyncio.sleep(0.05)
        started = mouth.started_at
        stopped = await ear.silence_after(started, quiet=0.6, timeout=10)
        await task
        if stopped is not None:
            res.barge_in_stop_s = round(stopped - started, 3)
        if flushes:
            res.barge_in_flush_s = round(flushes[0] - started, 3)
        print(f"  barge-in: agent audio stopped {res.barge_in_stop_s} s after the user started talking")
        if res.barge_in_flush_s is not None:
            print(f"            flush event (detection) after {res.barge_in_flush_s} s")
            if res.barge_in_stop_s is not None:
                print(f"            stop after detection: {res.barge_in_stop_s - res.barge_in_flush_s:+.3f} s")
        await asyncio.sleep(3)
    else:
        print("  barge-in: ✗ the agent never started the story")

    await mouth.close()
    await room.disconnect()
    return res


def report(res: Results) -> bool:
    v = res.voice_to_voice_s
    p50 = statistics.median(v) if v else None
    stop_after_detect = (
        res.barge_in_stop_s - res.barge_in_flush_s
        if res.barge_in_stop_s is not None and res.barge_in_flush_s is not None
        else None
    )
    rows = [
        ("Voice-to-voice p50", p50, 1.0, "s"),
        ("Voice-to-voice worst", max(v) if v else None, None, "s"),
        ("Typed message reply", res.text_reply_s, None, "s"),
        ("Barge-in: talk -> silence", res.barge_in_stop_s, None, "s"),
        ("Barge-in: detection -> silence", stop_after_detect, 0.2, "s"),
        ("Missed turns", res.missed_turns, 0, ""),
    ]
    print("\nResult                           Value     Target")
    ok = True
    for name, val, target, unit in rows:
        if val is None:
            mark, shown = "✗", "n/a"
            ok = ok and target is None
        else:
            passed = target is None or val <= target
            ok = ok and passed
            mark = "✓" if passed else "✗"
            shown = f"{val:.2f} {unit}" if isinstance(val, float) else f"{val} {unit}"
        tgt = f"<= {target} {unit}" if target is not None else ""
        print(f"  {mark} {name:<30} {shown:<9} {tgt}")
    return ok


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--agent", default="demo-ava")
    ap.add_argument("--turns", type=int, default=3, choices=range(1, len(QUESTIONS) + 1))
    args = ap.parse_args()
    with tempfile.TemporaryDirectory() as d:
        res = asyncio.run(run(args.agent, args.turns, Path(d)))
    ok = report(res)
    out = ROOT / "results" / time.strftime("latency-%Y%m%d-%H%M%S.json")
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(asdict(res), indent=2))
    print(f"\nSaved {out.relative_to(ROOT.parent)}")
    if res.transcript:
        print("\nTranscript:\n  " + "\n  ".join(res.transcript))
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
