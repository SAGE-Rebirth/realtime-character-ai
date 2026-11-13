"use client";

import VoicePicker from "@/components/VoicePicker";
import { Section } from "@/components/ui";
import { useEditor } from "../editor";

export default function VoicePanel() {
  const { draft, update } = useEditor();
  return (
    <Section
      title="Voice"
      help="Play a sample, then choose the voice that fits the character. Every voice can speak any of the supported languages."
    >
      <VoicePicker value={draft.voice} onChange={(voice) => update({ voice })} />
    </Section>
  );
}
