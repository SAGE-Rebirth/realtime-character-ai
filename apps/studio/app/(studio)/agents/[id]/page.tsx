"use client";

import { LANGUAGES } from "@metaavatar/protocol";
import { Field, Section, ui } from "@/components/ui";
import { useEditor } from "./editor";

export default function ProfilePanel() {
  const { draft, update } = useEditor();
  return (
    <>
      <Section title="Profile" help="Who this agent is and how it opens the conversation.">
        <Field label="Name" htmlFor="name" help="The agent uses this name when it introduces itself.">
          <input
            id="name"
            className={ui.input}
            value={draft.name}
            maxLength={80}
            onChange={(e) => update({ name: e.target.value })}
          />
        </Field>
        <Field
          label="Role"
          htmlFor="role"
          help="One line on what the agent is for. It shapes answers and helps your team tell agents apart."
          counter={`${draft.role.length} / 140`}
        >
          <input
            id="role"
            className={ui.input}
            value={draft.role}
            maxLength={140}
            placeholder="For example: maths tutor for ages 12 to 14"
            onChange={(e) => update({ role: e.target.value })}
          />
        </Field>
        <Field
          label="Greeting"
          htmlFor="greeting"
          help="What the agent says first when a conversation starts. Leave empty to let the visitor speak first."
          counter={`${(draft.greeting ?? "").length} / 500`}
        >
          <input
            id="greeting"
            className={ui.input}
            value={draft.greeting ?? ""}
            maxLength={500}
            onChange={(e) => update({ greeting: e.target.value || undefined })}
          />
        </Field>
        <Field
          label="Language"
          htmlFor="language"
          help="The language the agent starts in. It switches if a visitor speaks another language."
        >
          <select
            id="language"
            className={ui.select}
            value={draft.language}
            onChange={(e) => update({ language: e.target.value })}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
      </Section>
    </>
  );
}
