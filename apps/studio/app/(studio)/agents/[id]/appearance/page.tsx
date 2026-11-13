"use client";

import type { Framing } from "@metaavatar/protocol";
import AvatarPicker from "@/components/AvatarPicker";
import GesturePad from "@/components/GesturePad";
import { Field, Section, Segmented } from "@/components/ui";
import { useEditor } from "../editor";

const FRAMINGS: { value: Framing; label: string }[] = [
  { value: "portrait", label: "Head and shoulders" },
  { value: "upper", label: "Waist up" },
  { value: "full", label: "Full body" },
];

export default function AppearancePanel() {
  const { draft, update, runtime } = useEditor();
  return (
    <>
      <Section title="Avatar" help="The body this agent performs with. Changes show on the stage straight away.">
        <AvatarPicker value={draft.avatar} onChange={(avatar) => update({ avatar })} />
      </Section>
      <Section title="Camera" help="How much of the avatar visitors see. Full body suits games and kiosks; head and shoulders suits video calls.">
        <Field label="Framing">
          <Segmented label="Framing" value={draft.framing} options={FRAMINGS} onChange={(framing) => update({ framing })} />
        </Field>
      </Section>
      <Section
        title="Body language"
        help="Play each gesture and expression on the stage to check how this avatar moves. In a conversation the agent picks them from what it is saying."
      >
        <GesturePad runtime={runtime} />
      </Section>
    </>
  );
}
