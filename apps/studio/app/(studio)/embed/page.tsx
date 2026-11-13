import { Planned } from "@/components/ui";

export const metadata = { title: "Embed and API" };

export default function EmbedPage() {
  return (
    <Planned
      title="Embed and API"
      lead="Put agents on your website, in your app, or in your meetings."
      phase={3}
      items={[
        ["Website snippet", "One line of HTML, limited to the domains you allow."],
        ["React and JavaScript SDKs", "Build your own interface around an agent."],
        ["Public API and keys", "Start sessions from your server and identify your users safely."],
        ["Webhooks", "Get notified when a conversation ends or needs a person."],
        ["Meetings", "Agents join Google Meet, Zoom or Teams and appear as a camera."],
      ]}
      today="Today, sessions start through the local API (POST /sessions); the Playground uses it."
    />
  );
}
