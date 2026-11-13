"use client";

import { Planned } from "@/components/ui";
import { useEditor } from "../editor";

export default function EmbedPanel() {
  const { agent } = useEditor();
  return (
    <Planned inline
      title="Embed"
      lead="Put this agent on your website or in your app."
      phase={3}
      items={[
        ["Website snippet", "One line of HTML adds the agent to any page, restricted to your domains."],
        ["React component", "Drop the agent into a React app with a single component."],
        ["Meetings", "The agent joins Google Meet, Zoom or Teams calls as a participant."],
        ["Published only", "Visitors always get the latest published version, never your draft."],
      ]}
      today={
        <>
          Agent ID for the API: <code>{agent.id}</code>
        </>
      }
    />
  );
}
