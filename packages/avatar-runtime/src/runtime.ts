/**
 * AvatarRuntime: the public entry point. Owns the 3D scene, the avatar, the motion system, the
 * lip-sync analyser and (optionally) a live connection to an agent.
 */
import type { AgentState, AvatarEvent, AvatarRef, Emotion, Gesture } from "@metaavatar/protocol";
import { MotionController } from "./animation/motion";
import { LipSyncAnalyser, type PlaybackMode } from "./audio/analyser";
import { ProceduralAvatar } from "./avatar/procedural";
import type { AvatarModel } from "./avatar/types";
import { VrmAvatar } from "./avatar/vrm";
import { AvatarScene, type Framing } from "./scene";
import { AgentConnection, type Caption } from "./session";

export interface RuntimeOptions {
  canvas: HTMLCanvasElement;
  avatar: AvatarRef;
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
}

export class AvatarRuntime {
  private scene: AvatarScene;
  private avatar!: AvatarModel;
  private motion = new MotionController();
  private agentAudio: LipSyncAnalyser;
  private micAnalyser: LipSyncAnalyser | null = null;
  private conn: AgentConnection | null = null;
  private raf = 0;
  private last = performance.now();
  private listeners = new Map<keyof RuntimeEvents, Set<Listener<never>>>();
  private mirror = false;
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
    this.scene = new AvatarScene(opts.canvas);
    this.scene.setFraming(opts.framing ?? "upper");
    this.agentAudio = new LipSyncAnalyser(opts.playbackMode ?? "element");
  }

  static async create(opts: RuntimeOptions): Promise<AvatarRuntime> {
    const rt = new AvatarRuntime(opts);
    await rt.setAvatar(opts.avatar);
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
  async setAvatar(ref: AvatarRef): Promise<void> {
    const next =
      ref.kind === "vrm"
        ? await VrmAvatar.load(ref.url, this.scene.camera, this.opts.onLoadProgress)
        : new ProceduralAvatar();
    this.avatar?.dispose();
    this.avatar = next;
    this.scene.scene.add(next.root);
    this.scene.setSubjectEyeHeight(next.eyeHeight);
  }

  setFraming(f: Framing): void {
    this.scene.setFraming(f);
  }

  playGesture(g: Gesture, intensity?: number): void {
    this.motion.playGesture(g, intensity);
  }

  setEmotion(e: Emotion, intensity?: number): void {
    this.motion.setEmotion(e, intensity);
  }

  /** Where the user is on screen, [-1, 1] each axis (e.g. from the pointer or face tracking). */
  setLookTarget(t: { x: number; y: number } | null): void {
    this.motion.lookTarget = t;
  }

  // --- Live session ---------------------------------------------------------------------------
  async connect(url: string, token: string): Promise<void> {
    await this.agentAudio.resume();
    this.conn = new AgentConnection({
      onAgentAudio: (track) => void this.agentAudio.attach(track, true),
      onAgentAudioEnded: () => this.agentAudio.detach(),
      onEvent: (ev) => this.handleEvent(ev),
      onAgentState: (s) => this.setAgentState(s),
      onCaption: (c) => this.emit("caption", c),
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
    const micTrack = await this.conn.setMicEnabled(true);
    if (micTrack) await this.attachMicAnalyser(micTrack);
  }

  async setMicEnabled(on: boolean): Promise<void> {
    if (!this.conn) return;
    const track = await this.conn.setMicEnabled(on);
    if (track) await this.attachMicAnalyser(track);
    else this.micAnalyser?.detach();
  }

  async disconnect(): Promise<void> {
    await this.conn?.disconnect();
    this.conn = null;
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

  private handleEvent(ev: AvatarEvent): void {
    this.emit("event", ev);
    switch (ev.type) {
      case "agent.state":
        this.setAgentState(ev.state);
        break;
      case "agent.emotion":
        this.motion.setEmotion(ev.emotion, ev.intensity);
        break;
      case "agent.gesture":
        this.motion.playGesture(ev.gesture, ev.intensity);
        break;
      case "session.warning":
        this.emit("warning", { code: ev.code, message: ev.message });
        break;
      case "agent.flush":
        this.agentAudio.flush();
        this.motion.interrupt();
        break;
      default:
        break;
    }
  }

  private setAgentState(s: AgentState): void {
    if (this.metrics.agentState === s) return;
    this.metrics.agentState = s;
    this.motion.setState(s);
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

    const { pose, face } = this.motion.update(dt, energy);
    this.avatar.applyPose(pose);
    this.avatar.applyFace(face, visemes);
    this.avatar.update(dt);
    this.scene.render();

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

  /**
   * Development aid: renders `frames` frames back to back and waits for the GPU, returning the
   * average cost per frame in ms. Unaffected by background-tab throttling.
   */
  benchmark(frames = 120): { avgMs: number; maxMs: number } {
    const gl = this.scene.renderer.getContext();
    const times: number[] = [];
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      const { pose, face } = this.motion.update(1 / 60, 0.5);
      this.avatar.applyPose(pose);
      this.avatar.applyFace(face, this.agentAudio.update(1 / 60));
      this.avatar.update(1 / 60);
      this.scene.render();
      gl.finish();
      times.push(performance.now() - t0);
    }
    return { avgMs: times.reduce((a, b) => a + b, 0) / times.length, maxMs: Math.max(...times) };
  }

  getMetrics(): RuntimeMetrics {
    return { ...this.metrics };
  }

  async dispose(): Promise<void> {
    cancelAnimationFrame(this.raf);
    await this.disconnect().catch(() => undefined);
    this.avatar.dispose();
    await this.micAnalyser?.dispose();
    await this.agentAudio.dispose();
    this.scene.dispose();
  }
}
