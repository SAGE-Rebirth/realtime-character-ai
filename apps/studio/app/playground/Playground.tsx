"use client";

import type {
  AvatarRuntime,
  Caption,
  Framing,
  PlaybackMode,
  RuntimeMetrics,
} from "@metaavatar/avatar-runtime";
import type { CreateSessionResponse, Emotion, Gesture } from "@metaavatar/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./playground.module.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

interface AgentSummary {
  id: string;
  name: string;
  voice: string;
}

const GESTURES: Gesture[] = ["wave", "nod", "shake_head", "shrug", "explain", "point", "celebrate", "think"];
const EMOTIONS: Emotion[] = ["neutral", "happy", "sad", "angry", "surprised", "relaxed", "thinking"];

type Mode = "idle" | "starting" | "live" | "mirror";

function describeError(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is blocked. Allow the microphone for this site. (The preview pane inside Claude can't use the mic: open http://localhost:3100/playground in Chrome or Safari.)";
  }
  if (name === "NotFoundError") return "No microphone found. Plug one in or check your sound settings.";
  return e instanceof Error ? e.message : String(e);
}

export default function Playground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rtRef = useRef<AvatarRuntime | null>(null);
  const [ready, setReady] = useState(false);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentId, setAgentId] = useState("demo-ava");
  const [mode, setMode] = useState<Mode>("idle");
  const [micOn, setMicOn] = useState(true);
  const [framing, setFraming] = useState<Framing>("upper");
  const [playback, setPlayback] = useState<PlaybackMode>("element");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [metrics, setMetrics] = useState<RuntimeMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avatarLabel, setAvatarLabel] = useState("Built-in character");

  // Create the runtime (client-only: three.js and WebAudio need the browser).
  useEffect(() => {
    let disposed = false;
    let rt: AvatarRuntime | null = null;
    (async () => {
      const { AvatarRuntime } = await import("@metaavatar/avatar-runtime");
      if (disposed || !canvasRef.current) return;
      rt = await AvatarRuntime.create({
        canvas: canvasRef.current,
        avatar: { kind: "procedural", style: "default" },
        framing,
        playbackMode: playback,
      });
      if (disposed) {
        void rt.dispose();
        return;
      }
      rtRef.current = rt;
      if (process.env.NODE_ENV !== "production") (window as unknown as { __avatar?: AvatarRuntime }).__avatar = rt;
      rt.on("caption", (c) =>
        setCaptions((prev) => {
          const i = prev.findIndex((p) => p.id === c.id);
          const next = i >= 0 ? prev.map((p, j) => (j === i ? c : p)) : [...prev, c];
          return next.slice(-30);
        }),
      );
      rt.on("error", (e) => setError(e.message));
      rt.on("warning", (w) => setError(w.message));
      setReady(true);
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      disposed = true;
      rtRef.current = null;
      void rt?.dispose();
    };
    // Playback mode is fixed per runtime instance; changing it recreates the runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback]);

  useEffect(() => {
    fetch(`${API}/agents`)
      .then((r) => r.json())
      .then((list: AgentSummary[]) => setAgents(list))
      .catch(() => setError(`Can't reach the API at ${API}. Is it running? (pnpm dev:api)`));
  }, []);

  useEffect(() => {
    const id = setInterval(() => rtRef.current && setMetrics(rtRef.current.getMetrics()), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    rtRef.current?.setFraming(framing);
  }, [framing]);

  const start = useCallback(async () => {
    const rt = rtRef.current;
    if (!rt) return;
    setError(null);
    setCaptions([]);
    setMode("starting");
    try {
      const res = await fetch(`${API}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      if (!res.ok) throw new Error(`Session request failed (${res.status})`);
      const s = (await res.json()) as CreateSessionResponse;
      await rt.connect(s.livekitUrl, s.token);
      setMicOn(true);
      setMode("live");
      // The worker normally joins within a second; if it doesn't, say so instead of staying silent.
      setTimeout(() => {
        const m = rtRef.current?.getMetrics();
        if (m && m.connection === "connected" && !m.agentPresent) {
          setError(
            "No AI agent joined this conversation. Start the agent worker (pnpm dev:worker) and check its terminal for errors.",
          );
        }
      }, 8000);
    } catch (e) {
      setError(describeError(e));
      setMode("idle");
      await rt.disconnect().catch(() => undefined);
    }
  }, [agentId]);

  const stop = useCallback(async () => {
    const rt = rtRef.current;
    if (!rt) return;
    if (mode === "mirror") rt.stopMirrorTest();
    else await rt.disconnect();
    setMode("idle");
  }, [mode]);

  const mirror = useCallback(async () => {
    const rt = rtRef.current;
    if (!rt) return;
    setError(null);
    try {
      await rt.startMirrorTest();
      setMode("mirror");
    } catch (e) {
      setError(describeError(e));
    }
  }, []);

  const toggleMic = useCallback(async () => {
    const next = !micOn;
    await rtRef.current?.setMicEnabled(next);
    setMicOn(next);
  }, [micOn]);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.name.toLowerCase().endsWith(".vrm")) {
      setError("Drop a .vrm file to use your own avatar.");
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      await rtRef.current?.setAvatar({ kind: "vrm", url });
      setAvatarLabel(file.name);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    rtRef.current?.setLookTarget({
      x: ((e.clientX - r.left) / r.width) * 2 - 1,
      y: -(((e.clientY - r.top) / r.height) * 2 - 1),
    });
  }, []);

  const m = metrics;
  const live = mode === "live";
  const agentName = agents.find((a) => a.id === agentId)?.name ?? "Agent";

  return (
    <main className={styles.page}>
      <section
        className={styles.stage}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onPointerMove={onPointerMove}
        onPointerLeave={() => rtRef.current?.setLookTarget(null)}
      >
        <canvas ref={canvasRef} className={styles.canvas} aria-label={`${agentName}, animated avatar`} />
        <div className={styles.badge} title="You are talking to an AI">
          AI · {agentName}
        </div>
        {m && (
          <div className={styles.state} data-state={m.agentState}>
            {mode === "mirror" ? "lip-sync test" : m.agentState}
          </div>
        )}
        <div className={styles.captions} aria-live="polite">
          {captions.slice(-3).map((c) => (
            <p key={c.id} className={c.role === "user" ? styles.capUser : styles.capAgent}>
              {c.text}
            </p>
          ))}
        </div>
        {!ready && <div className={styles.loading}>Loading avatar…</div>}
      </section>

      <aside className={styles.panel}>
        <h1 className={styles.title}>Playground</h1>

        <div className={styles.group}>
          <label className={styles.label} htmlFor="agent">
            Agent
          </label>
          <select
            id="agent"
            className={styles.select}
            value={agentId}
            disabled={mode !== "idle"}
            onChange={(e) => setAgentId(e.target.value)}
          >
            {(agents.length ? agents : [{ id: "demo-ava", name: "Ava", voice: "Kore" }]).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · voice {a.voice}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.row}>
          {mode === "idle" || mode === "starting" ? (
            <>
              <button className={styles.primary} disabled={!ready || mode === "starting"} onClick={start}>
                {mode === "starting" ? "Connecting…" : "Start conversation"}
              </button>
              <button className={styles.secondary} disabled={!ready || mode === "starting"} onClick={mirror}>
                Lip-sync test
              </button>
            </>
          ) : (
            <>
              <button className={styles.danger} onClick={stop}>
                {mode === "mirror" ? "Stop test" : "End"}
              </button>
              {live && (
                <button className={styles.secondary} onClick={toggleMic} aria-pressed={!micOn}>
                  {micOn ? "Mute mic" : "Unmute mic"}
                </button>
              )}
            </>
          )}
        </div>
        {mode === "mirror" && (
          <p className={styles.hint}>Speak: the avatar mouths what your microphone hears. No AI involved.</p>
        )}
        {live && m && !m.agentPresent && <p className={styles.hint}>Waiting for the agent worker to join…</p>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.group}>
          <span className={styles.label}>Camera</span>
          <div className={styles.seg}>
            {(["portrait", "upper", "full"] as Framing[]).map((f) => (
              <button key={f} aria-pressed={framing === f} onClick={() => setFraming(f)}>
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.group}>
          <span className={styles.label}>Audio output</span>
          <div className={styles.seg}>
            <button aria-pressed={playback === "element"} disabled={mode !== "idle"} onClick={() => setPlayback("element")}>
              speakers
            </button>
            <button
              aria-pressed={playback === "delay-line"}
              disabled={mode !== "idle"}
              onClick={() => setPlayback("delay-line")}
            >
              headphones (exact sync)
            </button>
          </div>
        </div>

        <div className={styles.group}>
          <span className={styles.label}>Gestures</span>
          <div className={styles.chips}>
            {GESTURES.map((g) => (
              <button key={g} onClick={() => rtRef.current?.playGesture(g)}>
                {g.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.group}>
          <span className={styles.label}>Emotion</span>
          <div className={styles.chips}>
            {EMOTIONS.map((e) => (
              <button key={e} onClick={() => rtRef.current?.setEmotion(e, 0.9)}>
                {e}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.group}>
          <span className={styles.label}>Avatar</span>
          <p className={styles.hint}>
            {avatarLabel}. Drop a <code>.vrm</code> file on the stage to try your own model.
          </p>
        </div>

        <div className={styles.group}>
          <span className={styles.label}>Performance</span>
          <dl className={styles.hud}>
            <dt>FPS</dt>
            <dd className={m && m.fps < 30 ? styles.bad : undefined}>{m ? m.fps.toFixed(0) : "–"}</dd>
            <dt>Frame time</dt>
            <dd>{m ? `${m.frameMs.toFixed(1)} ms` : "–"}</dd>
            <dt>Lips vs sound</dt>
            <dd className={m && m.avOffsetMs > 37 ? styles.bad : undefined}>
              {m && m.lipFrameRate > 0 ? `${m.avOffsetMs.toFixed(0)} ms` : "–"}
            </dd>
            <dt>Reply time</dt>
            <dd>{m?.voiceToVoiceMs != null ? `${m.voiceToVoiceMs} ms` : "–"}</dd>
            <dt>Connection</dt>
            <dd>{m?.connection ?? "–"}</dd>
            <dt>AI agent</dt>
            <dd className={live && m && !m.agentPresent ? styles.bad : undefined}>
              {m?.agentPresent ? "joined" : live ? "not joined" : "–"}
            </dd>
            <dt>Your mic</dt>
            <dd>
              <span className={styles.meter} aria-label="Microphone level">
                <span style={{ width: `${Math.round((m?.micLevel ?? 0) * 100)}%` }} />
              </span>
            </dd>
          </dl>
        </div>
      </aside>
    </main>
  );
}
