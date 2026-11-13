/** ThreeRenderer: a 3D avatar (procedural or VRM) rendered with three.js on the viewer's device. */
import type { AgentState, AvatarRef, Emotion, Gesture } from "@metaavatar/protocol";
import { MotionController } from "../animation/motion";
import { ProceduralAvatar } from "../avatar/procedural";
import type { AvatarModel } from "../avatar/types";
import { VrmAvatar } from "../avatar/vrm";
import { AvatarScene } from "../scene";
import type { AvatarRenderer, Framing, RenderFrame } from "./types";

export class ThreeRenderer implements AvatarRenderer {
  readonly kind = "3d" as const;
  private scene: AvatarScene;
  private avatar: AvatarModel | null = null;
  private motion = new MotionController();
  private loadSeq = 0;

  constructor(canvas: HTMLCanvasElement, framing: Framing = "upper") {
    this.scene = new AvatarScene(canvas);
    this.scene.setFraming(framing);
  }

  async setAvatar(ref: AvatarRef, onProgress?: (fraction: number) => void): Promise<void> {
    const seq = ++this.loadSeq;
    const next =
      ref.kind === "vrm" ? await VrmAvatar.load(ref.url, this.scene.camera, onProgress) : new ProceduralAvatar();
    // A newer setAvatar call started while this one was loading: its avatar wins, drop this one.
    if (seq !== this.loadSeq) {
      next.dispose();
      return;
    }
    this.avatar?.dispose();
    this.avatar = next;
    this.scene.scene.add(next.root);
    this.scene.setSubjectEyeHeight(next.eyeHeight);
  }

  setFraming(framing: Framing): void {
    this.scene.setFraming(framing);
  }

  setAgentState(state: AgentState): void {
    this.motion.setState(state);
  }

  setEmotion(emotion: Emotion, intensity?: number, holdSec?: number): void {
    this.motion.setEmotion(emotion, intensity, holdSec);
  }

  playGesture(gesture: Gesture, intensity?: number): void {
    this.motion.playGesture(gesture, intensity);
  }

  interrupt(): void {
    this.motion.interrupt();
  }

  setLookTarget(target: { x: number; y: number } | null): void {
    this.motion.lookTarget = target;
  }

  render({ dt, visemes, energy }: RenderFrame): void {
    if (!this.avatar) return;
    const { pose, face } = this.motion.update(dt, energy);
    this.avatar.applyPose(pose);
    this.avatar.applyFace(face, visemes);
    this.avatar.update(dt);
    this.scene.render();
  }

  capture(framing: Framing = "portrait"): string {
    const before = this.scene.getFraming();
    this.scene.setFraming(framing);
    this.scene.render();
    // Read the canvas in the same task as the render, before the browser clears the buffer.
    const url = this.scene.canvas.toDataURL("image/png");
    this.scene.setFraming(before);
    return url;
  }

  benchmark(frames = 120): { avgMs: number; maxMs: number } {
    const gl = this.scene.renderer.getContext();
    const silent = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    const times: number[] = [];
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      this.render({ dt: 1 / 60, visemes: { ...silent, aa: (i % 10) / 10 }, energy: 0.5 });
      gl.finish();
      times.push(performance.now() - t0);
    }
    return { avgMs: times.reduce((a, b) => a + b, 0) / times.length, maxMs: Math.max(...times) };
  }

  dispose(): void {
    this.avatar?.dispose();
    this.scene.dispose();
  }
}
