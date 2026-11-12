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

export const AgentConfig = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
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
  /** Allow Google Search grounding. */
  groundingSearch: z.boolean().default(false),
});
export type AgentConfig = z.infer<typeof AgentConfig>;

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

export const AvatarEvent = z.discriminatedUnion("type", [
  AgentStateEvent,
  EmotionEvent,
  GestureEvent,
  FlushEvent,
  TranscriptEvent,
  SessionWarningEvent,
]);
export type AvatarEvent = z.infer<typeof AvatarEvent>;

// ---------------------------------------------------------------------------
// Session API (studio/embed -> platform API)
// ---------------------------------------------------------------------------

export const CreateSessionRequest = z.object({
  agentId: z.string().min(1),
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
