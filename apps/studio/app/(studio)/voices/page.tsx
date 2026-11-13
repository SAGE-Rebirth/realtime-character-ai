import VoicePicker from "@/components/VoicePicker";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Voices" };

export default function VoicesPage() {
  return (
    <div style={{ maxWidth: 1080 }}>
      <PageHeader
        title="Voices"
        lead="Thirty voices from Gemini, each with its own character. Play a sample here, then choose one for an agent under its Voice settings."
      />
      <VoicePicker />
    </div>
  );
}
