import type { Object3D } from "three";
import type { FaceState, Pose } from "../animation/motion";
import type { Visemes } from "../audio/visemes";

/** Anything the runtime can animate: a loaded VRM or the built-in procedural character. */
export interface AvatarModel {
  readonly root: Object3D;
  /** World-space height of the eyes, used for camera framing. */
  readonly eyeHeight: number;
  applyPose(pose: Pose): void;
  applyFace(face: FaceState, visemes: Visemes): void;
  /** Per-frame internal updates (spring bones, look-at). */
  update(dt: number): void;
  dispose(): void;
}
