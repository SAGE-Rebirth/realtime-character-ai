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

interface Check {
  ok: boolean;
  label: string;
  /** What to do about it, and where. */
  fix?: { text: string; href: string };
}

/** What a careful person would check before visitors get this version. None of it blocks publishing. */
function useReadiness(open: boolean, tested: boolean): Check[] {
  const { agent, draft } = useEditor();
  const [avatarOk, setAvatarOk] = useState(true);
  const [docsOk, setDocsOk] = useState(true);
  const base = `/agents/${agent.id}`;

  useEffect(() => {
    if (!open) return;
    if (draft.avatar.kind === "vrm") {
      const url = draft.avatar.url;
      api
        .avatars()
        .then((list) => setAvatarOk(list.some((a) => a.url === url)))
        .catch(() => undefined);
    } else setAvatarOk(true);
    if (draft.knowledge.length) {
      api
        .knowledge()
        .then((docs) => setDocsOk(draft.knowledge.every((id) => docs.some((d) => d.id === id && d.status === "ready"))))
        .catch(() => undefined);
    } else setDocsOk(true);
  }, [open, draft.avatar, draft.knowledge]);

  return [
    {
      ok: draft.instructions.trim().length >= 40,
      label: draft.instructions.trim() ? "Instructions say who the agent is" : "Instructions are written",
      fix: { text: "Write a few sentences under Personality", href: `${base}/personality` },
    },
    { ok: draft.role.trim().length > 0, label: "It has a role", fix: { text: "Add one line under Profile", href: base } },
    {
      ok: Boolean(draft.greeting?.trim()),
      label: "It greets the visitor",
      fix: { text: "Add a greeting under Profile, or leave it so the visitor speaks first", href: base },
    },
    { ok: avatarOk, label: "The avatar file is in place", fix: { text: "Pick an avatar under Appearance", href: `${base}/appearance` } },
    { ok: docsOk, label: "Its documents are ready", fix: { text: "Check the documents under Knowledge", href: `${base}/knowledge` } },
    {
      ok: tested,
      label: tested ? "You talked to this draft since the last change" : "Not tried since the last change",
      fix: { text: "Press Talk on the stage and try a few questions first", href: "" },
    },
  ];
}

function PublishDialog({ open, onClose, tested }: { open: boolean; onClose: () => void; tested: boolean }) {
  const { agent, flush, replace } = useEditor();
  const checks = useReadiness(open, tested);
  const open_ = checks.filter((c) => !c.ok);
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
        <ul className={s.checks} aria-label="Before you publish">
          {checks.map((c) => (
            <li key={c.label} data-ok={c.ok}>
              <span className={s.checkMark} aria-hidden>
                {c.ok ? "✓" : "!"}
              </span>
              <span>
                {c.label}
                {!c.ok && c.fix && (
                  <span className={s.checkFix}>
                    {c.fix.href ? (
                      <Link href={c.fix.href} onClick={onClose}>
                        {c.fix.text}
                      </Link>
                    ) : (
                      c.fix.text
                    )}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
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
            {busy ? "Publishing…" : open_.length ? `Publish version ${next} anyway` : `Publish version ${next}`}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Previous / next at the foot of every panel, in the order people usually work through them. */
function PanelPager({ base, current }: { base: string; current: string }) {
  const i = EDITOR_PANELS.findIndex((p) => p.slug === current);
  const prev = i > 0 ? EDITOR_PANELS[i - 1] : undefined;
  const next = i >= 0 ? EDITOR_PANELS[i + 1] : undefined;
  const href = (slug: string) => (slug ? `${base}/${slug}` : base);
  return (
    <nav className={s.pager} aria-label="Previous and next settings">
      {prev ? (
        <Link href={href(prev.slug)} className={s.pagerLink}>
          <span className={s.pagerHint}>Previous</span>
          <span>‹ {prev.label}</span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link href={href(next.slug)} className={s.pagerLink} data-next>
          <span className={s.pagerHint}>Next</span>
          <span>{next.label} ›</span>
        </Link>
      )}
    </nav>
  );
}

function EditorFrame({ children }: { children: React.ReactNode }) {
  const { agent, draft, save, saveError, saveConflict, setRuntime, flush } = useEditor();
  const path = usePathname();
  const base = `/agents/${agent.id}`;
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // The agent's saved state when a conversation was last started, to know if the draft was tried.
  const [testedAt, setTestedAt] = useState<string | null>(null);
  const lastVersion = useRef(agent.publishedVersion);

  useEffect(() => {
    // Also on every panel change: moving between panels resets the title to the site default.
    // The router resets the title to the site default just after a panel change, so set it once
    // now and once after that.
    const title = `${draft.name || "Untitled agent"} · MetaAvatar Studio`;
    document.title = title;
    const t = setTimeout(() => (document.title = title), 150);
    return () => clearTimeout(t);
  }, [draft.name, path]);

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
            {save === "error" &&
              (saveConflict ? (
                <button className={btn("quiet", true)} onClick={() => window.location.reload()}>
                  Reload
                </button>
              ) : (
                <button className={btn("quiet", true)} onClick={() => void flush()}>
                  Try again
                </button>
              ))}
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

      {save === "error" && saveError && <Notice error>{saveError}</Notice>}

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

        <div className={s.content}>
          {children}
          <PanelPager base={base} current={current ?? ""} />
        </div>

        <aside className={s.try} aria-label={`Talk to ${draft.name}`}>
          <Stage
            agentId={agent.id}
            version="draft"
            agentName={draft.name || "Agent"}
            avatar={draft.avatar}
            framing={draft.framing}
            configStamp={agent.updatedAt}
            onRuntime={setRuntime}
            onModeChange={(m) => m === "live" && setTestedAt(agent.updatedAt)}
          />
          <p className={s.tryNote}>You're talking to the draft. Visitors get the published version.</p>
        </aside>
      </div>

      <PublishDialog open={publishing} onClose={() => setPublishing(false)} tested={testedAt === agent.updatedAt} />
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
