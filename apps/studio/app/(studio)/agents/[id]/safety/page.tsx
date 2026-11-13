"use client";

import { Notice, Section, ui } from "@/components/ui";
import { AUDIENCES, PLATFORM_RULES } from "@/lib/safety";
import { useEditor } from "../editor";
import s from "../panels.module.css";

export default function SafetyPanel() {
  const { draft, update } = useEditor();
  return (
    <>
      <Section title="Audience" help="Who will talk to this agent. Younger audiences get stricter rules on top of the platform rules.">
        <fieldset className={s.choices}>
          <legend className={s.srOnly}>Audience</legend>
          {AUDIENCES.map((a) => (
            <label key={a.value} className={s.choice} data-checked={draft.audience === a.value}>
              <input
                type="radio"
                name="audience"
                checked={draft.audience === a.value}
                onChange={() => update({ audience: a.value })}
              />
              <span className={s.choiceTitle}>{a.label}</span>
              <span className={s.choiceText}>{a.summary}</span>
            </label>
          ))}
        </fieldset>
        {draft.audience !== "general" && (
          <Notice>
            The Gemini free tier is for adults only (its terms require users to be 18 or over). Test teen and
            children's agents yourself, but don't put them in front of young people until the workspace uses a
            paid plan with the right agreements.
          </Notice>
        )}
      </Section>
      <Section title="Platform rules" help="Every agent follows these, before its own instructions. They can't be turned off.">
        <ul className={s.rules}>
          {PLATFORM_RULES.map(([k, v]) => (
            <li key={k}>
              <strong>{k}</strong>
              <span className={ui.help}>{v}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
