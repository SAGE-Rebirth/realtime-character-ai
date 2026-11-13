/** Loads and animates any VRM 0.x / 1.0 model through its normalized humanoid. */
import { type VRM, VRMExpressionPresetName, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { FaceState, Pose } from "../animation/motion";
import { BONES } from "../animation/motion";
import type { Visemes } from "../audio/visemes";
import type { AvatarModel } from "./types";

const EMOTION_TO_PRESET: Record<string, VRMExpressionPresetName | null> = {
  neutral: null,
  happy: VRMExpressionPresetName.Happy,
  sad: VRMExpressionPresetName.Sad,
  angry: VRMExpressionPresetName.Angry,
  surprised: VRMExpressionPresetName.Surprised,
  relaxed: VRMExpressionPresetName.Relaxed,
  thinking: null,
};

export class VrmAvatar implements AvatarModel {
  readonly root: THREE.Object3D;
  readonly eyeHeight: number;
  private lookTarget = new THREE.Object3D();
  /**
   * VRM 0.x models are authored facing -Z; rotateVRM0 turns the whole scene to face the camera, but
   * each bone's own axes still point the old way. A pose written for a +Z-facing rig (motion.ts)
   * therefore needs its X and Z rotations negated, or lowered arms go straight up.
   */
  private flip: 1 | -1;

  private constructor(
    private vrm: VRM,
    camera: THREE.Camera,
  ) {
    this.root = vrm.scene;
    this.flip = vrm.meta?.metaVersion === "0" ? -1 : 1;
    vrm.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
    camera.add(this.lookTarget);
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;
    vrm.scene.updateMatrixWorld(true);
    const head = vrm.humanoid.getNormalizedBoneNode("head");
    const p = new THREE.Vector3();
    head?.getWorldPosition(p);
    this.eyeHeight = p.y + 0.07;
  }

  static async load(url: string, camera: THREE.Camera, onProgress?: (fraction: number) => void): Promise<VrmAvatar> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url, (e) => {
      if (e.total) onProgress?.(e.loaded / e.total);
    });
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) throw new Error("File is not a VRM model");
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(vrm);
    return new VrmAvatar(vrm, camera);
  }

  applyPose(pose: Pose): void {
    const h = this.vrm.humanoid;
    for (const b of BONES) {
      const node = h.getNormalizedBoneNode(b);
      if (!node) continue;
      const r = pose[b];
      node.rotation.set(r[0] * this.flip, r[1], r[2] * this.flip);
    }
  }

  applyFace(face: FaceState, v: Visemes): void {
    const em = this.vrm.expressionManager;
    if (!em) return;
    // VRM has no "thinking" face, and VRM 0.x has no "surprised": stand in with a mouth shape
    // (pursed lips for thinking, a small "oh" for surprise) while the avatar isn't speaking.
    const quiet = 1 - Math.min(1, (v.aa + v.ih + v.ou + v.ee + v.oh) * 3);
    const purse = face.emotion === "thinking" ? 0.35 * face.emotionWeight * quiet : 0;
    const gasp =
      face.emotion === "surprised" && !em.getExpression(VRMExpressionPresetName.Surprised)
        ? 0.45 * face.emotionWeight * quiet
        : 0;
    em.setValue(VRMExpressionPresetName.Aa, v.aa);
    em.setValue(VRMExpressionPresetName.Ih, v.ih);
    em.setValue(VRMExpressionPresetName.Ou, Math.max(v.ou, purse));
    em.setValue(VRMExpressionPresetName.Ee, v.ee);
    em.setValue(VRMExpressionPresetName.Oh, Math.max(v.oh, gasp));
    em.setValue(VRMExpressionPresetName.Blink, face.blink);
    for (const preset of Object.values(EMOTION_TO_PRESET)) if (preset) em.setValue(preset, 0);
    const preset = EMOTION_TO_PRESET[face.emotion];
    // Emotions reduce mouth shapes slightly so the two don't fight.
    if (preset) em.setValue(preset, face.emotionWeight * 0.8);
    this.lookTarget.position.set(face.eyeYaw * 2, face.eyePitch * 2, 0);
  }

  update(dt: number): void {
    this.vrm.update(dt);
  }

  dispose(): void {
    this.lookTarget.removeFromParent();
    VRMUtils.deepDispose(this.vrm.scene);
    this.vrm.scene.removeFromParent();
  }
}
