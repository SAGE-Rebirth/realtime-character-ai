"use client";

import type { AgentSummary, AgentTemplate } from "@metaavatar/protocol";
import { VOICES } from "@metaavatar/protocol";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Monogram } from "@/components/Monogram";
import { btn, Field, Notice, PageHeader, Tag, ui } from "@/components/ui";
import { useUndo } from "@/components/Undo";
import { api, timeAgo } from "@/lib/api";
import s from "./agents.module.css";

function Status({ a }: { a: AgentSummary }) {
  if (a.publishedVersion === null) return <Tag>Draft only</Tag>;
  return (
    <span className={s.status}>
      <Tag tone="live">
        <span className={ui.dot} />
        Live v{a.publishedVersion}
      </Tag>
      {a.hasUnpublishedChanges && <Tag tone="warn">Unpublished changes</Tag>}
    </span>
  );
}

function NewAgentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [template, setTemplate] = useState("tutor");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      ref.current?.showModal();
      api.templates().then(setTemplates).catch((e: Error) => setError(e.message));
    } else ref.current?.close();
  }, [open]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const a = await api.createAgent(template, name || undefined);
      router.push(`/agents/${a.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className={s.dialog} onClose={onClose} aria-labelledby="new-agent-title">
      <form onSubmit={create} className={s.dialogBody}>
        <h2 id="new-agent-title" className={ui.sectionTitle}>
          New agent
        </h2>
        <fieldset className={s.templates}>
          <legend className={ui.fieldLabel}>Start from</legend>
          {templates.map((t) => (
            <label key={t.id} className={s.template} data-checked={template === t.id}>
              <input
                type="radio"
                name="template"
                value={t.id}
                checked={template === t.id}
                onChange={() => setTemplate(t.id)}
              />
              <span className={s.templateTitle}>{t.title}</span>
              <span className={s.templateSummary}>{t.summary}</span>
            </label>
          ))}
        </fieldset>
        <Field label="Name" htmlFor="new-name" help="You can change this, and everything else, later.">
          <input
            id="new-name"
            className={ui.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Use the template's name"
            maxLength={80}
          />
        </Field>
        {error && <Notice error>{error}</Notice>}
        <div className={s.dialogActions}>
          <button type="button" className={btn("quiet")} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btn("primary")} disabled={busy}>
            {busy ? "Creating…" : "Create agent"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();
  const offerUndo = useUndo();
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const load = () =>
    api
      .agents()
      .then(setAgents)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    document.title = "Agents · MetaAvatar Studio";
    void load();
    // Home's "New agent" step links here with ?new=1.
    if (new URLSearchParams(window.location.search).get("new")) setCreating(true);
  }, []);

  const duplicate = async (a: AgentSummary) => {
    setBusy(a.id);
    try {
      const copy = await api.duplicate(a.id);
      router.push(`/agents/${copy.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  // Deleting hides the agent at once and offers Undo; it is really deleted a few seconds later.
  const remove = (a: AgentSummary) => {
    const show = () => setHidden((h) => new Set([...h].filter((id) => id !== a.id)));
    setHidden((h) => new Set(h).add(a.id));
    offerUndo({
      message: `Deleted ${a.name}${a.publishedVersion !== null ? " (it was published)" : ""}`,
      undo: show,
      commit: async () => {
        await api.deleteAgent(a.id);
        await load();
        show();
      },
      onError: (e) => setError(e.message),
    });
  };

  const needle = filter.trim().toLowerCase();
  const shown = agents?.filter((a) => !hidden.has(a.id) && (!needle || `${a.name} ${a.role} ${a.voice}`.toLowerCase().includes(needle))) ?? [];

  const voiceCharacter = (v: string) => VOICES.find((x) => x.name === v)?.character;

  return (
    <div className={s.page}>
      <PageHeader
        title="Agents"
        lead="Each agent is a character with its own persona, voice and avatar. Edit the draft, talk to it, then publish."
        actions={
          <button className={btn("primary")} onClick={() => setCreating(true)}>
            New agent
          </button>
        }
      />
      {error && <Notice error>{error}</Notice>}
      {agents && agents.length === 0 && (
        <div className={s.empty}>
          <p className={ui.sectionTitle}>No agents yet</p>
          <p className={ui.help}>Start from a template such as a tutor or a support agent, then make it your own.</p>
          <button className={btn("primary")} onClick={() => setCreating(true)}>
            Create your first agent
          </button>
        </div>
      )}
      {agents && agents.length > 5 && (
        <input
          className={`${ui.input} ${s.search}`}
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search agents by name, role or voice"
          aria-label="Search agents"
        />
      )}
      {agents && agents.length > 0 && shown.length === 0 && <p className={ui.help}>No agent matches "{filter}".</p>}
      {shown.length > 0 && (
        <ul className={s.list}>
          {shown.map((a) => (
            <li key={a.id} className={s.row}>
              <Monogram name={a.name} />
              <div className={s.who}>
                <Link href={`/agents/${a.id}`} className={s.name}>
                  {a.name}
                </Link>
                <span className={s.role}>{a.role || "No role yet"}</span>
              </div>
              <span className={s.voice}>
                {a.voice}
                <span className={s.voiceChar}>{voiceCharacter(a.voice)}</span>
              </span>
              <Status a={a} />
              <span className={s.updated}>Edited {timeAgo(a.updatedAt)}</span>
              <span className={s.actions}>
                <Link href={`/agents/${a.id}`} className={btn("default", true)}>
                  Open
                </Link>
                <details className={s.more}>
                  <summary className={btn("quiet", true)} aria-label={`More actions for ${a.name}`}>
                    More
                  </summary>
                  <div className={s.menu}>
                    <button disabled={busy === a.id} onClick={() => void duplicate(a)}>
                      Duplicate
                    </button>
                    <button disabled={busy === a.id} data-danger onClick={() => void remove(a)}>
                      Delete
                    </button>
                  </div>
                </details>
              </span>
            </li>
          ))}
        </ul>
      )}
      {!agents && !error && <p className={ui.help}>Loading agents…</p>}
      <NewAgentDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
