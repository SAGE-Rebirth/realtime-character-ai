"use client";

import { useEffect, useState } from "react";
import { Notice, PageHeader, Section, Tag } from "@/components/ui";
import { API_URL, api, type Workspace } from "@/lib/api";
import s from "./settings.module.css";

function Row({ label, value, help }: { label: string; value: React.ReactNode; help?: string }) {
  return (
    <div className={s.row}>
      <dt>
        {label}
        {help && <span className={s.help}>{help}</span>}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

export default function SettingsPage() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Settings · MetaAvatar Studio";
    api
      .workspace()
      .then(setWs)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className={s.page}>
      <PageHeader
        title="Settings"
        lead={
          <>
            How this workspace talks to Gemini and LiveKit. To change a value, edit <code>.env</code> in the project
            folder, then run <code>make restart</code>.
          </>
        }
      />
      {error && <Notice error>{error}</Notice>}
      {ws && (
        <>
          <Section title="AI model">
            <dl className={s.list}>
              <Row
                label="Gemini key"
                value={ws.geminiKeyConfigured ? <Tag tone="live">Set</Tag> : <Tag tone="warn">Missing</Tag>}
                help="LIVE_MODEL_API_KEY. Run make key to test it."
              />
              <Row label="Live model" value={<code>{ws.model}</code>} help="GEMINI_LIVE_MODEL" />
              <Row label="API version" value={<code>{ws.apiVersion}</code>} help="GEMINI_API_VERSION" />
              <Row
                label="Thinking before replies"
                value={ws.thinkingLevel}
                help="GEMINI_THINKING_LEVEL. Minimal is fastest."
              />
              <Row
                label="End-of-turn pause"
                value={`${ws.turnSilenceMs} ms`}
                help="TURN_SILENCE_MS. Silence before the agent decides you've finished."
              />
            </dl>
          </Section>
          <Section title="Realtime and storage">
            <dl className={s.list}>
              <Row label="LiveKit server" value={<code>{ws.livekitUrl}</code>} help="LIVEKIT_URL" />
              <Row label="Platform API" value={<code>{API_URL}</code>} help="NEXT_PUBLIC_API_URL" />
              <Row label="Agents and documents" value={<code>{ws.dataDir ?? "In memory"}</code>} help="DATA_DIR" />
              <Row
                label="Avatar models"
                value={<code>{ws.avatarDir ?? "Off"}</code>}
                help="AVATAR_DIR. Every .vrm file in this folder appears under Avatars."
              />
              <Row
                label="Document search"
                value={ws.embedModel ? <code>{ws.embedModel}</code> : "Word matching only"}
                help="GEMINI_EMBED_MODEL. Finds passages by meaning; needs the Gemini key."
              />
            </dl>
          </Section>
          <Section title="Team and sign-in" help="Accounts, roles and multiple workspaces.">
            <p>
              <Tag>Coming later in phase 2</Tag>
            </p>
          </Section>
        </>
      )}
    </div>
  );
}
