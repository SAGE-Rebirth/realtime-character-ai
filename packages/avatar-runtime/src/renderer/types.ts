/**
 * AvatarRenderer: the seam between "what the agent is doing" and "what the viewer sees".
 *
 * AvatarRuntime owns the session, the agent's audio and lip-sync analysis, and calls a renderer once
 * per display frame. Two implementations are planned:
 *   - ThreeRenderer (now): a 3D avatar rendered on the viewer's device and animated from visemes,
 *     agent state, emotions and gestures.
 *   - Neural renderer (stage N1): our Neural Avatar Engine renders video on a GPU worker and publishes
 *     it to the room; the renderer only displays that track (`attachAgentVideo`) and ignores visemes,
 *     because lips are already in the pixels.
 */
import type { AgentState, AvatarRef, Emotion, Gesture } from "@metaavatar/protocol";
import type { Visemes } from "../audio/visemes";
import type { Framing } from "../scene";

export type { Framing };
export type RendererKind = "3d" | "neural";

export interface RenderFrame {
  /** Seconds since the previous frame (clamped). */
  dt: number;
  /** Mouth shapes for the agent's voice at this instant. */
  visemes: Visemes;
  /** Loudness of the agent's voice in [0, 1]; drives beat gestures and head motion. */
  energy: number;
}

export interface AvatarRenderer {
  readonly kind: RendererKind;

  /** Load (or swap to) an avatar. Resolves when it is visible. */
  setAvatar(ref: AvatarRef, onProgress?: (fraction: number) => void): Promise<void>;
  setFraming(framing: Framing): void;

  setAgentState(state: AgentState): void;
  /** `holdSec`: how long the expression stays before easing back to neutral (default 4). */
  setEmotion(emotion: Emotion, intensity?: number, holdSec?: number): void;
  playGesture(gesture: Gesture, intensity?: number): void;
  /** The user barged in: stop gesturing and close the mouth now. */
  interrupt(): void;
  /** Where the user is on screen, [-1, 1] each axis, or null for "look at the camera". */
  setLookTarget(target: { x: number; y: number } | null): void;

  /** Draw one frame. Called from the runtime's requestAnimationFrame loop. */
  render(frame: RenderFrame): void;

  /** Neural renderers display video the agent publishes; 3D renderers don't implement this. */
  attachAgentVideo?(track: MediaStreamTrack | null): void;

  /** A still picture of the avatar as a PNG data URL (for thumbnails), in the given framing. */
  capture?(framing?: Framing): string;

  /** Development aid: average and worst cost per frame in ms, unaffected by tab throttling. */
  benchmark?(frames: number): { avgMs: number; maxMs: number };

  dispose(): void;
}
