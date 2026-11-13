import { Planned } from "@/components/ui";

export const metadata = { title: "Tools and connectors" };

export default function ToolsPage() {
  return (
    <Planned
      title="Tools and connectors"
      lead="Let agents look things up and take actions in your systems while they talk."
      phase={3}
      items={[
        ["On-screen actions", "Show a card, a quiz question or a product image next to the avatar."],
        ["Your APIs", "Describe an endpoint once; agents call it and use the result in their reply."],
        ["Connectors", "Calendars, help desks and more through MCP, with sign-in per workspace."],
        ["Hand over to a person", "The agent passes the conversation to your team when it should."],
        ["Audit log", "Every action an agent takes is recorded."],
      ]}
    />
  );
}
