/**
 * Shared wire protocol between the agent worker (Python) and the avatar runtime (browser).
 * Source of truth: these Zod schemas. Python models are generated from the emitted JSON Schema
 * (`pnpm gen:protocol`), so never edit `protocol_models.py` by hand.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
/** LiveKit data-channel topic for avatar events. */
export const AVATAR_TOPIC = "avatar.v1" as const;

// ---------------------------------------------------------------------------
// Agent configuration (what Studio edits, what the worker loads at session start)
// ---------------------------------------------------------------------------

export const AudienceProfile = z.enum(["general", "teen", "kids"]).meta({ title: "AudienceProfile" });
export type AudienceProfile = z.infer<typeof AudienceProfile>;

export const AvatarRef = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("vrm"),
    /** URL of a VRM 0.x / 1.0 model. */
    url: z.string(),
  }).meta({ title: "VrmAvatarRef" }),
  z.object({
    kind: z.literal("procedural"),
    /** Built-in placeholder avatar, used when no model file is available. */
    style: z.enum(["default"]).default("default"),
  }).meta({ title: "ProceduralAvatarRef" }),
]);
export type AvatarRef = z.infer<typeof AvatarRef>;

/**
 * Personality dials shown as sliders in Studio, each 0..1. The worker turns them into plain-language
 * guidance after the tenant's own instructions, so they shape tone without rewriting the persona.
 */
export const PersonaStyle = z.object({
  /** 0 reserved, 1 warm and encouraging. */
  warmth: z.number().min(0).max(1).default(0.6),
  /** 0 casual, 1 formal. */
  formality: z.number().min(0).max(1).default(0.4),
  /** 0 very brief, 1 detailed. */
  detail: z.number().min(0).max(1).default(0.3),
  /** 0 serious, 1 playful. */
  humor: z.number().min(0).max(1).default(0.3),
}).meta({ title: "PersonaStyle" });
export type PersonaStyle = z.infer<typeof PersonaStyle>;

export const Framing = z.enum(["portrait", "upper", "full"]).meta({ title: "Framing" });
export type Framing = z.infer<typeof Framing>;

export const AgentConfig = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  /** One line saying what this agent is for, e.g. "Maths tutor for ages 12-14". */
  role: z.string().max(140).default(""),
  /** Persona instructions written by the tenant. The platform safety preamble is added by the worker. */
  instructions: z.string().max(20_000),
  /** Optional first line the agent says when the session starts. */
  greeting: z.string().max(500).optional(),
  /** Gemini prebuilt voice name, e.g. "Kore", "Puck". */
  voice: z.string().default("Kore"),
  /** BCP-47 language code. */
  language: z.string().default("en-US"),
  audience: AudienceProfile.default("general"),
  renderer: z.enum(["3d"]).default("3d"),
  avatar: AvatarRef,
  /** Default camera framing for this agent's avatar. */
  framing: Framing.default("upper"),
  style: PersonaStyle.default({ warmth: 0.6, formality: 0.4, detail: 0.3, humor: 0.3 }),
  /** Allow Google Search grounding. */
  groundingSearch: z.boolean().default(false),
  /** Ids of knowledge-base documents this agent answers from (see KnowledgeDoc). */
  knowledge: z.array(z.string()).max(50).default([]),
  /** Remember facts about returning visitors between conversations. Never on for the kids audience. */
  memory: z.boolean().default(false),
});
export type AgentConfig = z.infer<typeof AgentConfig>;
/** What Studio sends when editing: everything except the id, which the API owns. */
export const AgentDraft = AgentConfig.omit({ id: true });
export type AgentDraft = z.infer<typeof AgentDraft>;

// ---------------------------------------------------------------------------
// Voices: Gemini Live prebuilt voices, with the character Google describes for each
// ---------------------------------------------------------------------------

export interface VoiceInfo {
  name: string;
  /** One or two words describing how it sounds. */
  character: string;
}

export const VOICES: readonly VoiceInfo[] = [
  { name: "Zephyr", character: "Bright" },
  { name: "Puck", character: "Upbeat" },
  { name: "Charon", character: "Informative" },
  { name: "Kore", character: "Firm" },
  { name: "Fenrir", character: "Excitable" },
  { name: "Leda", character: "Youthful" },
  { name: "Orus", character: "Firm" },
  { name: "Aoede", character: "Breezy" },
  { name: "Callirrhoe", character: "Easy-going" },
  { name: "Autonoe", character: "Bright" },
  { name: "Enceladus", character: "Breathy" },
  { name: "Iapetus", character: "Clear" },
  { name: "Umbriel", character: "Easy-going" },
  { name: "Algieba", character: "Smooth" },
  { name: "Despina", character: "Smooth" },
  { name: "Erinome", character: "Clear" },
  { name: "Algenib", character: "Gravelly" },
  { name: "Rasalgethi", character: "Informative" },
  { name: "Laomedeia", character: "Upbeat" },
  { name: "Achernar", character: "Soft" },
  { name: "Alnilam", character: "Firm" },
  { name: "Schedar", character: "Even" },
  { name: "Gacrux", character: "Mature" },
  { name: "Pulcherrima", character: "Forward" },
  { name: "Achird", character: "Friendly" },
  { name: "Zubenelgenubi", character: "Casual" },
  { name: "Vindemiatrix", character: "Gentle" },
  { name: "Sadachbia", character: "Lively" },
  { name: "Sadaltager", character: "Knowledgeable" },
  { name: "Sulafat", character: "Warm" },
];

/** Languages offered in Studio (BCP-47). Gemini Live detects and speaks many more. */
export const LANGUAGES: readonly { code: string; label: string }[] = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "en-IN", label: "English (India)" },
  { code: "hi-IN", label: "Hindi" },
  { code: "es-ES", label: "Spanish" },
  { code: "fr-FR", label: "French" },
  { code: "de-DE", label: "German" },
  { code: "it-IT", label: "Italian" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "ja-JP", label: "Japanese" },
  { code: "ko-KR", label: "Korean" },
  { code: "ar-XA", label: "Arabic" },
  { code: "ta-IN", label: "Tamil" },
  { code: "bn-IN", label: "Bengali" },
];

// ---------------------------------------------------------------------------
// Studio API: agents with a working draft and published versions
// ---------------------------------------------------------------------------

export interface AgentVersionMeta {
  version: number;
  /** When this version was saved. */
  publishedAt: string;
  note: string;
  /** The version visitors get. Exactly one version is live once anything has been published. */
  live: boolean;
}

export interface AgentSummary {
  id: string;
  name: string;
  role: string;
  voice: string;
  avatar: AvatarRef;
  /** The live version (what visitors get), or null if nothing is live yet. */
  publishedVersion: number | null;
  /** The draft differs from the latest published version. */
  hasUnpublishedChanges: boolean;
  updatedAt: string;
}

export interface AgentDetail extends AgentSummary {
  draft: AgentConfig;
  published: AgentConfig | null;
  versions: AgentVersionMeta[];
}

export const PublishRequest = z.object({ note: z.string().max(280).default("") });

/** Starting points offered when creating an agent. */
export interface AgentTemplate {
  id: string;
  title: string;
  summary: string;
}

// ---------------------------------------------------------------------------
// Knowledge base: documents agents answer from
// ---------------------------------------------------------------------------

export interface KnowledgeDoc {
  id: string;
  title: string;
  kind: "file" | "url" | "text";
  /** File name or URL the text came from; empty for pasted text. */
  origin: string;
  status: "processing" | "ready" | "failed";
  /** Plain-language reason when status is "failed". */
  error?: string;
  chunks: number;
  chars: number;
  /** True when every chunk has an embedding; otherwise search matches on words only. */
  embedded: boolean;
  addedAt: string;
}

export const KnowledgeTextRequest = z.object({
  title: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(2_000_000),
});
export const KnowledgeUrlRequest = z.object({ url: z.url().max(2000) });
export const KnowledgeSearchRequest = z.object({
  query: z.string().trim().min(1).max(1000),
  /** Limit the search to these documents; omit to search the whole library. */
  documentIds: z.array(z.string()).max(50).optional(),
  limit: z.number().int().min(1).max(10).default(4),
});
export type KnowledgeSearchRequest = z.infer<typeof KnowledgeSearchRequest>;

export interface KnowledgePassage {
  documentId: string;
  title: string;
  /** Position of the passage within its document, from 0. */
  chunk: number;
  text: string;
  /** Relative strength of the match in (0, 1]; 1 is the best possible. */
  score: number;
}

export interface KnowledgeSearchResponse {
  passages: KnowledgePassage[];
  /** "meaning" used embeddings; "words" fell back to word matching only. */
  mode: "meaning" | "words";
}

// ---------------------------------------------------------------------------
// Memory: what an agent remembers about one visitor between conversations
// ---------------------------------------------------------------------------

export interface MemoryItem {
  id: string;
  agentId: string;
  /** Pseudonymous visitor reference (CreateSessionRequest.endUserRef). */
  endUser: string;
  text: string;
  createdAt: string;
}

const memoryOwner = { agentId: z.string().min(1).max(100), endUser: z.string().min(1).max(200) };
export const MemoryAddRequest = z.object({ ...memoryOwner, text: z.string().trim().min(1).max(300) });
export const MemorySearchRequest = z.object({
  ...memoryOwner,
  query: z.string().trim().max(300).default(""),
  limit: z.number().int().min(1).max(20).default(6),
});

// ---------------------------------------------------------------------------
// Data-channel events (worker -> runtime)
// ---------------------------------------------------------------------------

export const AgentState = z.enum(["initializing", "listening", "thinking", "speaking", "idle"]).meta({ title: "AgentState" });
export type AgentState = z.infer<typeof AgentState>;

export const Emotion = z.enum(["neutral", "happy", "sad", "angry", "surprised", "relaxed", "thinking"]).meta({ title: "Emotion" });
export type Emotion = z.infer<typeof Emotion>;

export const Gesture = z.enum([
  "none",
  "wave",
  "nod",
  "shake_head",
  "shrug",
  "explain",
  "point",
  "celebrate",
  "think",
]).meta({ title: "Gesture" });
export type Gesture = z.infer<typeof Gesture>;

const base = { v: z.literal(PROTOCOL_VERSION), ts: z.number().describe("Sender clock, ms since epoch") };

export const AgentStateEvent = z.object({ ...base, type: z.literal("agent.state"), state: AgentState }).meta({ title: "AgentStateEvent" });
export const EmotionEvent = z.object({
  ...base,
  type: z.literal("agent.emotion"),
  emotion: Emotion,
  intensity: z.number().min(0).max(1).default(0.7),
}).meta({ title: "EmotionEvent" });
export const GestureEvent = z.object({
  ...base,
  type: z.literal("agent.gesture"),
  gesture: Gesture,
  intensity: z.number().min(0).max(1).default(0.7),
}).meta({ title: "GestureEvent" });
/** Agent stopped talking because the user interrupted: drop queued audio, close the mouth. */
export const FlushEvent = z.object({ ...base, type: z.literal("agent.flush") }).meta({ title: "FlushEvent" });
export const TranscriptEvent = z.object({
  ...base,
  type: z.literal("transcript"),
  role: z.enum(["user", "agent"]),
  text: z.string(),
  final: z.boolean(),
}).meta({ title: "TranscriptEvent" });
export const SessionWarningEvent = z.object({
  ...base,
  type: z.literal("session.warning"),
  code: z.enum(["reconnecting", "quota", "safety", "ending"]),
  message: z.string(),
}).meta({ title: "SessionWarningEvent" });

/** Where an answer came from, shown under the captions. */
export const Source = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["document", "web"]),
  url: z.string().optional(),
}).meta({ title: "Source" });
export type Source = z.infer<typeof Source>;
export const SourcesEvent = z.object({
  ...base,
  type: z.literal("agent.sources"),
  sources: z.array(Source).max(8),
}).meta({ title: "SourcesEvent" });

export const AvatarEvent = z.discriminatedUnion("type", [
  AgentStateEvent,
  EmotionEvent,
  GestureEvent,
  FlushEvent,
  TranscriptEvent,
  SessionWarningEvent,
  SourcesEvent,
]);
export type AvatarEvent = z.infer<typeof AvatarEvent>;

// ---------------------------------------------------------------------------
// Session API (studio/embed -> platform API)
// ---------------------------------------------------------------------------

export const CreateSessionRequest = z.object({
  agentId: z.string().min(1),
  /** Studio tests the draft; embeds and apps talk to the published version. */
  version: z.enum(["draft", "published"]).default("published"),
  /** Pseudonymous end-user reference supplied by the embedding site. */
  endUserRef: z.string().max(200).optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

export const CreateSessionResponse = z.object({
  sessionId: z.string(),
  livekitUrl: z.string(),
  token: z.string(),
  agent: AgentConfig.pick({ id: true, name: true, renderer: true, avatar: true }),
});
export type CreateSessionResponse = z.infer<typeof CreateSessionResponse>;

/** Encode an event for the data channel. */
export function encodeEvent(event: AvatarEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(AvatarEvent.parse(event)));
}

/** Decode a data-channel payload; returns null for anything malformed or from a newer protocol. */
export function decodeEvent(payload: Uint8Array): AvatarEvent | null {
  try {
    const parsed = AvatarEvent.safeParse(JSON.parse(new TextDecoder().decode(payload)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
