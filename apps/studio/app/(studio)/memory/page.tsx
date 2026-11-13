"use client";

/** Memory: everything agents have saved about visitors, across the workspace. */
import type { AgentSummary, MemoryItem } from "@metaavatar/protocol";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { btn, Notice, PageHeader, Section, Tag, ui } from "@/components/ui";
import { useUndo } from "@/components/Undo";
import { api, timeAgo, visitorId } from "@/lib/api";
import s from "./memory.module.css";

export default function MemoryPage() {
  const offerUndo = useUndo();
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const me = typeof window === "undefined" ? undefined : visitorId();

  const load = useCallback(() => {
    api
      .allMemories()
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    document.title = "Memory · MetaAvatar Studio";
    load();
    api.agents().then(setAgents).catch(() => undefined);
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const visible = useMemo(
    () => (items ?? []).filter((m) => !hidden.has(m.id) && (!agentFilter || m.agentId === agentFilter)),
    [items, hidden, agentFilter],
  );
  // One group per agent and visitor, newest note first.
  const groups = useMemo(() => {
    const map = new Map<string, MemoryItem[]>();
    for (const m of visible) map.set(`${m.agentId}\n${m.endUser}`, [...(map.get(`${m.agentId}\n${m.endUser}`) ?? []), m]);
    return [...map.entries()];
  }, [visible]);

  const forget = (list: MemoryItem[], message: string) => {
    const ids = list.map((m) => m.id);
    setHidden((h) => new Set([...h, ...ids]));
    offerUndo({
      message,
      undo: () => setHidden((h) => new Set([...h].filter((id) => !ids.includes(id)))),
      commit: async () => {
        await Promise.all(ids.map((id) => api.deleteMemory(id)));
        load();
      },
      onError: (e) => setError(e.message),
    });
  };

  const withMemory = agents.filter((a) => items?.some((m) => m.agentId === a.id));

  return (
    <div className={s.page}>
      <PageHeader
        title="Memory"
        lead="Everything your agents have saved about visitors. Each visitor is a random id from their browser, not a name. Remove anything that shouldn't be kept."
      />
      {error && <Notice error>{error}</Notice>}
      {items && items.length > 0 && (
        <div className={s.filters}>
          <select className={ui.select} value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} aria-label="Show memories for">
            <option value="">All agents ({items.length})</option>
            {withMemory.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({items.filter((m) => m.agentId === a.id).length})
              </option>
            ))}
          </select>
        </div>
      )}
      {!items && !error && <p className={ui.help}>Loading memories…</p>}
      {items && groups.length === 0 && (
        <Section title="Nothing remembered yet">
          <p className={ui.help}>
            An agent only remembers when memory is switched on for it. Open an agent, go to <strong>Memory</strong>, turn
            on <em>Remember returning visitors</em>, then talk to it and mention something about yourself.
          </p>
          <div>
            <Link href="/agents" className={btn("default", true)}>
              Go to agents
            </Link>
          </div>
        </Section>
      )}
      {groups.map(([key, list]) => {
        const first = list[0]!;
        return (
          <Section key={key} title={agentName(first.agentId)}>
            <div className={s.groupHead}>
              <span className={s.visitor}>
                <code>{first.endUser}</code>
                {first.endUser === me && <Tag tone="live">You, in this browser</Tag>}
              </span>
              <span className={s.groupActions}>
                <Link href={`/agents/${first.agentId}/memory`} className={btn("quiet", true)}>
                  Agent settings
                </Link>
                <button
                  className={btn("danger", true)}
                  onClick={() => forget(list, `Forgot ${list.length} ${list.length === 1 ? "note" : "notes"} about this visitor`)}
                >
                  Forget this visitor
                </button>
              </span>
            </div>
            <ul className={s.notes}>
              {list.map((m) => (
                <li key={m.id}>
                  <span>{m.text}</span>
                  <span className={s.when}>{timeAgo(m.createdAt)}</span>
                  <button className={btn("quiet", true)} onClick={() => forget([m], "Forgot one note")} aria-label={`Forget: ${m.text}`}>
                    Forget
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        );
      })}
    </div>
  );
}
