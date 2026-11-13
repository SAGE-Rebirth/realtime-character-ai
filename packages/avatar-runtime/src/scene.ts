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

  /**
   * Each framing names the region it must show (in metres, for a 1.55 m eye height); the camera
   * distance is solved from the field of view and the canvas aspect so the shot holds on any screen,
   * from a phone to a tall side panel.
   */
  private applyFraming(): void {
    const eye = this.eyeHeight;
    const scale = eye / 1.55;
    const aspect = this.camera.aspect || 1;
    const shots: Record<Framing, { center: number; height: number; width: number; tilt: number }> = {
      portrait: { center: eye - 0.08, height: 0.5, width: 0.42, tilt: 0.03 },
      upper: { center: eye - 0.4, height: 1.05, width: 0.6, tilt: 0.12 },
      full: { center: eye * 0.55, height: 2.05, width: 0.8, tilt: 0.2 },
    };
    const s = shots[this.framing];
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const dist =
      Math.max((s.height * scale) / 2 / Math.tan(vHalf), (s.width * scale) / 2 / Math.tan(hHalf)) + 0.15 * scale;
    // A camera slightly above the target looks down a touch, which flatters faces.
    this.camera.position.set(0, s.center + s.tilt * scale, dist);
    this.camera.lookAt(0, s.center, 0);
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
