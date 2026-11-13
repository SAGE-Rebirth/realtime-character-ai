/** Turns text into vectors so search can match on meaning, not only on shared words. */

export interface Embedder {
  /** Identifies the vector space; vectors from different models can't be compared. */
  readonly model: string;
  /**
   * Passages whose similarity to the question is below this are treated as unrelated. It depends on
   * the model: embedding models squeeze most text into a narrow band of similarity.
   */
  readonly minSimilarity?: number;
  embed(texts: string[], purpose: "document" | "query"): Promise<Float32Array[]>;
}

const BATCH = 50;

/** Gemini embeddings over REST (free tier is enough for a laptop library). */
export class GeminiEmbedder implements Embedder {
  /**
   * Measured with gemini-embedding-001 at 768 dimensions on a small sample: passages that answer a
   * question scored 0.64-0.72, unrelated ones at most 0.57. Override with KNOWLEDGE_MIN_SIMILARITY.
   */
  minSimilarity = 0.58;

  constructor(
    private apiKey: string,
    readonly model = "gemini-embedding-001",
    private dimensions = 768,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async embed(texts: string[], purpose: "document" | "query"): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const res = await this.fetchFn(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify({
            requests: texts.slice(i, i + BATCH).map((text) => ({
              model: `models/${this.model}`,
              content: { parts: [{ text }] },
              taskType: purpose === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
              outputDimensionality: this.dimensions,
            })),
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!res.ok) throw new Error(`embedding request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { embeddings?: { values: number[] }[] };
      for (const e of body.embeddings ?? []) out.push(normalise(Float32Array.from(e.values)));
    }
    if (out.length !== texts.length) throw new Error("embedding response had the wrong number of vectors");
    return out;
  }
}

/** Unit length, so a dot product is the cosine similarity. */
export function normalise(v: Float32Array): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const len = Math.sqrt(sum) || 1;
  return v.map((x) => x / len);
}

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += a[i]! * b[i]!;
  return sum;
}

export const encodeVector = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
export function decodeVector(b64: string): Float32Array {
  const buf = Buffer.from(b64, "base64");
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
