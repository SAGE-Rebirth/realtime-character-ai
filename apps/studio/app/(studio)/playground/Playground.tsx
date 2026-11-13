"use client";

/**
 * Playground: the test bench. Talk to any agent (draft or published) with live performance readouts,
 * trigger gestures and emotions by hand, and run the lip-sync test.
 */
import type { AvatarRuntime, PlaybackMode, RuntimeMetrics } from "@metaavatar/avatar-runtime";
import type { AgentDetail, AgentSummary, Emotion, Framing, Gesture } from "@metaavatar/protocol";
import { useEffect, useRef, useState } from "react";
import Stage, { type StageMode } from "@/components/Stage";
import { Field, Notice, PageHeader, Section, Segmented, ui } from "@/components/ui";
import { api } from "@/lib/api";
import s from "./playground.module.css";

const GESTURES: Gesture[] = ["wave", "nod", "shake_head", "shrug", "explain", "point", "celebrate", "think"];
const EMOTIONS: Emotion[] = ["neutral", "happy", "sad", "angry", "surprised", "relaxed", "thinking"];
const label = (x: string) => (x.charAt(0).toUpperCase() + x.slice(1)).replace("_", " ");

export default function Playground() {
  const rtRef = useRef<AvatarRuntime | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentId, setAgentId] = useState<string>("");
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [version, setVersion] = useState<"draft" | "published">("published");
  const [framing, setFraming] = useState<Framing>("upper");
  const [playback, setPlayback] = useState<PlaybackMode>("element");
  const [mode, setMode] = useState<StageMode>("idle");
  const [m, setMetrics] = useState<RuntimeMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .agents()
      .then((list) => {
        setAgents(list);
        setAgentId((cur) => cur || list[0]?.id || "");
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!agentId) return;
    api
      .agent(agentId)
      .then((a) => {
        setDetail(a);
        setFraming(a.draft.framing);
        setVersion(a.published ? "published" : "draft");
      })
      .catch((e: Error) => setError(e.message));
  }, [agentId]);

  useEffect(() => {
    const id = setInterval(() => rtRef.current && setMetrics(rtRef.current.getMetrics()), 250);
    return () => clearInterval(id);
  }, []);

  const cfg = detail ? (version === "published" && detail.published ? detail.published : detail.draft) : null;
  const busy = mode !== "idle";

  return (
    <div className={s.page}>
      <PageHeader
        title="Playground"
        lead="Talk to any agent with live performance readouts. Use it to check timing, lip-sync and gestures."
      />
      {error && <Notice error>{error}</Notice>}
      <div className={s.grid}>
        <div className={s.stage}>
          {cfg && (
            <Stage
              agentId={agentId}
              version={version}
              agentName={cfg.name}
              avatar={cfg.avatar}
              framing={framing}
              playbackMode={playback}
              onRuntime={(rt) => (rtRef.current = rt)}
              onModeChange={setMode}
              allowMirror
              variant="fill"
            />
          )}
        </div>

        <div className={s.side}>
          <Section title="Session">
            <Field label="Agent" htmlFor="pg-agent">
              <select
                id="pg-agent"
                className={ui.select}
                value={agentId}
                disabled={busy}
                onChange={(e) => setAgentId(e.target.value)}
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.role ? ` (${a.role})` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Version">
              <Segmented
                label="Version"
                value={version}
                onChange={(v) => !busy && setVersion(v)}
                options={[
                  ...(detail?.published ? [{ value: "published" as const, label: `Live v${detail.publishedVersion}` }] : []),
                  { value: "draft" as const, label: "Draft" },
                ]}
              />
            </Field>
            <Field label="Camera">
              <Segmented
                label="Camera"
                value={framing}
                onChange={setFraming}
                options={[
                  { value: "portrait", label: "Head" },
                  { value: "upper", label: "Waist up" },
                  { value: "full", label: "Full body" },
                ]}
              />
            </Field>
            <Field
              label="Sound"
              help="Headphones mode delays sound by a few milliseconds so lips and voice line up exactly."
            >
              <Segmented
                label="Sound"
                value={playback}
                onChange={(v) => !busy && setPlayback(v)}
                options={[
                  { value: "element", label: "Speakers" },
                  { value: "delay-line", label: "Headphones" },
                ]}
              />
            </Field>
          </Section>

          <Section title="Performance">
            <dl className={s.hud}>
              <dt>Frame rate</dt>
              <dd data-bad={m ? m.fps < 30 : undefined}>{m ? `${m.fps.toFixed(0)} fps` : "–"}</dd>
              <dt>Frame time</dt>
              <dd>{m ? `${m.frameMs.toFixed(1)} ms` : "–"}</dd>
              <dt>Lips vs sound</dt>
              <dd data-bad={m ? m.avOffsetMs > 37 : undefined}>
                {m && m.lipFrameRate > 0 ? `${m.avOffsetMs.toFixed(0)} ms` : "–"}
              </dd>
              <dt>Reply time</dt>
              <dd>{m?.voiceToVoiceMs != null ? `${(m.voiceToVoiceMs / 1000).toFixed(2)} s` : "–"}</dd>
              <dt>Connection</dt>
              <dd>{m?.connection ?? "–"}</dd>
              <dt>Agent</dt>
              <dd data-bad={mode === "live" && m ? !m.agentPresent : undefined}>
                {m?.agentPresent ? "Joined" : mode === "live" ? "Not joined" : "–"}
              </dd>
              <dt>Your mic</dt>
              <dd>
                <span className={s.meter} aria-label="Microphone level">
                  <span style={{ width: `${Math.round((m?.micLevel ?? 0) * 100)}%` }} />
                </span>
              </dd>
            </dl>
          </Section>

          <Section title="Body language" help="Trigger by hand to check how each one looks.">
            <div className={s.chips}>
              {GESTURES.map((g) => (
                <button key={g} onClick={() => rtRef.current?.playGesture(g)}>
                  {label(g)}
                </button>
              ))}
            </div>
            <div className={s.chips}>
              {EMOTIONS.map((e) => (
                <button key={e} onClick={() => rtRef.current?.setEmotion(e, 0.9)}>
                  {label(e)}
                </button>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
