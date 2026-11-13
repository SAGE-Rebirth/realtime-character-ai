import { Planned } from "@/components/ui";

export const metadata = { title: "Usage" };

export default function UsagePage() {
  return (
    <Planned
      title="Usage"
      lead="Conversation minutes, quotas and cost."
      phase={6}
      items={[
        ["Minutes by agent", "How much each agent is used, by day."],
        ["Quota warnings", "Notice before free-tier limits run out, not after."],
        ["Cost per minute", "What a minute of conversation costs on your plan."],
      ]}
      today="This workspace runs on the Gemini free tier with self-hosted LiveKit, so conversations cost nothing; Google's daily limits apply."
    />
  );
}
