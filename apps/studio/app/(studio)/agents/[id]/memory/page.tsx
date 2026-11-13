import { Planned } from "@/components/ui";

export default function MemoryPanel() {
  return (
    <Planned inline
      title="Memory"
      lead="Let the agent remember returning visitors, with their permission."
      phase={2}
      items={[
        ["Opt-in per agent", "Off by default. You choose which agents remember anything."],
        ["What it keeps", "Short summaries after each conversation, such as preferences and progress."],
        ["Visitor control", "Visitors can ask the agent to forget them, and it does."],
        ["Never for children", "Memory stays off for agents set to the kids audience."],
      ]}
    />
  );
}
