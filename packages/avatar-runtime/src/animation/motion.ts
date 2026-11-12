/**
 * Procedural motion: turns (agent state, speech energy, gesture/emotion events) into a body pose and
 * a face state every frame. Works on any humanoid rig whose rest pose is a T-pose facing +Z with the
 * character's left arm along +X (VRM normalized humanoid convention).
 */
import type { AgentState, Emotion, Gesture } from "@metaavatar/protocol";

export const BONES = [
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  "leftUpperLeg",
  "rightUpperLeg",
] as const;
export type BoneName = (typeof BONES)[number];

/** Euler rotation (x, y, z) in radians, applied on top of the T-pose. */
export type Rot = [number, number, number];
export type Pose = Record<BoneName, Rot>;

export interface FaceState {
  /** 0 = open, 1 = closed. */
  blink: number;
  emotion: Emotion;
  emotionWeight: number;
  /** Small eye offsets for saccades, radians. */
  eyeYaw: number;
  eyePitch: number;
}

const zeroPose = (): Pose =>
  Object.fromEntries(BONES.map((b) => [b, [0, 0, 0] as Rot])) as unknown as Pose;

/** Arms relaxed by the sides, slight elbow bend. */
function restPose(): Pose {
  const p = zeroPose();
  p.leftUpperArm = [0, 0, -1.22];
  p.rightUpperArm = [0, 0, 1.22];
  p.leftLowerArm = [0, -0.18, 0];
  p.rightLowerArm = [0, 0.18, 0];
  return p;
}

interface GestureClip {
  duration: number;
  /** Returns pose deltas at normalized time u in [0, 1]. */
  sample(u: number, intensity: number): Partial<Pose>;
}

/** Bell-shaped envelope: eases in and out over the clip. */
const env = (u: number, inEnd = 0.2, outStart = 0.8) =>
  u < inEnd ? ease(u / inEnd) : u > outStart ? ease((1 - u) / (1 - outStart)) : 1;
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

const GESTURES: Record<Exclude<Gesture, "none">, GestureClip> = {
  wave: {
    duration: 2.0,
    sample: (u, k) => {
      const e = env(u, 0.18, 0.82) * k;
      const swing = Math.sin(u * Math.PI * 7) * 0.35 * e;
      return {
        rightUpperArm: [0, -0.15 * e, -1.55 * e],
        // Bend the elbow upward (rotation in the body plane) and swing the forearm side to side.
        rightLowerArm: [0, 0.25 * e, -1.35 * e + swing],
        rightHand: [0, 0, swing * 0.4],
        head: [0, -0.08 * e, 0.06 * e],
      };
    },
  },
  nod: {
    duration: 0.9,
    sample: (u, k) => ({ head: [Math.sin(u * Math.PI * 2) * 0.16 * k * env(u, 0.1, 0.9), 0, 0] }),
  },
  shake_head: {
    duration: 1.1,
    sample: (u, k) => ({ head: [0, Math.sin(u * Math.PI * 4) * 0.2 * k * env(u, 0.1, 0.85), 0] }),
  },
  shrug: {
    duration: 1.4,
    sample: (u, k) => {
      const e = env(u, 0.3, 0.6) * k;
      return {
        leftUpperArm: [0, 0, 0.25 * e],
        rightUpperArm: [0, 0, -0.25 * e],
        leftLowerArm: [0, -1.0 * e, 0],
        rightLowerArm: [0, 1.0 * e, 0],
        leftHand: [0, 0, -0.5 * e],
        rightHand: [0, 0, 0.5 * e],
        head: [0, 0, 0.12 * e],
        chest: [-0.03 * e, 0, 0],
      };
    },
  },
  explain: {
    duration: 2.2,
    sample: (u, k) => {
      const e = env(u, 0.2, 0.75) * k;
      const beat = Math.sin(u * Math.PI * 4) * 0.15 * e;
      // Both forearms forward, palms up, hands moving on the beat.
      return {
        leftUpperArm: [-0.45 * e, 0, 0.1 * e],
        rightUpperArm: [-0.45 * e, 0, -0.1 * e],
        leftLowerArm: [0, -1.25 * e + beat, 0],
        rightLowerArm: [0, 1.25 * e - beat, 0],
        leftHand: [0, 0, -0.35 * e],
        rightHand: [0, 0, 0.35 * e],
        chest: [0, Math.sin(u * Math.PI * 2) * 0.04 * e, 0],
      };
    },
  },

  point: {
    duration: 1.8,
    sample: (u, k) => {
      const e = env(u, 0.2, 0.75) * k;
      // Right arm swings forward to shoulder height and slightly across, elbow almost straight.
      return {
        rightUpperArm: [-1.25 * e, 0, -0.35 * e],
        rightLowerArm: [0, 0.1 * e, 0],
        head: [0, 0.12 * e, 0],
        chest: [0, 0.08 * e, 0],
      };
    },
  },

  celebrate: {
    duration: 1.8,
    sample: (u, k) => {
      const e = env(u, 0.15, 0.75) * k;
      const pump = Math.abs(Math.sin(u * Math.PI * 3)) * 0.25 * e;
      return {
        leftUpperArm: [0, 0, 2.1 * e - pump],
        rightUpperArm: [0, 0, -2.1 * e + pump],
        leftLowerArm: [0, -0.6 * e, 0],
        rightLowerArm: [0, 0.6 * e, 0],
        head: [-0.12 * e, 0, 0],
        chest: [-0.05 * e, 0, 0],
      };
    },
  },
  think: {
    duration: 2.4,
    sample: (u, k) => {
      const e = env(u, 0.25, 0.75) * k;
      // Elbow forward and in, forearm curled up so the hand rests near the chin.
      return {
        rightUpperArm: [-0.85 * e, 0, 0.42 * e],
        rightLowerArm: [0, 2.35 * e, 0],
        rightHand: [-0.5 * e, 0, 0],
        head: [-0.08 * e, -0.12 * e, 0.1 * e],
      };
    },
  },

};

interface ActiveGesture {
  clip: GestureClip;
  start: number;
  intensity: number;
}

const add = (a: Rot, b: Rot | undefined, w = 1): Rot =>
  b ? [a[0] + b[0] * w, a[1] + b[1] * w, a[2] + b[2] * w] : a;

/** Exponential approach, frame-rate independent. */
const approach = (cur: number, target: number, dt: number, tau: number) =>
  cur + (target - cur) * (1 - Math.exp(-dt / tau));

export class MotionController {
  private t = 0;
  private state: AgentState = "idle";
  private stateBlend = { listening: 0, thinking: 0, speaking: 0 };
  private gestures: ActiveGesture[] = [];
  private emotion: Emotion = "neutral";
  private emotionWeight = 0;
  private emotionUntil = 0;
  private blinkPhase = 0;
  private nextBlink = 2;
  private saccade = { yaw: 0, pitch: 0, next: 1, tYaw: 0, tPitch: 0 };
  private beatCooldown = 0;
  private prevEnergy = 0;
  /** Where the user is, in normalized view coords [-1, 1]; null = look at camera centre. */
  lookTarget: { x: number; y: number } | null = null;

  setState(state: AgentState): void {
    this.state = state;
  }

  getState(): AgentState {
    return this.state;
  }

  playGesture(gesture: Gesture, intensity = 0.8): void {
    if (gesture === "none") return;
    // Don't stack the same gesture, and keep at most two layered gestures.
    this.gestures = this.gestures.filter((g) => g.clip !== GESTURES[gesture]).slice(-1);
    this.gestures.push({ clip: GESTURES[gesture], start: this.t, intensity });
  }

  setEmotion(emotion: Emotion, intensity = 0.7, holdSec = 4): void {
    this.emotion = emotion;
    this.emotionWeight = Math.max(this.emotionWeight * 0.5, 0.01);
    this.targetEmotionWeight = emotion === "neutral" ? 0 : intensity;
    this.emotionUntil = this.t + holdSec;
  }
  private targetEmotionWeight = 0;

  /** Stop gestures that are mid-flight (barge-in) and return to listening. */
  interrupt(): void {
    this.gestures = [];
    this.state = "listening";
  }

  update(dt: number, speechEnergy: number): { pose: Pose; face: FaceState } {
    this.t += dt;
    const t = this.t;

    for (const key of ["listening", "thinking", "speaking"] as const) {
      this.stateBlend[key] = approach(this.stateBlend[key], this.state === key ? 1 : 0, dt, 0.25);
    }
    const { listening, thinking, speaking } = this.stateBlend;

    const pose = restPose();

    // Breathing and weight shift (always on).
    const breath = Math.sin(t * 2 * Math.PI * 0.22);
    const sway = Math.sin(t * 2 * Math.PI * 0.07);
    pose.chest = add(pose.chest, [breath * 0.012, 0, 0]);
    pose.spine = add(pose.spine, [0, sway * 0.02, sway * 0.012]);
    pose.hips = add(pose.hips, [0, 0, -sway * 0.015]);
    pose.leftUpperArm = add(pose.leftUpperArm, [0, 0, breath * 0.015]);
    pose.rightUpperArm = add(pose.rightUpperArm, [0, 0, -breath * 0.015]);

    // Idle head drift.
    pose.head = add(pose.head, [
      Math.sin(t * 0.53) * 0.025 + Math.sin(t * 1.31) * 0.01,
      Math.sin(t * 0.37) * 0.05,
      Math.sin(t * 0.29) * 0.02,
    ]);

    // Listening: lean in, small tilt, slow nods.
    pose.spine = add(pose.spine, [0.05, 0, 0], listening);
    pose.head = add(pose.head, [0.04 + Math.max(0, Math.sin(t * 1.4)) * 0.04, 0, 0.07], listening);

    // Thinking: look up and aside.
    pose.head = add(pose.head, [-0.12, 0.18, 0.04], thinking);

    // Speaking: energy-driven head motion plus beat gestures on stressed syllables.
    const e = speechEnergy;
    pose.head = add(pose.head, [Math.sin(t * 5.1) * 0.03 * e, Math.sin(t * 2.3) * 0.05 * e, 0], speaking);
    pose.chest = add(pose.chest, [0, Math.sin(t * 1.7) * 0.03 * e, 0], speaking);
    pose.leftLowerArm = add(pose.leftLowerArm, [0, -0.5 * e, 0], speaking);
    pose.rightLowerArm = add(pose.rightLowerArm, [0, 0.5 * e, 0], speaking);
    this.beatCooldown -= dt;
    const onset = e - this.prevEnergy;
    this.prevEnergy = e;
    if (speaking > 0.5 && onset > 0.12 && e > 0.45 && this.beatCooldown <= 0 && this.gestures.length === 0) {
      this.playGesture(Math.random() < 0.6 ? "nod" : "explain", 0.45 + 0.3 * e);
      this.beatCooldown = 2.5 + Math.random() * 2;
    }

    // Gaze toward the user.
    if (this.lookTarget) {
      pose.head = add(pose.head, [-this.lookTarget.y * 0.15, this.lookTarget.x * 0.25, 0]);
      pose.neck = add(pose.neck, [-this.lookTarget.y * 0.05, this.lookTarget.x * 0.1, 0]);
    }

    // Gesture layers.
    this.gestures = this.gestures.filter((g) => t - g.start < g.clip.duration);
    for (const g of this.gestures) {
      const u = (t - g.start) / g.clip.duration;
      const delta = g.clip.sample(u, g.intensity);
      for (const [bone, rot] of Object.entries(delta) as [BoneName, Rot][]) {
        pose[bone] = add(pose[bone], rot);
      }
    }

    // Emotion decays back to neutral after its hold time.
    if (t > this.emotionUntil) this.targetEmotionWeight = 0;
    this.emotionWeight = approach(this.emotionWeight, this.targetEmotionWeight, dt, 0.35);
    if (this.emotionWeight < 0.01 && this.targetEmotionWeight === 0) this.emotion = "neutral";

    return { pose, face: this.updateFace(dt) };
  }

  private updateFace(dt: number): FaceState {
    // Blinks every 2-6 s, 150 ms long, occasional double blink.
    this.nextBlink -= dt;
    if (this.nextBlink <= 0 && this.blinkPhase === 0) {
      this.blinkPhase = 0.0001;
      this.nextBlink = 2 + Math.random() * 4;
      if (Math.random() < 0.15) this.nextBlink = 0.35;
    }
    let blink = 0;
    if (this.blinkPhase > 0) {
      this.blinkPhase += dt / 0.15;
      blink = Math.sin(Math.min(1, this.blinkPhase) * Math.PI);
      if (this.blinkPhase >= 1) this.blinkPhase = 0;
    }
    // Saccades: small quick eye jumps.
    const s = this.saccade;
    s.next -= dt;
    if (s.next <= 0) {
      s.tYaw = (Math.random() - 0.5) * 0.12;
      s.tPitch = (Math.random() - 0.5) * 0.06;
      s.next = 0.6 + Math.random() * 2.2;
    }
    s.yaw = approach(s.yaw, s.tYaw, dt, 0.03);
    s.pitch = approach(s.pitch, s.tPitch, dt, 0.03);
    const thinkingLook = this.stateBlend.thinking;
    return {
      blink,
      emotion: this.emotion,
      emotionWeight: this.emotionWeight,
      eyeYaw: s.yaw + 0.2 * thinkingLook,
      eyePitch: s.pitch + 0.12 * thinkingLook,
    };
  }
}
