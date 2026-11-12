/**
 * Built-in placeholder character made from primitives, so the platform works with zero asset
 * downloads. Same joint conventions as a VRM normalized humanoid (T-pose, faces +Z, left arm +X),
 * so the motion system drives it exactly like a real model.
 */
import * as THREE from "three";
import type { FaceState, Pose } from "../animation/motion";
import { BONES, type BoneName } from "../animation/motion";
import type { Visemes } from "../audio/visemes";
import type { AvatarModel } from "./types";

export interface ProceduralStyle {
  skin: string;
  shirt: string;
  trousers: string;
  hair: string;
  shoes: string;
  eyes: string;
}

export const DEFAULT_STYLE: ProceduralStyle = {
  skin: "#e9b996",
  shirt: "#3d5afe",
  trousers: "#2a2f3d",
  hair: "#3b2a20",
  shoes: "#1d1f24",
  eyes: "#3d2b1f",
};

const EMOTION_FACE: Record<string, { brow: number; browTilt: number; smile: number; eyeOpen: number }> = {
  neutral: { brow: 0, browTilt: 0, smile: 0, eyeOpen: 1 },
  happy: { brow: 0.004, browTilt: 0, smile: 1, eyeOpen: 0.8 },
  sad: { brow: -0.002, browTilt: -0.35, smile: -0.7, eyeOpen: 0.85 },
  angry: { brow: -0.006, browTilt: 0.4, smile: -0.4, eyeOpen: 0.9 },
  surprised: { brow: 0.012, browTilt: 0, smile: 0, eyeOpen: 1.25 },
  relaxed: { brow: 0.002, browTilt: 0, smile: 0.5, eyeOpen: 0.75 },
  thinking: { brow: 0.006, browTilt: -0.15, smile: -0.1, eyeOpen: 0.9 },
};

export class ProceduralAvatar implements AvatarModel {
  readonly root = new THREE.Group();
  readonly eyeHeight: number;
  private joints = {} as Record<BoneName, THREE.Object3D>;
  private eyes: THREE.Object3D[] = [];
  private irises: THREE.Object3D[] = [];
  private brows: THREE.Mesh[] = [];
  private mouth!: THREE.Mesh;
  private mouthGroup!: THREE.Group;
  private smileCorners: THREE.Mesh[] = [];
  private disposables: { dispose(): void }[] = [];

  constructor(style: ProceduralStyle = DEFAULT_STYLE) {
    const mat = (color: string, roughness = 0.6, extra: Partial<THREE.MeshPhysicalMaterialParameters> = {}) => {
      const m = new THREE.MeshPhysicalMaterial({ color, roughness, ...extra });
      this.disposables.push(m);
      return m;
    };
    const skin = mat(style.skin, 0.5, { sheen: 0.4, sheenColor: new THREE.Color("#ffd2c0"), clearcoat: 0.05 });
    const shirt = mat(style.shirt, 0.75);
    const trousers = mat(style.trousers, 0.8);
    const hair = mat(style.hair, 0.55, { sheen: 0.6, sheenColor: new THREE.Color("#7a5a44") });
    const shoes = mat(style.shoes, 0.4);
    const white = mat("#f8f6f2", 0.2, { clearcoat: 0.6 });
    const iris = mat(style.eyes, 0.15, { clearcoat: 1 });
    const dark = mat("#4a1f1f", 0.7);
    const lip = mat("#c97b6f", 0.5);

    const mesh = (geo: THREE.BufferGeometry, m: THREE.Material) => {
      this.disposables.push(geo);
      const x = new THREE.Mesh(geo, m);
      x.castShadow = true;
      x.receiveShadow = true;
      return x;
    };
    const joint = (name: BoneName, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const j = new THREE.Group();
      j.name = name;
      j.position.set(x, y, z);
      parent.add(j);
      this.joints[name] = j;
      return j;
    };
    /** Capsule along +X (arms) or -Y (legs) starting at the joint. */
    const limb = (j: THREE.Object3D, len: number, r: number, m: THREE.Material, axis: "x" | "-x" | "-y") => {
      const c = mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 6, 16), m);
      if (axis === "x") {
        c.rotation.z = Math.PI / 2;
        c.position.x = len / 2;
      } else if (axis === "-x") {
        c.rotation.z = Math.PI / 2;
        c.position.x = -len / 2;
      } else {
        c.position.y = -len / 2;
      }
      j.add(c);
      return c;
    };

    // --- Skeleton -----------------------------------------------------------------------------
    const hips = joint("hips", this.root, 0, 0.95, 0);
    const spine = joint("spine", hips, 0, 0.08, 0);
    const chest = joint("chest", spine, 0, 0.18, 0);
    const neck = joint("neck", chest, 0, 0.21, 0);
    const head = joint("head", neck, 0, 0.08, 0);
    const lUA = joint("leftUpperArm", chest, 0.19, 0.15, 0);
    const lLA = joint("leftLowerArm", lUA, 0.27, 0, 0);
    const lH = joint("leftHand", lLA, 0.25, 0, 0);
    const rUA = joint("rightUpperArm", chest, -0.19, 0.15, 0);
    const rLA = joint("rightLowerArm", rUA, -0.27, 0, 0);
    const rH = joint("rightHand", rLA, -0.25, 0, 0);
    const lUL = joint("leftUpperLeg", hips, 0.095, -0.03, 0);
    const rUL = joint("rightUpperLeg", hips, -0.095, -0.03, 0);

    // --- Body ---------------------------------------------------------------------------------
    const pelvis = mesh(new THREE.CapsuleGeometry(0.14, 0.08, 8, 20), trousers);
    pelvis.scale.set(1.15, 1, 0.75);
    pelvis.position.y = 0.0;
    hips.add(pelvis);

    const torso = mesh(new THREE.CapsuleGeometry(0.15, 0.24, 10, 24), shirt);
    torso.scale.set(1.18, 1, 0.72);
    torso.position.y = 0.06;
    chest.add(torso);
    const belly = mesh(new THREE.CapsuleGeometry(0.135, 0.06, 8, 20), shirt);
    belly.scale.set(1.12, 1, 0.72);
    belly.position.y = 0.02;
    spine.add(belly);
    const collar = mesh(new THREE.TorusGeometry(0.055, 0.012, 8, 24), shirt);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.2;
    chest.add(collar);

    const neckMesh = mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 16), skin);
    neckMesh.position.y = 0.03;
    neck.add(neckMesh);

    limb(lUA, 0.28, 0.052, shirt, "x");
    limb(lLA, 0.26, 0.042, skin, "x");
    limb(rUA, 0.28, 0.052, shirt, "-x");
    limb(rLA, 0.26, 0.042, skin, "-x");
    for (const [h, dir] of [
      [lH, 1],
      [rH, -1],
    ] as const) {
      const palm = mesh(new THREE.SphereGeometry(0.045, 16, 12), skin);
      palm.scale.set(1.3, 0.55, 1);
      palm.position.x = 0.05 * dir;
      h.add(palm);
      const thumb = mesh(new THREE.CapsuleGeometry(0.012, 0.03, 4, 8), skin);
      thumb.position.set(0.03 * dir, 0, 0.035);
      thumb.rotation.y = 0.6 * dir;
      thumb.rotation.z = Math.PI / 2;
      h.add(thumb);
    }

    for (const leg of [lUL, rUL]) {
      limb(leg, 0.9, 0.065, trousers, "-y");
      const shoe = mesh(new THREE.CapsuleGeometry(0.05, 0.1, 6, 12), shoes);
      shoe.rotation.x = Math.PI / 2;
      shoe.position.set(0, -0.9, 0.05);
      leg.add(shoe);
    }

    // --- Head ---------------------------------------------------------------------------------
    const skull = mesh(new THREE.SphereGeometry(0.105, 40, 32), skin);
    skull.scale.set(0.93, 1.1, 1.0);
    skull.position.y = 0.11;
    head.add(skull);
    const jaw = mesh(new THREE.SphereGeometry(0.08, 32, 24), skin);
    jaw.scale.set(0.95, 0.8, 1.0);
    jaw.position.set(0, 0.06, 0.02);
    head.add(jaw);
    const hairCap = mesh(new THREE.SphereGeometry(0.112, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.52), hair);
    hairCap.scale.set(0.97, 1.12, 1.06);
    hairCap.position.set(0, 0.118, -0.006);
    hairCap.rotation.x = -0.32;
    head.add(hairCap);
    // Side-swept fringe: a flattened half-ellipsoid hugging the forehead.
    const fringe = mesh(new THREE.SphereGeometry(0.06, 24, 12, 0, Math.PI, 0, Math.PI / 2), hair);
    fringe.scale.set(1.25, 0.45, 0.75);
    fringe.rotation.set(Math.PI / 2 - 0.35, 0, 0.18);
    fringe.position.set(0.012, 0.19, 0.06);
    head.add(fringe);
    for (const s of [1, -1]) {
      const ear = mesh(new THREE.SphereGeometry(0.022, 12, 10), skin);
      ear.scale.set(0.5, 1, 0.8);
      ear.position.set(0.096 * s, 0.11, 0);
      head.add(ear);
    }
    const nose = mesh(new THREE.SphereGeometry(0.017, 16, 12), skin);
    nose.scale.set(0.75, 1.05, 0.9);
    nose.position.set(0, 0.1, 0.104);
    head.add(nose);

    for (const s of [1, -1]) {
      const eyeGroup = new THREE.Group();
      eyeGroup.position.set(0.037 * s, 0.128, 0.088);
      head.add(eyeGroup);
      const ball = mesh(new THREE.SphereGeometry(0.017, 24, 16), white);
      ball.scale.set(1, 0.85, 0.6);
      eyeGroup.add(ball);
      const irisPivot = new THREE.Group();
      eyeGroup.add(irisPivot);
      const irisMesh = mesh(new THREE.SphereGeometry(0.0095, 20, 14), iris);
      irisMesh.scale.set(1, 1, 0.4);
      irisMesh.position.z = 0.0085;
      irisPivot.add(irisMesh);
      this.eyes.push(eyeGroup);
      this.irises.push(irisPivot);

      const brow = mesh(new THREE.CapsuleGeometry(0.0045, 0.028, 4, 8), hair);
      brow.rotation.z = Math.PI / 2;
      brow.position.set(0.038 * s, 0.158, 0.098);
      head.add(brow);
      this.brows.push(brow);
    }

    this.mouthGroup = new THREE.Group();
    this.mouthGroup.position.set(0, 0.062, 0.096);
    head.add(this.mouthGroup);
    this.mouth = mesh(new THREE.SphereGeometry(0.02, 24, 16), dark);
    this.mouth.scale.set(1.1, 0.15, 0.35);
    this.mouthGroup.add(this.mouth);
    for (const s of [1, -1]) {
      const corner = mesh(new THREE.SphereGeometry(0.0055, 10, 8), lip);
      corner.position.set(0.021 * s, 0, 0.002);
      this.mouthGroup.add(corner);
      this.smileCorners.push(corner);
    }

    this.root.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    this.eyes[0]!.getWorldPosition(p);
    this.eyeHeight = p.y;
  }

  applyPose(pose: Pose): void {
    for (const b of BONES) {
      const r = pose[b];
      this.joints[b].rotation.set(r[0], r[1], r[2]);
    }
  }

  applyFace(face: FaceState, v: Visemes): void {
    const ef = EMOTION_FACE[face.emotion] ?? EMOTION_FACE.neutral!;
    const w = face.emotionWeight;
    const eyeOpen = (1 + (ef.eyeOpen - 1) * w) * (1 - face.blink * 0.95);
    for (const e of this.eyes) e.scale.y = Math.max(0.05, eyeOpen);
    for (const i of this.irises) i.rotation.set(-face.eyePitch, face.eyeYaw, 0);
    this.brows.forEach((b, idx) => {
      const s = idx === 0 ? 1 : -1;
      b.position.y = 0.158 + ef.brow * w + v.aa * 0.002;
      b.rotation.x = 0;
      b.rotation.y = 0;
      b.rotation.z = Math.PI / 2 + ef.browTilt * w * s;
    });
    const open = v.aa * 1.0 + v.oh * 0.8 + v.ou * 0.55 + v.ih * 0.35 + v.ee * 0.3;
    const width = 1.1 + v.ee * 0.45 + v.ih * 0.2 - v.ou * 0.45 - v.oh * 0.25 + ef.smile * w * 0.15;
    this.mouth.scale.set(Math.max(0.5, width), 0.15 + open * 0.75, 0.35 + open * 0.15);
    const smile = ef.smile * w;
    this.smileCorners.forEach((c, idx) => {
      const s = idx === 0 ? 1 : -1;
      c.position.set(0.021 * s * (width / 1.1), smile * 0.006, 0.002);
    });
    this.mouthGroup.position.y = 0.062 - open * 0.004;
  }

  update(): void {}

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.root.removeFromParent();
  }
}
