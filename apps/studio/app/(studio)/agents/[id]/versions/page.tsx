"use client";

import { useState } from "react";
import { btn, Notice, Section, Tag, ui } from "@/components/ui";
import { api, timeAgo } from "@/lib/api";
import { useEditor } from "../editor";
import s from "../panels.module.css";

export default function VersionsPanel() {
  const { agent, flush, replace } = useEditor();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const restore = async (version: number) => {
    if (
      agent.hasUnpublishedChanges &&
      !window.confirm(`Replace your current draft with version ${version}? Unpublished changes in the draft will be lost.`)
    ) {
      return;
    }
    setBusy(version);
    try {
      await flush();
      replace(await api.restore(agent.id, version));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Versions"
      help="Publishing saves a numbered version that your website and apps use. To roll back, copy an older version into the draft, check it on the stage, then publish."
    >
      {error && <Notice error>{error}</Notice>}
      {agent.versions.length === 0 ? (
        <Notice>Nothing published yet. When the draft sounds right, use Publish at the top of the page.</Notice>
      ) : (
        <ol className={s.versions}>
          {agent.hasUnpublishedChanges && (
            <li className={s.version}>
              <span className={s.versionNo}>Draft</span>
              <span className={s.versionText}>
                <span>Unpublished changes</span>
                <span className={s.versionMeta}>Only you can talk to the draft</span>
              </span>
            </li>
          )}
          {agent.versions.map((v, i) => (
            <li key={v.version} className={s.version}>
              <span className={s.versionNo}>v{v.version}</span>
              <span className={s.versionText}>
                <span>{v.note || "No description"}</span>
                <span className={s.versionMeta}>Published {timeAgo(v.publishedAt)}</span>
              </span>
              {i === 0 ? (
                <Tag tone="live">
                  <span className={ui.dot} />
                  Live
                </Tag>
              ) : (
                <button className={btn("default", true)} disabled={busy !== null} onClick={() => void restore(v.version)}>
                  {busy === v.version ? "Copying…" : "Copy to draft"}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
