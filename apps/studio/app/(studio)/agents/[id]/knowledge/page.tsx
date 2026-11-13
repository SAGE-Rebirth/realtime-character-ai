"use client";

import Link from "next/link";
import { btn, Notice, Section, Tag, Toggle, ui } from "@/components/ui";
import { describeDoc, useKnowledge } from "@/lib/knowledge";
import k from "../../../knowledge/knowledge.module.css";
import { useEditor } from "../editor";

export default function KnowledgePanel() {
  const { draft, update } = useEditor();
  const { docs, error } = useKnowledge();
  const chosen = new Set(draft.knowledge);
  // Documents removed from the library since they were picked no longer count.
  const active = docs ? draft.knowledge.filter((id) => docs.some((d) => d.id === id)) : draft.knowledge;

  const toggle = (id: string, on: boolean) =>
    update({ knowledge: on ? [...active.filter((x) => x !== id), id] : active.filter((x) => x !== id) });

  return (
    <>
      <Section
        title="Documents"
        help="The agent looks things up in the documents you tick, answers from them, and the captions show which document it used. If the answer isn't there, it says so instead of guessing."
      >
        {error && <Notice error>{error}</Notice>}
        {!docs && !error && <p className={ui.help}>Loading documents…</p>}
        {docs && docs.length === 0 && (
          <Notice>
            The library is empty. <Link href="/knowledge">Add documents under Knowledge</Link>, then come back and tick
            the ones this agent should use.
          </Notice>
        )}
        {docs && docs.length > 0 && (
          <>
            <div>
              {docs.map((d) => {
                const usable = d.status === "ready";
                return (
                  <label key={d.id} className={k.pick} data-disabled={!usable}>
                    <input
                      type="checkbox"
                      checked={chosen.has(d.id)}
                      disabled={!usable && !chosen.has(d.id)}
                      onChange={(e) => toggle(d.id, e.target.checked)}
                    />
                    <span className={k.pickTitle}>
                      {d.title} {d.status === "processing" && <Tag>Reading</Tag>}
                      {d.status === "failed" && <Tag tone="warn">Couldn't read</Tag>}
                    </span>
                    <span className={k.pickMeta}>{describeDoc(d)}</span>
                  </label>
                );
              })}
            </div>
            <p className={ui.help}>
              {active.length === 0
                ? "No documents ticked: the agent answers from its persona only."
                : `${active.length} ${active.length === 1 ? "document" : "documents"} in use. Looking something up adds about a second to that answer.`}
            </p>
            <div>
              <Link href="/knowledge" className={btn("default", true)}>
                Manage library
              </Link>
            </div>
          </>
        )}
      </Section>
      <Section title="Web search" help="Let the agent look things up on Google when it needs current or specific facts.">
        <Toggle
          id="grounding"
          label="Search the web for answers"
          help="Good for news, prices and opening hours. Answers can take a moment longer when the agent searches."
          checked={draft.groundingSearch}
          onChange={(groundingSearch) => update({ groundingSearch })}
        />
      </Section>
    </>
  );
}
