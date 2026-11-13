"use client";

/**
 * Versions: numbered snapshots of the agent. One of them is live (what visitors get). A version
 * never changes once saved; to change one, open it for editing (it is copied into the draft), make
 * the changes, then save the draft as a new version or publish it.
 */
import type { AgentConfig, AgentDraft } from "@metaavatar/protocol";
import { VOICES } from "@metaavatar/protocol";
import { useState } from "react";
import { btn, Notice, Section, Tag, ui } from "@/components/ui";
import { api, timeAgo } from "@/lib/api";
import { AUDIENCES } from "@/lib/safety";
import { useEditor } from "../editor";
import s from "../panels.module.css";

/** The settings of a version in plain words, in the order of the editor's panels. */
function describe(c: AgentDraft): [string, string][] {
  const tone = (v: number, low: string, mid: string, high: string) => (v < 0.35 ? low : v > 0.65 ? high : mid);
  const avatar = c.avatar.kind === "vrm" ? decodeURIComponent(c.avatar.url.split("/").pop() ?? "VRM model") : "Studio character";
  return [
    ["Name", c.name],
    ["Role", c.role || "None"],
    ["Greeting", c.greeting || "None (visitor speaks first)"],
    ["Language", c.language],
    ["Instructions", c.instructions || "None"],
    [
      "Tone",
      [
        tone(c.style.warmth, "matter-of-fact", "friendly", "warm"),
        tone(c.style.formality, "casual", "relaxed", "formal"),
        tone(c.style.detail, "very brief", "brief", "detailed"),
        tone(c.style.humor, "serious", "light humour", "playful"),
      ].join(", "),
    ],
    ["Voice", `${c.voice}${VOICES.find((v) => v.name === c.voice) ? ` (${VOICES.find((v) => v.name === c.voice)!.character})` : ""}`],
    ["Avatar", avatar],
    ["Camera", { portrait: "Head and shoulders", upper: "Waist up", full: "Full body" }[c.framing]],
    ["Documents", c.knowledge.length ? `${c.knowledge.length} in use` : "None"],
    ["Web search", c.groundingSearch ? "On" : "Off"],
    ["Memory", c.memory ? "On" : "Off"],
    ["Audience", AUDIENCES.find((a) => a.value === c.audience)?.label ?? c.audience],
  ];
}

function VersionDetails({ config, draft }: { config: AgentConfig; draft: AgentDraft }) {
  const { id: _id, ...saved } = config;
  const now = new Map(describe(draft));
  return (
    <dl className={s.versionDetails}>
      {describe(saved).map(([label, value]) => {
        const differs = now.get(label) !== value;
        return (
          <div key={label} data-differs={differs}>
            <dt>{label}</dt>
            <dd>
              {value}
              {differs && <span className={s.differs}>Draft: {now.get(label)}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export default function VersionsPanel() {
  const { agent, draft, flush, replace } = useEditor();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ version: number; config: AgentConfig } | null>(null);
  const [note, setNote] = useState("");

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await flush();
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const edit = (version: number, discard = false) => {
    const question = discard
      ? "Throw away the changes in your draft and go back to the live version?"
      : `Open version ${version} for editing? It is copied into the draft, replacing the draft's unsaved changes. Save the draft as a version first if you want to keep them.`;
    if (agent.hasUnpublishedChanges && !window.confirm(question)) return;
    void run(`edit-${version}`, async () => replace(await api.restore(agent.id, version)));
  };

  const makeLive = (version: number) => {
    if (!window.confirm(`Make version ${version} the live version? Visitors get it straight away. Your draft is not changed.`)) return;
    void run(`live-${version}`, async () => replace(await api.makeLive(agent.id, version)));
  };

  const view = (version: number) => {
    if (open?.version === version) return setOpen(null);
    void run(`view-${version}`, async () => setOpen({ version, config: await api.version(agent.id, version) }));
  };

  const saveVersion = (e: React.FormEvent) => {
    e.preventDefault();
    void run("save", async () => {
      replace(await api.saveVersion(agent.id, note.trim()));
      setNote("");
    });
  };

  return (
    <>
      <Section
        title="Save the draft as a version"
        help="Keeps the draft exactly as it is now under a number, without changing what visitors get. Use it for work in progress or a variant you want to come back to. Publish (top of the page) saves a version and makes it live in one step."
      >
        <form className={s.saveVersion} onSubmit={saveVersion}>
          <input
            className={ui.input}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={280}
            placeholder="What is this version? For example: shorter answers, trial"
            aria-label="Description of this version"
          />
          <button className={btn()} disabled={busy !== null}>
            {busy === "save" ? "Saving…" : "Save version"}
          </button>
        </form>
      </Section>

      <Section
        title="Versions"
        help="Saved versions never change. View one to see its settings, edit it to bring it into the draft, or make it live to switch what visitors get."
      >
        {error && <Notice error>{error}</Notice>}
        {agent.versions.length === 0 ? (
          <Notice>Nothing saved yet. Save the draft as a version above, or use Publish when it sounds right.</Notice>
        ) : (
          <ol className={s.versions}>
            {agent.hasUnpublishedChanges && (
              <li className={s.version}>
                <span className={s.versionNo}>Draft</span>
                <span className={s.versionText}>
                  <span>Your working copy</span>
                  <span className={s.versionMeta}>Differs from the live version. Only you can talk to it.</span>
                </span>
              </li>
            )}
            {agent.versions.map((v) => (
              <li key={v.version} className={s.versionItem}>
                <div className={s.version}>
                  <span className={s.versionNo}>v{v.version}</span>
                  <span className={s.versionText}>
                    <span>{v.note || "No description"}</span>
                    <span className={s.versionMeta}>Saved {timeAgo(v.publishedAt)}</span>
                  </span>
                  <span className={s.versionActions}>
                    {v.live && (
                      <Tag tone="live">
                        <span className={ui.dot} />
                        Live
                      </Tag>
                    )}
                    <button className={btn("quiet", true)} disabled={busy !== null} onClick={() => view(v.version)} aria-expanded={open?.version === v.version}>
                      {open?.version === v.version ? "Hide" : "View"}
                    </button>
                    {v.live && agent.hasUnpublishedChanges ? (
                      <button className={btn("default", true)} disabled={busy !== null} onClick={() => edit(v.version, true)}>
                        Discard draft changes
                      </button>
                    ) : (
                      !v.live && (
                        <button className={btn("default", true)} disabled={busy !== null} onClick={() => edit(v.version)}>
                          Edit
                        </button>
                      )
                    )}
                    {!v.live && (
                      <button className={btn("default", true)} disabled={busy !== null} onClick={() => makeLive(v.version)}>
                        Make live
                      </button>
                    )}
                  </span>
                </div>
                {open?.version === v.version && <VersionDetails config={open.config} draft={draft} />}
              </li>
            ))}
          </ol>
        )}
      </Section>
    </>
  );
}
