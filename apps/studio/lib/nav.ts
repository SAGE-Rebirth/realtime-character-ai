/**
 * Studio information architecture: every feature on the roadmap has a home from day one.
 * `phase` marks sections that are planned but not built yet; they show what's coming instead of a dead link.
 */
export interface NavItem {
  href: string;
  label: string;
  /** Short description used on planned pages and as the tooltip. */
  hint: string;
  phase?: number;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Build",
    items: [
      { href: "/agents", label: "Agents", hint: "Create characters: persona, voice, look and knowledge" },
      { href: "/avatars", label: "Avatars", hint: "The bodies your agents perform with" },
      { href: "/voices", label: "Voices", hint: "Listen to and pick voices" },
      { href: "/knowledge", label: "Knowledge", hint: "Documents your agents can answer from" },
    ],
  },
  {
    label: "Test",
    items: [{ href: "/playground", label: "Playground", hint: "Talk to any agent with performance readouts" }],
  },
  {
    label: "Connect",
    items: [
      { href: "/tools", label: "Tools", hint: "Let agents look things up and take actions", phase: 3 },
      { href: "/embed", label: "Embed and API", hint: "Put an agent on your website or app", phase: 3 },
    ],
  },
  {
    label: "Operate",
    items: [
      { href: "/conversations", label: "Conversations", hint: "Transcripts and outcomes of past sessions", phase: 6 },
      { href: "/safety", label: "Safety", hint: "Rules every agent follows, and audience settings" },
      { href: "/usage", label: "Usage", hint: "Minutes, quotas and cost", phase: 6 },
    ],
  },
];

export const SETTINGS: NavItem = { href: "/settings", label: "Settings", hint: "Model, keys and workspace" };

/** Sub-panels of the agent editor, in the order a person usually works through them. */
export interface EditorPanel {
  slug: string;
  label: string;
  hint: string;
  phase?: number;
}

export const EDITOR_PANELS: EditorPanel[] = [
  { slug: "", label: "Profile", hint: "Name, role, greeting and language" },
  { slug: "personality", label: "Personality", hint: "Instructions and tone" },
  { slug: "voice", label: "Voice", hint: "How the agent sounds" },
  { slug: "appearance", label: "Appearance", hint: "Avatar and camera" },
  { slug: "knowledge", label: "Knowledge", hint: "Web search and documents" },
  { slug: "memory", label: "Memory", hint: "Remembering returning users", phase: 2 },
  { slug: "tools", label: "Tools", hint: "Actions the agent can take", phase: 3 },
  { slug: "safety", label: "Safety", hint: "Audience and platform rules" },
  { slug: "versions", label: "Versions", hint: "Publish and roll back" },
  { slug: "embed", label: "Embed", hint: "Use this agent on a site", phase: 3 },
];
