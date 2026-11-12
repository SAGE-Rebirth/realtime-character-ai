/**
 * L1 lip-sync: turns band energies into five vowel visemes (VRM names aa, ih, ou, ee, oh).
 * Pure functions, no DOM, so it is unit-testable.
 */

export interface AudioFeatures {
  /** AudioContext time (s) of the analysed window's centre. */
  t: number;
  rms: number;
  /** Energies for bands: [90-600, 600-1200, 1200-2400, 2400-4000, 4000-8000] Hz. */
  bands: Float32Array | number[];
}

export interface Visemes {
  aa: number;
  ih: number;
  ou: number;
  ee: number;
  oh: number;
}

export const ZERO_VISEMES: Readonly<Visemes> = Object.freeze({ aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 });

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Tracks the background noise floor so quiet rooms and loud voices both open the mouth well. */
export class LoudnessNormaliser {
  private floorDb = -60;
  private peakDb = -20;

  /** Returns mouth openness in [0, 1]. */
  openness(rms: number): number {
    const db = 20 * Math.log10(rms + 1e-9);
    // Floor follows quiet passages quickly and rises slowly; peak decays slowly.
    this.floorDb = db < this.floorDb ? db : this.floorDb + 0.02;
    this.floorDb = Math.max(this.floorDb, -75);
    this.peakDb = db > this.peakDb ? db : this.peakDb - 0.03;
    const range = Math.max(18, this.peakDb - this.floorDb);
    const gate = this.floorDb + 6;
    return clamp01((db - gate) / range) ** 0.8;
  }
}

export function featuresToVisemes(f: AudioFeatures, open: number): Visemes {
  if (open <= 0.001) return { ...ZERO_VISEMES };
  const b = f.bands;
  const b0 = b[0] ?? 0, b1 = b[1] ?? 0, b2 = b[2] ?? 0, b3 = b[3] ?? 0, b4 = b[4] ?? 0;
  const voiced = b0 + b1 + b2 + 1e-12;
  // F2 position: front vowels ("ee", "ih") put F2 above 1.2 kHz, back vowels ("oo", "oh", "aa")
  // keep it below. Comparing 1.2-2.4 kHz against 0.6-1.2 kHz ignores how strong F1 is.
  const front = b2 / (b1 + b2 + 1e-12);
  // Rounded back vowels have almost nothing between 600 Hz and 1.2 kHz relative to F1.
  const low = b0 / (b0 + b1 + 1e-12);
  const fric = b4 / (voiced + b3 + b4); // hiss: "s", "sh", "f"

  const ee = smoothstep(0.55, 0.8, front);
  const ih = smoothstep(0.35, 0.55, front) * (1 - ee) + smoothstep(0.2, 0.5, fric) * 0.6;
  const rounded = smoothstep(0.55, 0.85, low) * (1 - smoothstep(0.3, 0.55, front));
  const ou = rounded * smoothstep(0.75, 0.95, low);
  const oh = rounded * (1 - smoothstep(0.75, 0.95, low));
  const aa = clamp01(1 - ee - ih - rounded);

  const sum = aa + ih + ou + ee + oh || 1;
  const k = open / sum;
  return { aa: aa * k, ih: ih * k, ou: ou * k, ee: ee * k, oh: oh * k };
}

/** Attack/release smoothing so the mouth doesn't flicker. Times in seconds. */
export class VisemeSmoother {
  private v: Visemes = { ...ZERO_VISEMES };
  constructor(
    private attack = 0.03,
    private release = 0.09,
  ) {}

  step(target: Visemes, dt: number): Visemes {
    for (const k of Object.keys(this.v) as (keyof Visemes)[]) {
      const tau = target[k] > this.v[k] ? this.attack : this.release;
      const a = 1 - Math.exp(-dt / Math.max(tau, 1e-4));
      this.v[k] += (target[k] - this.v[k]) * a;
    }
    return { ...this.v };
  }

  reset(): void {
    this.v = { ...ZERO_VISEMES };
  }
}
