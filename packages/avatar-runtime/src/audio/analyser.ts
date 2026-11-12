import { LIPSYNC_WORKLET_NAME, LIPSYNC_WORKLET_SOURCE } from "./worklet-source";
import {
  type AudioFeatures,
  LoudnessNormaliser,
  type Visemes,
  VisemeSmoother,
  ZERO_VISEMES,
  featuresToVisemes,
} from "./visemes";

/**
 * How the agent's voice is played:
 * - "element": plays through an <audio> element (browser echo cancellation works, best for
 *   speakers); lips lag by the analysis time (~20-30 ms).
 * - "delay-line": plays through WebAudio delayed by `delayMs`, so lips are exactly in sync
 *   (best with headphones; some browsers don't echo-cancel WebAudio output).
 */
export type PlaybackMode = "element" | "delay-line";

export interface LipSyncStats {
  /** Estimated time between hearing a sound and the mouth showing it (ms). */
  avOffsetMs: number;
  /** Feature frames received per second. */
  frameRate: number;
}

const WINDOW_SAMPLES = 1024;
const HOP_SAMPLES = 512;

/** Plays (optionally) and analyses one audio track, producing smoothed visemes per render frame. */
export class LipSyncAnalyser {
  readonly ctx: AudioContext;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private element: HTMLAudioElement | null = null;
  private sink: GainNode;
  private queue: AudioFeatures[] = [];
  private loudness = new LoudnessNormaliser();
  private smoother = new VisemeSmoother();
  private target: Visemes = { ...ZERO_VISEMES };
  private frames = 0;
  private frameWindowStart = performance.now();
  private stats: LipSyncStats = { avOffsetMs: 0, frameRate: 0 };
  private ready: Promise<void>;
  private _energy = 0;

  constructor(
    private mode: PlaybackMode = "element",
    private delayMs = 40,
    ctx?: AudioContext,
  ) {
    this.ctx = ctx ?? new AudioContext({ latencyHint: "interactive" });
    this.sink = this.ctx.createGain();
    this.sink.connect(this.ctx.destination);
    this.ready = this.loadWorklet();
  }

  private async loadWorklet(): Promise<void> {
    const url = URL.createObjectURL(new Blob([LIPSYNC_WORKLET_SOURCE], { type: "text/javascript" }));
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Speech loudness in [0, 1], used for prosody gestures. */
  get energy(): number {
    return this._energy;
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  /**
   * Start analysing a track. With `playback=false` (mic mirror test) nothing is played.
   */
  async attach(track: MediaStreamTrack, playback = true): Promise<void> {
    await this.ready;
    this.detach();
    const stream = new MediaStream([track]);
    const delaySamples = this.mode === "delay-line" && playback ? (this.delayMs / 1000) * this.ctx.sampleRate : 0;
    this.node = new AudioWorkletNode(this.ctx, LIPSYNC_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { delaySamples },
    });
    this.node.port.onmessage = (e: MessageEvent<AudioFeatures>) => {
      this.queue.push(e.data);
      this.frames++;
      if (this.queue.length > 200) this.queue.splice(0, this.queue.length - 200);
    };
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.node);

    if (playback && this.mode === "delay-line") {
      this.node.connect(this.sink);
      // Chrome only pulls remote WebRTC audio into WebAudio while a media element consumes it.
      this.element = this.makeElement(stream, true);
    } else {
      // Keep the worklet running without making sound.
      const mute = this.ctx.createGain();
      mute.gain.value = 0;
      this.node.connect(mute).connect(this.ctx.destination);
      if (playback) this.element = this.makeElement(stream, false);
    }
  }

  private makeElement(stream: MediaStream, muted: boolean): HTMLAudioElement {
    const el = new Audio();
    el.autoplay = true;
    el.muted = muted;
    el.srcObject = stream;
    void el.play().catch(() => undefined);
    return el;
  }

  detach(): void {
    this.source?.disconnect();
    this.node?.disconnect();
    if (this.node) this.node.port.onmessage = null;
    if (this.element) {
      this.element.pause();
      this.element.srcObject = null;
    }
    this.source = null;
    this.node = null;
    this.element = null;
    this.flush();
  }

  /** Drop everything queued and close the mouth (barge-in). */
  flush(): void {
    this.queue = [];
    this.target = { ...ZERO_VISEMES };
    this.smoother.reset();
    this._energy = 0;
  }

  /** The context time of the sample currently coming out of the speakers. */
  private audibleTime(): number {
    const ts = typeof this.ctx.getOutputTimestamp === "function" ? this.ctx.getOutputTimestamp() : undefined;
    if (ts && typeof ts.contextTime === "number" && ts.contextTime > 0) return ts.contextTime;
    return this.ctx.currentTime - (this.ctx.outputLatency || 0) - (this.ctx.baseLatency || 0);
  }

  /** Call once per render frame. Returns the smoothed visemes for what is audible right now. */
  update(dt: number): Visemes {
    const now = this.audibleTime();
    const delaySec = this.mode === "delay-line" && this.element?.muted ? this.delayMs / 1000 : 0;
    // A feature analysed at time t becomes audible at t + delay.
    let latest: AudioFeatures | undefined;
    while (this.queue.length && this.queue[0]!.t + delaySec <= now) latest = this.queue.shift();
    if (latest) {
      const open = this.loudness.openness(latest.rms);
      this.target = featuresToVisemes(latest, open);
      this._energy = this._energy * 0.7 + open * 0.3;
      // How late the mouth is relative to the sound, including half a render frame.
      const lateSec = Math.max(0, now - (latest.t + delaySec));
      const analysisSec = (WINDOW_SAMPLES / 2 + HOP_SAMPLES / 2) / this.ctx.sampleRate;
      const offset = (delaySec > 0 ? lateSec : lateSec + analysisSec) * 1000 + (dt * 1000) / 2;
      this.stats.avOffsetMs = this.stats.avOffsetMs * 0.9 + offset * 0.1;
    } else if (!this.node) {
      this.target = { ...ZERO_VISEMES };
    }
    const elapsed = performance.now() - this.frameWindowStart;
    if (elapsed > 1000) {
      this.stats.frameRate = (this.frames * 1000) / elapsed;
      this.frames = 0;
      this.frameWindowStart = performance.now();
    }
    return this.smoother.step(this.target, dt);
  }

  getStats(): LipSyncStats {
    return { ...this.stats };
  }

  async dispose(): Promise<void> {
    this.detach();
    await this.ctx.close().catch(() => undefined);
  }
}
