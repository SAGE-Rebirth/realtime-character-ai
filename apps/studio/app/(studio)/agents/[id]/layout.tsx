"use client";

import type { AgentDetail } from "@metaavatar/protocol";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Stage from "@/components/Stage";
import { btn, Field, Notice, Tag, ui } from "@/components/ui";
import { api } from "@/lib/api";
import { EDITOR_PANELS } from "@/lib/nav";
import { EditorProvider, type SaveState, useEditor } from "./editor";
import s from "./editor.module.css";

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "All changes saved",
  saving: "Saving…",
  unsaved: "Editing…",
  error: "Couldn't save",
};

function PublishDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { agent, flush, replace } = useEditor();
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = (agent.publishedVersion ?? 0) + 1;

  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await flush();
      replace(await api.publish(agent.id, note));
      setNote("");
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className={s.dialog} onClose={onClose} aria-labelledby="publish-title">
      <form className={s.dialogBody} onSubmit={publish}>
        <h2 id="publish-title" className={ui.sectionTitle}>
          Publish version {next}
        </h2>
        <p className={ui.help}>
          Your website and apps switch to this version straight away. You can roll back to an earlier
          version under Versions.
        </p>
        <Field label="What changed" htmlFor="publish-note" help="Optional. Shown in the version history.">
          <input
            id="publish-note"
            className={ui.input}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={280}
            placeholder="For example: friendlier greeting"
          />
        </Field>
        {error && <Notice error>{error}</Notice>}
        <div className={s.dialogActions}>
          <button type="button" className={btn("quiet")} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btn("primary")} disabled={busy}>
            {busy ? "Publishing…" : `Publish version ${next}`}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function EditorFrame({ children }: { children: React.ReactNode }) {
  const { agent, draft, save, saveError, flush } = useEditor();
  const path = usePathname();
  const base = `/agents/${agent.id}`;
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const lastVersion = useRef(agent.publishedVersion);

  useEffect(() => {
    document.title = `${draft.name} · MetaAvatar Studio`;
  }, [draft.name]);

  useEffect(() => {
    if (agent.publishedVersion && agent.publishedVersion !== lastVersion.current) {
      setToast(`Published version ${agent.publishedVersion}`);
      const t = setTimeout(() => setToast(null), 3500);
      lastVersion.current = agent.publishedVersion;
      return () => clearTimeout(t);
    }
  }, [agent.publishedVersion]);

  const current = path === base ? "" : path.slice(base.length + 1).split("/")[0];

  return (
    <div className={s.editor}>
      <header className={s.header}>
        <div className={s.titleBlock}>
          <Link href="/agents" className={s.back}>
            Agents
          </Link>
          <h1 className={s.title}>{draft.name || "Untitled agent"}</h1>
          <div className={s.meta}>
            {agent.publishedVersion === null ? (
              <Tag>Draft only</Tag>
            ) : (
              <Tag tone="live">
                <span className={ui.dot} />
                Live v{agent.publishedVersion}
              </Tag>
            )}
            {agent.publishedVersion !== null && agent.hasUnpublishedChanges && (
              <Tag tone="warn">Draft differs from live</Tag>
            )}
            <span className={s.save} data-state={save} title={saveError ?? undefined}>
              {SAVE_LABEL[save]}
            </span>
            {save === "error" && (
              <button className={btn("quiet", true)} onClick={() => void flush()}>
                Try again
              </button>
            )}
          </div>
        </div>
        <button
          className={btn("primary")}
          onClick={() => setPublishing(true)}
          disabled={agent.publishedVersion !== null && !agent.hasUnpublishedChanges && save === "saved"}
          title={
            agent.publishedVersion !== null && !agent.hasUnpublishedChanges
              ? "Nothing new to publish"
              : "Make this draft the live version"
          }
        >
          Publish
        </button>
      </header>

      <div className={s.body}>
        <nav className={s.panels} aria-label="Agent settings">
          {EDITOR_PANELS.map((p) => (
            <Link
              key={p.slug}
              href={p.slug ? `${base}/${p.slug}` : base}
              className={s.panelLink}
              aria-current={current === p.slug ? "page" : undefined}
            >
              <span>{p.label}</span>
              {p.phase && p.phase > 2 && <span className={s.panelPhase}>Phase {p.phase}</span>}
              {p.phase === 2 && <span className={s.panelPhase}>Soon</span>}
            </Link>
          ))}
        </nav>

        <div className={s.content}>{children}</div>

        <aside className={s.try} aria-label={`Talk to ${draft.name}`}>
          <Stage
            agentId={agent.id}
            version="draft"
            agentName={draft.name || "Agent"}
            avatar={draft.avatar}
            framing={draft.framing}
            configStamp={agent.updatedAt}
          />
          <p className={s.tryNote}>You're talking to the draft. Visitors get the published version.</p>
        </aside>
      </div>

      <PublishDialog open={publishing} onClose={() => setPublishing(false)} />
      {toast && (
        <div className={s.toast} role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

export default function AgentEditorLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setAgent(null);
    setError(null);
    api
      .agent(id)
      .then((a) => live && setAgent(a))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [id]);

  if (error) {
    return (
      <div className={s.missing}>
        <Notice error>{error}</Notice>
        <button className={btn()} onClick={() => router.push("/agents")}>
          Back to agents
        </button>
      </div>
    );
  }
  if (!agent) return <p className={ui.help}>Loading agent…</p>;
  return (
    <EditorProvider key={agent.id} initial={agent}>
      <EditorFrame>{children}</EditorFrame>
    </EditorProvider>
  );
}
