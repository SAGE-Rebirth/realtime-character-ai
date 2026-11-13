"use client";

import type { MemoryItem } from "@metaavatar/protocol";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { btn, Notice, Section, Toggle, ui } from "@/components/ui";
import { api, timeAgo, visitorId } from "@/lib/api";
import { useEditor } from "../editor";
import s from "../panels.module.css";

export default function MemoryPanel() {
  const { agent, draft, update } = useEditor();
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kids = draft.audience === "kids";
  const me = typeof window === "undefined" ? undefined : visitorId();

  const load = useCallback(() => {
    if (!me) return setItems([]);
    api
      .memories(agent.id, me)
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, [agent.id, me]);
  // Notes are added during conversations on the stage beside this panel, so keep the list fresh.
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    await work().catch((e: Error) => setError(e.message));
    load();
  };

  return (
    <>
      <Section
        title="Memory"
        help="Let this agent remember useful things about a returning visitor, such as their name or what they were working on, and use them in the next conversation."
      >
        <Toggle
          id="memory"
          label="Remember returning visitors"
          help="The agent saves a short note when it learns something worth keeping, and reads its notes when the same visitor comes back. Visitors can ask it to forget."
          checked={draft.memory && !kids}
          onChange={(memory) => !kids && update({ memory })}
        />
        {kids && (
          <Notice>
            Memory is always off for children's agents: they never keep personal details. Change the audience under
            Safety to use memory.
          </Notice>
        )}
        {draft.memory && !kids && (
          <Notice>
            Tell visitors that the agent remembers them, and how to have it forget. Notes are kept per agent and per
            visitor, and are deleted with the agent.
          </Notice>
        )}
      </Section>

      <Section
        title="What it remembers about you"
        help={
          <>
            Notes this agent has saved while talking to you in this browser. Every visitor's notes, for all agents, are
            under <Link href="/memory">Memory</Link> in the main menu.
          </>
        }
      >
        {error && <Notice error>{error}</Notice>}
        {!items && !error && <p className={ui.help}>Loading…</p>}
        {items && items.length === 0 && (
          <p className={ui.help}>
            {draft.memory && !kids
              ? "Nothing yet. Start a conversation and tell it something about yourself, for example your name."
              : "Nothing. Memory is off for this agent."}
          </p>
        )}
        {items && items.length > 0 && (
          <>
            <ul className={s.memories}>
              {items.map((m) => (
                <li key={m.id}>
                  <span>{m.text}</span>
                  <span className={s.versionMeta}>{timeAgo(m.createdAt)}</span>
                  <button className={btn("quiet", true)} onClick={() => void act(() => api.deleteMemory(m.id))} aria-label={`Forget: ${m.text}`}>
                    Forget
                  </button>
                </li>
              ))}
            </ul>
            <div>
              <button
                className={btn("danger", true)}
                onClick={() => {
                  if (me && window.confirm("Forget everything this agent remembers about you?")) void act(() => api.forgetMe(agent.id, me));
                }}
              >
                Forget everything
              </button>
            </div>
          </>
        )}
      </Section>
    </>
  );
}
