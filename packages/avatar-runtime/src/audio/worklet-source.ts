/**
 * AudioWorklet processor, shipped as a string and loaded from a Blob URL so it works with any
 * bundler. It does two jobs on the agent's audio:
 *  1. Analysis: every HOP samples it runs an FFT over the last WINDOW samples and posts band
 *     energies plus the context time of the window centre.
 *  2. Optional delay line: outputs the audio `delaySamples` late, so the lip-sync data is ready
 *     before the sound reaches the speakers (exact sync mode).
 */
export const LIPSYNC_WORKLET_NAME = "metaavatar-lipsync";

export const LIPSYNC_WORKLET_SOURCE = /* js */ `
const WINDOW = 1024;
const HOP = 512;
// Band edges in Hz: F1 low, F1 high, F2 front vowels, upper formants, fricatives.
const BANDS = [[90, 600], [600, 1200], [1200, 2400], [2400, 4000], [4000, 8000]];

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

class LipSyncProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.delaySamples = Math.max(0, Math.round(o.delaySamples || 0));
    this.ring = new Float32Array(Math.max(1, this.delaySamples + 256));
    this.ringW = 0;
    this.buf = new Float32Array(WINDOW);
    this.bufFill = 0;
    this.sinceHop = 0;
    this.hann = new Float32Array(WINDOW);
    for (let i = 0; i < WINDOW; i++) this.hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (WINDOW - 1));
    this.re = new Float32Array(WINDOW);
    this.im = new Float32Array(WINDOW);
    this.port.onmessage = (e) => {
      if (e.data && typeof e.data.delaySamples === "number") {
        this.delaySamples = Math.max(0, Math.round(e.data.delaySamples));
        this.ring = new Float32Array(Math.max(1, this.delaySamples + 256));
        this.ringW = 0;
      }
    };
  }

  analyse(endFrame) {
    let sumSq = 0;
    for (let i = 0; i < WINDOW; i++) {
      const s = this.buf[(this.bufFill + i) % WINDOW];
      sumSq += s * s;
      this.re[i] = s * this.hann[i];
      this.im[i] = 0;
    }
    fft(this.re, this.im);
    const binHz = sampleRate / WINDOW;
    const bands = new Float32Array(BANDS.length);
    for (let b = 0; b < BANDS.length; b++) {
      const lo = Math.max(1, Math.floor(BANDS[b][0] / binHz));
      const hi = Math.min(WINDOW / 2 - 1, Math.ceil(BANDS[b][1] / binHz));
      let e = 0;
      for (let k = lo; k <= hi; k++) e += this.re[k] * this.re[k] + this.im[k] * this.im[k];
      bands[b] = e;
    }
    const rms = Math.sqrt(sumSq / WINDOW);
    // Context time of the centre of the analysed window.
    const t = (endFrame - WINDOW / 2) / sampleRate;
    this.port.postMessage({ t, rms, bands }, [bands.buffer]);
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const n = (output && output[0] && output[0].length) || 128;
    const mono = new Float32Array(n);
    if (input && input.length > 0) {
      for (let c = 0; c < input.length; c++) {
        const ch = input[c];
        for (let i = 0; i < n; i++) mono[i] += ch[i] / input.length;
      }
    }
    // Analysis (on undelayed audio).
    for (let i = 0; i < n; i++) {
      this.buf[this.bufFill] = mono[i];
      this.bufFill = (this.bufFill + 1) % WINDOW;
      this.sinceHop++;
      if (this.sinceHop >= HOP) {
        this.sinceHop = 0;
        this.analyse(currentFrame + i + 1);
      }
    }
    // Delay line output.
    if (output) {
      const len = this.ring.length;
      for (let i = 0; i < n; i++) {
        this.ring[this.ringW] = mono[i];
        const r = (this.ringW - this.delaySamples + len) % len;
        const v = this.delaySamples === 0 ? mono[i] : this.ring[r];
        for (let c = 0; c < output.length; c++) output[c][i] = v;
        this.ringW = (this.ringW + 1) % len;
      }
    }
    return true;
  }
}
registerProcessor("${"metaavatar-lipsync"}", LipSyncProcessor);
`;
