/**
 * AvatarRuntime: the public entry point. Owns the live connection to an agent, the agent's audio and
 * lip-sync analysis, and the frame loop. Drawing is delegated to an AvatarRenderer (3D today, our
 * neural engine later), so swapping renderers doesn't touch session or audio code.
 */
import type { AgentState, AvatarEvent, AvatarRef, Emotion, Gesture, Source } from "@metaavatar/protocol";
import { type Cue, CuePlanner } from "./animation/cues";
import { LipSyncAnalyser, type PlaybackMode } from "./audio/analyser";
import { ThreeRenderer } from "./renderer/three";
import type { AvatarRenderer } from "./renderer/types";
import type { Framing } from "./scene";
import { AgentConnection, type Caption } from "./session";

export interface RuntimeOptions {
  canvas: HTMLCanvasElement;
  avatar: AvatarRef;
  /** Defaults to the on-device 3D renderer. */
  renderer?: AvatarRenderer;
  framing?: Framing;
  playbackMode?: PlaybackMode;
  onLoadProgress?: (fraction: number) => void;
}

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";

export interface RuntimeMetrics {
  fps: number;
  frameMs: number;
  /** Estimated lips-vs-sound offset in ms (target <= 37). */
  avOffsetMs: number;
  /** Lip-sync analysis frames per second. */
  lipFrameRate: number;
  /** Last measured end of user speech -> first agent audio, in ms (approximate, client-side). */
  voiceToVoiceMs: number | null;
  agentState: AgentState;
  connection: ConnectionStatus;
  agentPresent: boolean;
  /** Microphone loudness in [0, 1], so the UI can show the user they're being heard. */
  micLevel: number;
}

type Listener<T> = (v: T) => void;
interface RuntimeEvents {
  state: AgentState;
  caption: Caption;
  connection: ConnectionStatus;
  event: AvatarEvent;
  error: Error;
  agentPresent: boolean;
  warning: { code: string; message: string };
  /** Documents or pages the answer being spoken draws on. */
  sources: Source[];
}

export class AvatarRuntime {
  private renderer: AvatarRenderer;
  private agentAudio: LipSyncAnalyser;
  private micAnalyser: LipSyncAnalyser | null = null;
  private conn: AgentConnection | null = null;
  private raf = 0;
  private last = performance.now();
  private listeners = new Map<keyof RuntimeEvents, Set<Listener<never>>>();
  private mirror = false;
  private cues = new CuePlanner();
  private metrics: RuntimeMetrics = {
    fps: 0,
    frameMs: 0,
    avOffsetMs: 0,
    lipFrameRate: 0,
    voiceToVoiceMs: null,
    agentState: "idle",
    connection: "idle",
    agentPresent: false,
    micLevel: 0,
  };
  private fpsFrames = 0;
  private fpsStart = performance.now();
  // Voice-to-voice measurement.
  private userSpeaking = false;
  private userQuietSince = 0;
  private userSpeechEndedAt: number | null = null;
  private agentSpeaking = false;

  private constructor(private opts: RuntimeOptions) {
    this.renderer = opts.renderer ?? new ThreeRenderer(opts.canvas, opts.framing ?? "upper");
    this.agentAudio = new LipSyncAnalyser(opts.playbackMode ?? "element");
  }

  static async create(opts: RuntimeOptions): Promise<AvatarRuntime> {
    const rt = new AvatarRuntime(opts);
    try {
      await rt.setAvatar(opts.avatar);
    } catch (e) {
      // Don't leave a renderer and an audio context behind when the model can't be loaded.
      await rt.dispose();
      throw e;
    }
    rt.loop();
    return rt;
  }

  // --- Events -------------------------------------------------------------------------------
  on<K extends keyof RuntimeEvents>(event: K, fn: Listener<RuntimeEvents[K]>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn as Listener<never>);
    return () => this.listeners.get(event)?.delete(fn as Listener<never>);
  }

  private emit<K extends keyof RuntimeEvents>(event: K, value: RuntimeEvents[K]): void {
    for (const fn of this.listeners.get(event) ?? []) (fn as Listener<RuntimeEvents[K]>)(value);
  }

  // --- Avatar -------------------------------------------------------------------------------
  get rendererKind(): AvatarRenderer["kind"] {
    return this.renderer.kind;
  }

  async setAvatar(ref: AvatarRef): Promise<void> {
    await this.renderer.setAvatar(ref, this.opts.onLoadProgress);
  }

  setFraming(f: Framing): void {
    this.renderer.setFraming(f);
  }

  playGesture(g: Gesture, intensity?: number): void {
    this.renderer.playGesture(g, intensity);
  }

  setEmotion(e: Emotion, intensity?: number, holdSec?: number): void {
    this.renderer.setEmotion(e, intensity, holdSec);
  }

  /** Where the user is on screen, [-1, 1] each axis (e.g. from the pointer or face tracking). */
  setLookTarget(t: { x: number; y: number } | null): void {
    this.renderer.setLookTarget(t);
  }

  // --- Live session ---------------------------------------------------------------------------
  /** Joins the agent's room. If the microphone can't be used, stays connected with `mic: false`. */
  async connect(url: string, token: string): Promise<{ mic: boolean; micError?: Error }> {
    await this.agentAudio.resume();
    this.conn = new AgentConnection({
      onAgentAudio: (track) => void this.agentAudio.attach(track, true),
      onAgentAudioEnded: () => this.agentAudio.detach(),
      onAgentVideo: (track) => this.renderer.attachAgentVideo?.(track),
      onEvent: (ev) => this.handleEvent(ev),
      onAgentState: (s) => this.setAgentState(s),
      onCaption: (c) => {
        this.cueFromCaption(c);
        this.emit("caption", c);
      },
      onConnection: (s) => {
        this.metrics.connection = s;
        this.emit("connection", s);
      },
      onAgentJoined: (j) => {
        this.metrics.agentPresent = j;
        this.emit("agentPresent", j);
      },
    });
    await this.conn.connect(url, token);
    try {
      const micTrack = await this.conn.setMicEnabled(true);
      if (micTrack) await this.attachMicAnalyser(micTrack);
      return { mic: true };
    } catch (e) {
      // Stay in the conversation without a mic: the user can still listen and type.
      return { mic: false, micError: e instanceof Error ? e : new Error(String(e)) };
    }
  }

  async setMicEnabled(on: boolean): Promise<void> {
    if (!this.conn) return;
    const track = await this.conn.setMicEnabled(on);
    if (track) await this.attachMicAnalyser(track);
    else this.micAnalyser?.detach();
  }

  /** Type to the agent instead of speaking. The message also appears as a user caption. */
  async sendText(text: string): Promise<void> {
    const msg = text.trim();
    if (!msg || !this.conn) return;
    await this.conn.sendText(msg);
    const typed: Caption = { id: `typed-${Date.now()}`, role: "user", text: msg, final: true };
    this.cueFromCaption(typed);
    this.emit("caption", typed);
  }

  async disconnect(): Promise<void> {
    await this.conn?.disconnect();
    this.conn = null;
    this.cues.reset();
    this.agentAudio.detach();
    this.micAnalyser?.detach();
    this.setAgentState("idle");
  }

  /**
   * Lip-sync test without any agent: the avatar mouths whatever the microphone hears.
   * Nothing is played back, so there is no feedback loop.
   */
  async startMirrorTest(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    await this.agentAudio.resume();
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error("No microphone track");
    await this.agentAudio.attach(track, false);
    this.mirror = true;
    this.setAgentState("speaking");
  }

  stopMirrorTest(): void {
    this.mirror = false;
    this.agentAudio.detach();
    this.setAgentState("idle");
  }

  private async attachMicAnalyser(track: MediaStreamTrack): Promise<void> {
    this.micAnalyser ??= new LipSyncAnalyser("element", 0, this.agentAudio.ctx);
    await this.micAnalyser.attach(track, false);
  }

  /** Body language that follows the conversation: see animation/cues.ts. */
  private cueFromCaption(c: Caption): void {
    const now = performance.now() / 1000;
    const cues: (Cue | null)[] =
      c.role === "agent" ? this.cues.onAgentText(c.id, c.text, c.final, now) : c.final ? [this.cues.onUserText(c.text, now)] : [];
    for (const cue of cues) {
      if (!cue) continue;
      if (cue.emotion) this.renderer.setEmotion(cue.emotion, 0.8, cue.hold);
      if (cue.gesture) this.renderer.playGesture(cue.gesture, 0.9);
    }
  }

  private handleEvent(ev: AvatarEvent): void {
    this.emit("event", ev);
    switch (ev.type) {
      case "agent.state":
        this.setAgentState(ev.state);
        break;
      case "agent.emotion":
        this.renderer.setEmotion(ev.emotion, ev.intensity);
        break;
      case "agent.gesture":
        this.renderer.playGesture(ev.gesture, ev.intensity);
        break;
      case "session.warning":
        this.emit("warning", { code: ev.code, message: ev.message });
        break;
      case "agent.sources":
        this.emit("sources", ev.sources);
        break;
      case "agent.flush":
        this.agentAudio.flush();
        this.renderer.interrupt();
        break;
      default:
        break;
    }
  }

  private setAgentState(s: AgentState): void {
    if (this.metrics.agentState === s) return;
    this.metrics.agentState = s;
    this.renderer.setAgentState(s);
    // While the agent works on an answer, show it on the face too (the pose already looks away).
    if (s === "thinking") this.renderer.setEmotion("thinking", 0.6, 2.5);
    this.emit("state", s);
  }

  // --- Frame loop -----------------------------------------------------------------------------
  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const t0 = performance.now();

    const visemes = this.agentAudio.update(dt);
    const energy = this.agentAudio.energy;
    this.trackLatency(now, energy, dt);
    this.metrics.micLevel = this.mirror ? energy : (this.micAnalyser?.energy ?? 0);

    this.renderer.render({ dt, visemes, energy });

    this.metrics.frameMs = this.metrics.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    this.fpsFrames++;
    if (now - this.fpsStart >= 1000) {
      this.metrics.fps = (this.fpsFrames * 1000) / (now - this.fpsStart);
      this.fpsFrames = 0;
      this.fpsStart = now;
      const s = this.agentAudio.getStats();
      this.metrics.avOffsetMs = s.avOffsetMs;
      this.metrics.lipFrameRate = s.frameRate;
    }
  };

  private trackLatency(now: number, agentEnergy: number, dt: number): void {
    if (this.mirror || !this.micAnalyser) return;
    this.micAnalyser.update(dt);
    const userEnergy = this.micAnalyser.energy;
    if (userEnergy > 0.25) {
      this.userSpeaking = true;
      this.userQuietSince = now;
    } else if (this.userSpeaking && now - this.userQuietSince > 300) {
      this.userSpeaking = false;
      this.userSpeechEndedAt = this.userQuietSince;
    }
    const agentNowSpeaking = agentEnergy > 0.08;
    if (agentNowSpeaking && !this.agentSpeaking && this.userSpeechEndedAt !== null) {
      this.metrics.voiceToVoiceMs = Math.round(now - this.userSpeechEndedAt);
      this.userSpeechEndedAt = null;
    }
    this.agentSpeaking = agentNowSpeaking;
  }

  /** A still picture of the avatar (PNG data URL), or null if this renderer can't take one. */
  capture(framing?: Framing): string | null {
    return this.renderer.capture?.(framing) ?? null;
  }

  /** Development aid: average cost per frame in ms, unaffected by background-tab throttling. */
  benchmark(frames = 120): { avgMs: number; maxMs: number } | null {
    return this.renderer.benchmark?.(frames) ?? null;
  }

  getMetrics(): RuntimeMetrics {
    return { ...this.metrics };
  }

  async dispose(): Promise<void> {
    cancelAnimationFrame(this.raf);
    await this.disconnect().catch(() => undefined);
    await this.micAnalyser?.dispose();
    await this.agentAudio.dispose();
    this.renderer.dispose();
  }
}
