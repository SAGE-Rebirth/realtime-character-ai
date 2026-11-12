import { describe, expect, it } from "vitest";
import { LoudnessNormaliser, VisemeSmoother, featuresToVisemes } from "./visemes";

const f = (bands: number[], rms = 0.1) => ({ t: 0, rms, bands });

describe("visemes", () => {
  it("silence closes the mouth", () => {
    const v = featuresToVisemes(f([0, 0, 0, 0, 0], 0), 0);
    expect(v.aa + v.ee + v.ih + v.oh + v.ou).toBe(0);
  });
  it("strong F2 energy reads as ee", () => {
    const v = featuresToVisemes(f([1, 1, 3, 0.2, 0.05]), 1);
    expect(v.ee).toBeGreaterThan(v.aa);
    expect(v.ee).toBeGreaterThan(v.ou);
  });
  it("ee with a strong low F1 still reads as ee (regression)", () => {
    // Formant-synthesised "ee": F1 280 Hz dominates, F2 2300 Hz, little 600-1200 Hz energy.
    const v = featuresToVisemes(f([10, 0.3, 3, 0.4, 0.05]), 1);
    expect(v.ee).toBeGreaterThan(v.ou + v.oh);
  });
  it("energy below 600 Hz reads as rounded", () => {
    const v = featuresToVisemes(f([10, 0.5, 0.1, 0.05, 0.01]), 1);
    expect(v.ou + v.oh).toBeGreaterThan(v.aa + v.ee);
  });
  it("open vowel with balanced low bands reads as aa", () => {
    const v = featuresToVisemes(f([2, 2, 0.3, 0.1, 0.01]), 1);
    expect(v.aa).toBeGreaterThan(Math.max(v.ee, v.ou, v.oh));
  });
  it("total weight equals openness", () => {
    const v = featuresToVisemes(f([2, 2, 1, 0.1, 0.01]), 0.6);
    expect(v.aa + v.ee + v.ih + v.oh + v.ou).toBeCloseTo(0.6, 5);
  });
  it("loudness normaliser opens for speech and stays shut for noise floor", () => {
    const n = new LoudnessNormaliser();
    for (let i = 0; i < 200; i++) n.openness(0.001);
    expect(n.openness(0.001)).toBe(0);
    expect(n.openness(0.2)).toBeGreaterThan(0.5);
  });
  it("smoother approaches target", () => {
    const s = new VisemeSmoother();
    let out = s.step({ aa: 1, ih: 0, ou: 0, ee: 0, oh: 0 }, 0.016);
    expect(out.aa).toBeGreaterThan(0.3);
    for (let i = 0; i < 20; i++) out = s.step({ aa: 1, ih: 0, ou: 0, ee: 0, oh: 0 }, 0.016);
    expect(out.aa).toBeGreaterThan(0.95);
  });
});
