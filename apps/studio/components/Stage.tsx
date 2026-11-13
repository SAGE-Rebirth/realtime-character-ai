"use client";

/**
 * The stage: a lit viewport where the avatar performs, plus the controls to talk to it.
 * Owns the AvatarRuntime. Appearance props apply live, even mid-conversation.
 */
import type { AvatarRuntime, Caption, PlaybackMode } from "@metaavatar/avatar-runtime";
import type { AgentState, AvatarRef, Framing, Source } from "@metaavatar/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import s from "./stage.module.css";

export type StageMode = "idle" | "starting" | "live" | "mirror";

export interface StageProps {
  /** Agent to talk to; null shows the avatar without conversation controls. */
  agentId: string | null;
  version?: "draft" | "published";
  agentName: string;
  avatar: AvatarRef;
  framing: Framing;
  playbackMode?: PlaybackMode;
  /** Changes whenever the agent's saved config changes, so a live call can offer a restart. */
  configStamp?: string;
  /** Give the parent the runtime (gestures, metrics). */
  onRuntime?: (rt: AvatarRuntime | null) => void;
  onModeChange?: (mode: StageMode) => void;
  /** Offer the mic-only lip-sync test. */
  allowMirror?: boolean;
  /** "panel" fits a side column; "fill" takes the whole area. */
  variant?: "panel" | "fill";
}

function describeError(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The microphone is blocked for this page. Allow it in the browser's site settings, or type below.";
  }
  if (name === "NotFoundError") return "No microphone found. Plug one in, or type below.";
  return e instanceof Error ? e.message : String(e);
}

const STATE_LABEL: Record<AgentState, string> = {
  initializing: "Joining",
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

export default function Stage({
  agentId,
  version = "draft",
  agentName,
  avatar,
  framing,
  playbackMode = "element",
  configStamp,
  onRuntime,
  onModeChange,
  allowMirror = false,
  variant = "panel",
}: StageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rtRef = useRef<AvatarRuntime | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState<string | null>("Setting the stage…");
  const [mode, setModeState] = useState<StageMode>("idle");
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [micOn, setMicOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [stampAtStart, setStampAtStart] = useState<string | undefined>(undefined);
  const avatarKey = JSON.stringify(avatar);
  const appliedAvatar = useRef<string>("");
  const joinCheck = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setMode = useCallback(
    (m: StageMode) => {
      setModeState(m);
      onModeChange?.(m);
    },
    [onModeChange],
  );

  // Create the runtime once per playback mode (three.js and WebAudio need the browser).
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
        playbackMode,
      });
      if (disposed) {
        void rt.dispose();
        return;
      }
      rtRef.current = rt;
      appliedAvatar.current = JSON.stringify({ kind: "procedural", style: "default" });
      if (process.env.NODE_ENV !== "production") (window as unknown as { __avatar?: AvatarRuntime }).__avatar = rt;
      rt.on("sources", setSources);
      rt.on("caption", (c) => {
        // A new question clears the sources shown for the previous answer.
        if (c.role === "user") setSources([]);
        setCaptions((prev) => {
          const i = prev.findIndex((p) => p.id === c.id);
          return (i >= 0 ? prev.map((p, j) => (j === i ? c : p)) : [...prev, c]).slice(-20);
        });
      });
      rt.on("state", setAgentState);
      rt.on("warning", (w) => setError(w.message));
      rt.on("error", (e) => setError(e.message));
      rt.on("connection", (c) => {
        if (c === "disconnected") setMode("idle");
      });
      setReady(true);
      setLoading(null);
      onRuntime?.(rt);
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      disposed = true;
      onRuntime?.(null);
      rtRef.current = null;
      setReady(false);
      void rt?.dispose();
    };
    // Framing and avatar are applied by the effects below; playback mode needs a new runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackMode]);

  useEffect(() => {
    if (ready) rtRef.current?.setFraming(framing);
  }, [framing, ready]);

  useEffect(() => {
    const rt = rtRef.current;
    if (!ready || !rt || appliedAvatar.current === avatarKey) return;
    appliedAvatar.current = avatarKey;
    setLoading(avatar.kind === "vrm" ? "Loading avatar…" : null);
    rt.setAvatar(avatar)
      .then(() => setLoading(null))
      .catch(() => {
        setLoading(null);
        setError("This avatar file couldn't be loaded. Pick another one under Appearance.");
      });
    // avatarKey captures every field of `avatar`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarKey, ready]);

  const start = useCallback(async () => {
    const rt = rtRef.current;
    if (!rt || !agentId) return;
    setError(null);
    setCaptions([]);
    setSources([]);
    setMode("starting");
    try {
      const sess = await api.session(agentId, version);
      const joined = await rt.connect(sess.livekitUrl, sess.token);
      setMicOn(joined.mic);
      if (!joined.mic && joined.micError) setError(describeError(joined.micError));
      setStampAtStart(configStamp);
      setMode("live");
      if (joinCheck.current) clearTimeout(joinCheck.current);
      joinCheck.current = setTimeout(() => {
        const m = rtRef.current?.getMetrics();
        if (m && m.connection === "connected" && !m.agentPresent) {
          setError("The agent didn't join. Check that the agent worker is running (make status).");
        }
      }, 8000);
    } catch (e) {
      setError(describeError(e));
      setMode("idle");
      await rt.disconnect().catch(() => undefined);
    }
  }, [agentId, version, configStamp, setMode]);

  const stop = useCallback(async () => {
    const rt = rtRef.current;
    if (!rt) return;
    if (joinCheck.current) clearTimeout(joinCheck.current);
    if (mode === "mirror") rt.stopMirrorTest();
    else await rt.disconnect();
    setAgentState("idle");
    setMode("idle");
  }, [mode, setMode]);

  const restart = useCallback(async () => {
    await rtRef.current?.disconnect();
    await start();
  }, [start]);

  const mirror = useCallback(async () => {
    setError(null);
    try {
      await rtRef.current?.startMirrorTest();
      setMode("mirror");
    } catch (e) {
      setError(describeError(e));
    }
  }, [setMode]);

  const toggleMic = useCallback(async () => {
    try {
      await rtRef.current?.setMicEnabled(!micOn);
      setMicOn(!micOn);
    } catch (e) {
      setError(describeError(e));
    }
  }, [micOn]);

  const send = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = draft.trim();
      if (!text) return;
      setDraft("");
      await rtRef.current?.sendText(text).catch((err: unknown) => setError(describeError(err)));
    },
    [draft],
  );

  // End the conversation if the agent being shown changes.
  useEffect(() => {
    return () => {
      if (joinCheck.current) clearTimeout(joinCheck.current);
      void rtRef.current?.disconnect();
    };
  }, [agentId]);

  const live = mode === "live";
  const stale = live && configStamp !== undefined && stampAtStart !== undefined && configStamp !== stampAtStart;

  return (
    <div className={`${s.stage} ${variant === "fill" ? s.fill : ""}`}>
      <div
        className={s.viewport}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          rtRef.current?.setLookTarget({
            x: ((e.clientX - r.left) / r.width) * 2 - 1,
            y: -(((e.clientY - r.top) / r.height) * 2 - 1),
          });
        }}
        onPointerLeave={() => rtRef.current?.setLookTarget(null)}
      >
        <canvas ref={canvasRef} className={s.canvas} aria-label={`${agentName}, animated avatar`} />
        <div className={s.top}>
          <span className={s.badge} title="Viewers are always told they are talking to an AI">
            AI · {agentName}
          </span>
          {(live || mode === "mirror") && (
            <span className={s.onair} data-state={agentState}>
              <span className={s.onairDot} />
              {mode === "mirror" ? "Lip-sync test" : STATE_LABEL[agentState]}
            </span>
          )}
        </div>
        {loading && <div className={s.loading}>{loading}</div>}
        <div className={s.captions} aria-live="polite">
          {captions.slice(-3).map((c) => (
            <p key={c.id} className={c.role === "user" ? s.capUser : s.capAgent}>
              {c.text}
            </p>
          ))}
          {live && sources.length > 0 && (
            <p className={s.sources}>
              <span className={s.sourcesLabel}>From</span>
              {sources.map((src) => (
                <span key={src.id} className={s.source}>
                  {src.title}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>

      {stale && (
        <div className={s.stale}>
          <span>You changed this agent. Restart to hear the changes.</span>
          <button className={s.ghost} onClick={() => void restart()}>
            Restart
          </button>
        </div>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}

      {agentId && (
        <div className={s.controls}>
          {mode === "idle" || mode === "starting" ? (
            <>
              <button className={s.start} disabled={!ready || mode === "starting"} onClick={() => void start()}>
                {mode === "starting" ? "Connecting…" : `Talk to ${agentName}`}
              </button>
              {allowMirror && (
                <button className={s.ghost} disabled={!ready || mode === "starting"} onClick={() => void mirror()}>
                  Lip-sync test
                </button>
              )}
            </>
          ) : mode === "mirror" ? (
            <>
              <span className={s.hint}>The avatar mouths what your microphone hears. No AI involved.</span>
              <button className={s.end} onClick={() => void stop()}>
                Stop test
              </button>
            </>
          ) : (
            <>
              <button className={s.ghost} aria-pressed={!micOn} onClick={() => void toggleMic()}>
                {micOn ? "Mute" : "Unmute"}
              </button>
              <form className={s.chat} onSubmit={send}>
                <input
                  className={s.input}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Type a message"
                  aria-label={`Message ${agentName}`}
                  maxLength={2000}
                />
              </form>
              <button className={s.end} onClick={() => void stop()}>
                End
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
