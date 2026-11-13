import Link from "next/link";
import { Planned } from "@/components/ui";

export default function ToolsPanel() {
  return (
    <Planned inline
      title="Tools"
      lead="Let the agent take actions and look things up in your systems during a conversation."
      phase={3}
      items={[
        ["On-screen actions", "Show a card, a quiz question or a product while the agent talks."],
        ["Your APIs", "Call your backend, for example to check an order, and use the answer in the reply."],
        ["Connectors", "Connect services like calendars and help desks through MCP."],
        ["Confirm first", "Actions that change something ask the visitor before they run."],
      ]}
      today={
        <>
          Web search already works: turn it on under <Link href="./knowledge">Knowledge</Link>.
        </>
      }
    />
  );
}
