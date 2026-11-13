import { Planned } from "@/components/ui";

export const metadata = { title: "Conversations" };

export default function ConversationsPage() {
  return (
    <Planned
      title="Conversations"
      lead="See what visitors talked about with your agents, and how it went."
      phase={6}
      items={[
        ["Transcripts", "Every conversation with timestamps, searchable by agent and date."],
        ["Outcomes", "Which conversations ended well, were handed to a person, or hit a safety rule."],
        ["Privacy controls", "Retention periods and deletion on request."],
      ]}
    />
  );
}
