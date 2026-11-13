"use client";

import type { PersonaStyle } from "@metaavatar/protocol";
import { Field, Section, Slider, ui } from "@/components/ui";
import { useEditor } from "../editor";

/** Labels mirror the worker's style_guidance thresholds (services/agent-worker/agent_worker/safety.py). */
const band = (v: number, low: string, mid: string, high: string) => (v < 0.35 ? low : v > 0.65 ? high : mid);

const DIALS: {
  key: keyof PersonaStyle;
  label: string;
  ends: [string, string];
  describe: (v: number) => string;
}[] = [
  {
    key: "warmth",
    label: "Warmth",
    ends: ["Matter-of-fact", "Warm"],
    describe: (v) => band(v, "Calm and matter-of-fact", "Friendly", "Warm and encouraging"),
  },
  {
    key: "formality",
    label: "Formality",
    ends: ["Casual", "Formal"],
    describe: (v) => band(v, "Casual, like a friend", "Relaxed but polished", "Formal and professional"),
  },
  {
    key: "detail",
    label: "Reply length",
    ends: ["Brief", "Detailed"],
    describe: (v) => band(v, "One or two sentences", "Two or three sentences", "Fuller explanations"),
  },
  {
    key: "humor",
    label: "Humour",
    ends: ["Serious", "Playful"],
    describe: (v) => band(v, "Serious, no jokes", "A little light humour", "Playful"),
  },
];

export default function PersonalityPanel() {
  const { draft, update } = useEditor();
  const style = draft.style;
  return (
    <>
      <Section
        title="Instructions"
        help="Describe how the agent should behave, what it knows, and what it should avoid. Write it like a brief to a new colleague."
      >
        <Field label="Persona" htmlFor="instructions" counter={`${draft.instructions.length} / 20,000`}>
          <textarea
            id="instructions"
            className={ui.textarea}
            value={draft.instructions}
            maxLength={20000}
            placeholder="For example: You help customers of a bike shop choose the right bike. Ask about how they ride before recommending anything."
            onChange={(e) => update({ instructions: e.target.value })}
          />
        </Field>
      </Section>
      <Section
        title="Tone"
        help="Adjust how the agent comes across. These are added after your instructions, so they shape the tone without rewriting the persona."
      >
        {DIALS.map((d) => (
          <Slider
            key={d.key}
            id={`style-${d.key}`}
            label={d.label}
            value={style[d.key]}
            ends={d.ends}
            describe={d.describe}
            onChange={(v) => update({ style: { ...style, [d.key]: v } })}
          />
        ))}
      </Section>
    </>
  );
}
