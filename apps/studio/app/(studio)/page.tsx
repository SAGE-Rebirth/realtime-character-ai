"use client";

/** Home: where to begin. A walkthrough that ticks itself off as the workspace fills up. */
import type { AgentSummary, KnowledgeDoc } from "@metaavatar/protocol";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Monogram } from "@/components/Monogram";
import { btn, Notice, PageHeader, Section, Tag, ui } from "@/components/ui";
import { api, timeAgo, type Workspace } from "@/lib/api";
import s from "./home.module.css";

interface Step {
  done: boolean;
  title: string;
  text: string;
  action: { label: string; href: string };
}

export default function Home() {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [ws, setWs] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [talked, setTalked] = useState(false);

  useEffect(() => {
    document.title = "Home · MetaAvatar Studio";
    api
      .agents()
      .then(setAgents)
      .catch((e: Error) => setError(e.message));
    api.knowledge().then(setDocs).catch(() => undefined);
    api.workspace().then(setWs).catch(() => undefined);
    try {
      setTalked(window.localStorage.getItem("studio:talked") === "1");
    } catch {
      // storage blocked: the step just stays open
    }
  }, []);

  // The two demo agents ship with Studio; "your own" means anything else.
  const own = agents?.filter((a) => !a.id.startsWith("demo-")) ?? [];
  const first = own[0] ?? agents?.[0];
  const open = first ? `/agents/${first.id}` : "/agents";
  const steps: Step[] = [
    {
      done: own.length > 0,
      title: "Create an agent",
      text: "Start from a template such as a tutor or a support agent. You can change everything later.",
      action: { label: "New agent", href: "/agents?new=1" },
    },
    {
      done: own.some((a) => a.role.trim().length > 0),
      title: "Say who it is",
      text: "Give it a role and write a few sentences of instructions: what it helps with and how it should sound.",
      action: { label: "Open Personality", href: `${open}/personality` },
    },
    {
      done: own.some((a) => a.avatar.kind === "vrm"),
      title: "Choose a voice and a body",
      text: "Listen to the voices and pick one, then choose an avatar and play its gestures.",
      action: { label: "Open Appearance", href: `${open}/appearance` },
    },
    {
      done: talked,
      title: "Talk to it",
      text: "Press Talk on the stage beside the settings. Speak or type; interrupt it; see how it answers.",
      action: { label: "Open the agent", href: open },
    },
    {
      done: docs.some((d) => d.status === "ready"),
      title: "Give it your documents (optional)",
      text: "Add a manual, an FAQ or a web page, try questions against it, then tick it in the agent's Knowledge tab.",
      action: { label: "Open Knowledge", href: "/knowledge" },
    },
    {
      done: own.some((a) => a.publishedVersion !== null),
      title: "Publish",
      text: "Publishing saves a numbered version for visitors. A checklist shows anything worth fixing first.",
      action: { label: "Open the agent", href: open },
    },
  ];
  const next = steps.findIndex((st) => !st.done);
  const doneCount = steps.filter((st) => st.done).length;

  return (
    <div className={s.page}>
      <PageHeader
        title="Welcome to Studio"
        lead="Build a character people can talk to: give it a personality, a voice and a body, try it on the stage, then publish it."
      />
      {error && <Notice error>{error}</Notice>}
      {ws && !ws.geminiKeyConfigured && (
        <Notice error>
          No Gemini key is set, so agents can't talk yet. Add <code>LIVE_MODEL_API_KEY</code> to <code>.env</code> and
          restart. Everything else in Studio works without it.
        </Notice>
      )}

      <Section
        title={next === -1 ? "You've done the walkthrough" : "Get started"}
        help={next === -1 ? "Every step is ticked. The agents are yours to shape." : `${doneCount} of ${steps.length} done. Steps tick themselves off as you go.`}
      >
        <ol className={s.steps}>
          {steps.map((st, i) => (
            <li key={st.title} className={s.step} data-done={st.done} data-next={i === next}>
              <span className={s.stepMark} aria-hidden>
                {st.done ? "✓" : i + 1}
              </span>
              <span className={s.stepText}>
                <span className={s.stepTitle}>
                  {st.title} {st.done && <span className={s.srOnly}>(done)</span>}
                </span>
                <span className={ui.help}>{st.text}</span>
              </span>
              <Link href={st.action.href} className={btn(i === next ? "primary" : "default", true)}>
                {st.action.label}
              </Link>
            </li>
          ))}
        </ol>
      </Section>

      {agents && agents.length > 0 && (
        <Section title="Your agents">
          <ul className={s.agents}>
            {agents.slice(0, 6).map((a) => (
              <li key={a.id}>
                <Link href={`/agents/${a.id}`} className={s.agent}>
                  <Monogram name={a.name} />
                  <span className={s.agentText}>
                    <span className={s.agentName}>{a.name}</span>
                    <span className={ui.help}>{a.role || "No role yet"}</span>
                  </span>
                  <span className={s.agentMeta}>
                    {a.publishedVersion === null ? <Tag>Draft only</Tag> : <Tag tone="live">Live v{a.publishedVersion}</Tag>}
                    <span className={ui.help}>Edited {timeAgo(a.updatedAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div>
            <Link href="/agents" className={btn("default", true)}>
              All agents
            </Link>
          </div>
        </Section>
      )}

      <Section title="Need a hand?">
        <p className={ui.help}>
          The platform guide explains every screen step by step: <code>docs/PLATFORM_GUIDE.md</code> in the project
          folder. Where to find avatar models is in <code>assets/avatars/README.md</code>.
        </p>
      </Section>
    </div>
  );
}
