import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export type Framing = "portrait" | "upper" | "full";

export interface QualityPreset {
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  antialias: boolean;
}

/** Rough GPU tier from the renderer string; good enough to pick defaults, user can override. */
export function detectQuality(): QualityPreset {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile) return { pixelRatio: Math.min(dpr, 1.5), shadows: false, shadowMapSize: 512, antialias: false };
  return { pixelRatio: dpr, shadows: true, shadowMapSize: 2048, antialias: true };
}

export class AvatarScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private resizeObserver: ResizeObserver;
  private framing: Framing = "upper";
  private eyeHeight = 1.55;
  private pmrem: THREE.PMREMGenerator;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly quality: QualityPreset = detectQuality(),
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.antialias,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(quality.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
    this.scene.add(this.camera);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    const key = new THREE.DirectionalLight("#fff4e8", 2.2);
    key.position.set(1.2, 2.6, 2.2);
    key.castShadow = quality.shadows;
    key.shadow.mapSize.setScalar(quality.shadowMapSize);
    key.shadow.camera.left = -1;
    key.shadow.camera.right = 1;
    key.shadow.camera.top = 2.2;
    key.shadow.camera.bottom = -0.2;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    const fill = new THREE.DirectionalLight("#dfe8ff", 0.7);
    fill.position.set(-2, 1.4, 1.5);
    const rim = new THREE.DirectionalLight("#cfe0ff", 1.4);
    rim.position.set(-0.8, 2.2, -2.5);
    this.scene.add(key, fill, rim, new THREE.HemisphereLight("#ffffff", "#5b5466", 0.35));

    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.4, 48), new THREE.ShadowMaterial({ opacity: 0.22 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  setSubjectEyeHeight(h: number): void {
    this.eyeHeight = h;
    this.applyFraming();
  }

  setFraming(f: Framing): void {
    this.framing = f;
    this.applyFraming();
  }

  getFraming(): Framing {
    return this.framing;
  }

  private applyFraming(): void {
    const eye = this.eyeHeight;
    const scale = eye / 1.55;
    const aspect = this.camera.aspect || 1;
    // Narrow (phone) screens need the camera further back to keep shoulders in view.
    const narrow = aspect < 0.8 ? 1.35 : 1;
    const shots: Record<Framing, { y: number; dist: number; look: number }> = {
      portrait: { y: eye + 0.02, dist: 1.05, look: eye - 0.06 },
      upper: { y: eye - 0.05, dist: 2.45, look: eye - 0.3 },
      full: { y: eye * 0.62, dist: 4.4, look: eye * 0.55 },
    };
    const s = shots[this.framing];
    this.camera.position.set(0, s.y, s.dist * scale * narrow);
    this.camera.lookAt(0, s.look, 0);
  }

  private resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.applyFraming();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.scene.environment?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
  }
}
