/**
 * Knowledge base: the documents agents answer from.
 *
 * Adding a document returns straight away with status "processing"; text extraction, chunking and
 * embedding run in the background and Studio polls the list. Search ranks passages two ways, by
 * meaning (embeddings) and by shared words (BM25), and merges the two rankings, so it still works
 * when the embedding service is out of quota or no key is set.
 *
 * Laptop profile: an index file plus one file of passages per document under data/knowledge/.
 * Everything is held in memory too, which is fine for a library of hundreds of documents. The class
 * is the seam for pgvector: the routes only use its public methods.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  KnowledgeDoc,
  KnowledgePassage,
  KnowledgeSearchRequest,
  KnowledgeSearchResponse,
} from "@metaavatar/protocol";
import { decodeVector, dot, type Embedder, encodeVector } from "./embedder";
import { chunkText, extractText, htmlToText, SUPPORTED_EXTENSIONS, tidy, tokens, UnsupportedFileError } from "./text";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_CHARS = 3_000_000;
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
/** How far below the best passage's similarity another passage may be and still count. */
const SIMILARITY_MARGIN = 0.06;
/** Share of the question's distinctive words (weighted by rarity) a passage needs for a word match. */
const WORD_COVERAGE = 0.55;

interface StoredDoc extends KnowledgeDoc {
  /** Embedding model the vectors came from; a different model means they must be redone. */
  model?: string;
}

interface Passage {
  text: string;
  words: string[];
  vector: Float32Array | null;
}

export class KnowledgeError extends Error {
  constructor(readonly code: "unsupported_file" | "too_large" | "bad_url") {
    super(code);
  }
}

/** Refuses addresses that point back at this machine or a private network. */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new KnowledgeError("bad_url");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateHost =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "::1" ||
    /^f[cde]/.test(host);
  if (!/^https?:$/.test(url.protocol) || privateHost) throw new KnowledgeError("bad_url");
  return url;
}

export class KnowledgeStore {
  private docs: StoredDoc[] = [];
  private passages = new Map<string, Passage[]>();
  private jobs = new Set<Promise<void>>();

  constructor(
    private dir: string | null,
    private embedder: Embedder | null,
    private fetchFn: typeof fetch = fetch,
  ) {
    if (!dir || !existsSync(join(dir, "index.json"))) return;
    try {
      this.docs = (JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as { docs: StoredDoc[] }).docs ?? [];
    } catch {
      console.warn("knowledge store: index.json is unreadable, starting with an empty library");
      return;
    }
    for (const d of this.docs) {
      if (d.status === "processing") {
        // The API stopped while this document was being read.
        d.status = "failed";
        d.error = "Processing was interrupted. Remove this document and add it again.";
        continue;
      }
      try {
        const file = JSON.parse(readFileSync(join(dir, `${d.id}.json`), "utf8")) as {
          chunks: { text: string; vector?: string }[];
        };
        this.passages.set(
          d.id,
          file.chunks.map((c) => ({
            text: c.text,
            words: tokens(c.text),
            vector: c.vector ? decodeVector(c.vector) : null,
          })),
        );
      } catch {
        d.status = "failed";
        d.error = "This document's saved text is missing. Remove it and add it again.";
      }
    }
  }

  // --- Reading ---------------------------------------------------------------------------------
  list(): KnowledgeDoc[] {
    return [...this.docs]
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
      .map(({ model: _model, ...doc }) => doc);
  }

  has(id: string): boolean {
    return this.docs.some((d) => d.id === id);
  }

  /** Resolves when no document is being processed (used by tests and shutdown). */
  async idle(): Promise<void> {
    while (this.jobs.size) await Promise.all(this.jobs);
  }

  // --- Adding ----------------------------------------------------------------------------------
  addFile(filename: string, bytes: Uint8Array): KnowledgeDoc {
    if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) throw new KnowledgeError("too_large");
    const title = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || filename;
    return this.start({ title, kind: "file", origin: filename }, () => extractText(filename, bytes));
  }

  addText(title: string, text: string): KnowledgeDoc {
    return this.start({ title, kind: "text", origin: "" }, async () => tidy(text));
  }

  addUrl(raw: string): KnowledgeDoc {
    const url = assertPublicUrl(raw);
    const doc = this.start({ title: url.hostname + url.pathname.replace(/\/$/, ""), kind: "url", origin: url.href }, async () => {
      const res = await this.fetchFn(url, {
        headers: { accept: "text/html,text/plain,application/pdf;q=0.9,*/*;q=0.5", "user-agent": "KnowledgeFetcher/1.0" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`The page answered with an error (${res.status}).`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > MAX_PAGE_BYTES) throw new Error("The page is larger than 5 MB.");
      const type = res.headers.get("content-type") ?? "";
      if (type.includes("pdf")) return extractText("page.pdf", bytes);
      if (type.includes("html") || type === "") {
        const page = htmlToText(new TextDecoder().decode(bytes));
        if (page.title) this.find(doc.id).title = page.title.slice(0, 120);
        return page.text;
      }
      if (type.startsWith("text/")) return tidy(new TextDecoder().decode(bytes));
      throw new Error("That address isn't a web page, text or PDF.");
    });
    return doc;
  }

  private start(meta: Pick<StoredDoc, "title" | "kind" | "origin">, read: () => Promise<string>): KnowledgeDoc {
    if (meta.kind === "file") {
      // Fail before queuing, so the upload request itself reports an unsupported type.
      const ext = meta.origin.toLowerCase().slice(meta.origin.lastIndexOf("."));
      if (!SUPPORTED_EXTENSIONS.includes(ext)) throw new KnowledgeError("unsupported_file");
    }
    const doc: StoredDoc = {
      id: `doc_${randomBytes(6).toString("hex")}`,
      ...meta,
      title: meta.title.slice(0, 120),
      status: "processing",
      chunks: 0,
      chars: 0,
      embedded: false,
      addedAt: new Date().toISOString(),
    };
    this.docs.push(doc);
    this.saveIndex();
    const job = this.ingest(doc, read).finally(() => this.jobs.delete(job));
    this.jobs.add(job);
    return this.list().find((d) => d.id === doc.id)!;
  }

  private async ingest(doc: StoredDoc, read: () => Promise<string>): Promise<void> {
    try {
      const text = await read();
      if (!this.has(doc.id)) return; // removed while it was being read
      if (text.length < 20) throw new Error("No readable text was found. Scanned PDFs need text recognition first.");
      if (text.length > MAX_CHARS) throw new Error("This document is too long. Split it into parts of under 3 million characters.");
      const chunks = chunkText(text);
      this.passages.set(
        doc.id,
        chunks.map((c) => ({ text: c, words: tokens(c), vector: null })),
      );
      doc.chunks = chunks.length;
      doc.chars = text.length;
      doc.status = "ready";
      delete doc.error;
      this.saveDoc(doc.id);
      await this.embedDoc(doc);
    } catch (e) {
      if (!this.has(doc.id)) return;
      doc.status = "failed";
      doc.error =
        e instanceof UnsupportedFileError
          ? "This file type isn't supported."
          : e instanceof Error && e.message
            ? e.message.slice(0, 300)
            : "The document couldn't be read.";
    }
    this.saveIndex();
  }

  /** Embeds a document's passages. A failure leaves the document usable with word matching only. */
  private async embedDoc(doc: StoredDoc): Promise<void> {
    const list = this.passages.get(doc.id);
    if (!this.embedder || !list?.length) return;
    try {
      // Each passage is embedded with its document title, which helps short passages match.
      const vectors = await this.embedder.embed(
        list.map((p) => `${doc.title}\n\n${p.text}`),
        "document",
      );
      if (!this.has(doc.id)) return;
      list.forEach((p, i) => {
        p.vector = vectors[i] ?? null;
      });
      doc.embedded = true;
      doc.model = this.embedder.model;
      this.saveDoc(doc.id);
    } catch (e) {
      console.warn(`knowledge: embedding "${doc.title}" failed, word matching only: ${(e as Error).message}`);
      doc.embedded = false;
    }
  }

  /** Retries embeddings for a document that only has word matching. */
  async reembed(id: string): Promise<KnowledgeDoc> {
    const doc = this.find(id);
    if (doc.status === "ready") {
      await this.embedDoc(doc);
      this.saveIndex();
    }
    return this.list().find((d) => d.id === id)!;
  }

  remove(id: string): void {
    this.find(id);
    this.docs = this.docs.filter((d) => d.id !== id);
    this.passages.delete(id);
    if (this.dir && existsSync(join(this.dir, `${id}.json`))) unlinkSync(join(this.dir, `${id}.json`));
    this.saveIndex();
  }

  // --- Search ----------------------------------------------------------------------------------
  async search(req: KnowledgeSearchRequest): Promise<KnowledgeSearchResponse> {
    const wanted = req.documentIds ? new Set(req.documentIds) : null;
    const pool: { doc: StoredDoc; chunk: number; p: Passage }[] = [];
    for (const doc of this.docs) {
      if (doc.status !== "ready" || (wanted && !wanted.has(doc.id))) continue;
      (this.passages.get(doc.id) ?? []).forEach((p, chunk) => pool.push({ doc, chunk, p }));
    }
    if (pool.length === 0) return { passages: [], mode: "words" };

    // Ranking 1: shared words (BM25).
    const terms = [...new Set(tokens(req.query))];
    const df = new Map<string, number>();
    for (const t of terms) df.set(t, pool.filter((c) => c.p.words.includes(t)).length);
    const avgLen = pool.reduce((n, c) => n + c.p.words.length, 0) / pool.length || 1;
    const idf = (t: string) => {
      // A word no document contains counts as much as the rarest word that is present.
      const n = Math.max(df.get(t) ?? 0, 1);
      return Math.log(1 + (pool.length - n + 0.5) / (n + 0.5));
    };
    const totalWeight = terms.reduce((n, t) => n + idf(t), 0) || 1;
    const lexical = pool
      .map((c, i) => {
        let score = 0;
        let covered = 0;
        for (const t of terms) {
          const tf = c.p.words.filter((w) => w === t).length;
          if (!tf) continue;
          covered += idf(t);
          score += (idf(t) * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * c.p.words.length) / avgLen));
        }
        // A passage must share most of the question's distinctive words; one common word in
        // passing ("back", "long") doesn't make it a match.
        return { i, score: covered / totalWeight >= WORD_COVERAGE ? score : 0 };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    // Ranking 2: meaning (cosine similarity), when the query can be embedded with the same model.
    let semantic: { i: number; score: number }[] = [];
    let semanticRan = false;
    const model = this.embedder?.model;
    if (this.embedder && pool.some((c) => c.p.vector && c.doc.model === model)) {
      try {
        const [q] = await this.embedder.embed([req.query], "query");
        const scored = pool
          .flatMap((c, i) => (c.p.vector && c.doc.model === model && q ? [{ i, score: dot(q, c.p.vector) }] : []))
          .sort((a, b) => b.score - a.score);
        // Keep passages close to the best one and above the model's "unrelated" level. Without this
        // every question brings back `limit` passages, however far off, and their documents would
        // be shown as sources.
        const floor = Math.max(this.embedder.minSimilarity ?? 0, (scored[0]?.score ?? 0) - SIMILARITY_MARGIN);
        semantic = scored.filter((x) => x.score >= floor).slice(0, req.limit * 3);
        semanticRan = true;
      } catch (e) {
        console.warn(`knowledge: query embedding failed, matching on words only: ${(e as Error).message}`);
      }
    }

    // Merge by rank (reciprocal rank fusion), which needs no tuning between the two score scales.
    const K = 60;
    const fused = new Map<number, number>();
    for (const ranking of [lexical, semantic]) {
      ranking.forEach((r, rank) => fused.set(r.i, (fused.get(r.i) ?? 0) + 1 / (K + rank + 1)));
    }
    const best = (semanticRan ? 2 : 1) / (K + 1);
    const passages: KnowledgePassage[] = [...fused.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, req.limit)
      .map(([i, score]) => {
        const c = pool[i]!;
        return { documentId: c.doc.id, title: c.doc.title, chunk: c.chunk, text: c.p.text, score: Number((score / best).toFixed(3)) };
      });
    return { passages, mode: semanticRan ? "meaning" : "words" };
  }

  // --- Persistence -----------------------------------------------------------------------------
  private find(id: string): StoredDoc {
    const d = this.docs.find((x) => x.id === id);
    if (!d) throw new KnowledgeNotFound(id);
    return d;
  }

  private write(name: string, data: unknown): void {
    if (!this.dir) return;
    mkdirSync(this.dir, { recursive: true });
    const file = join(this.dir, name);
    writeFileSync(`${file}.tmp`, JSON.stringify(data));
    renameSync(`${file}.tmp`, file);
  }

  private saveIndex(): void {
    this.write("index.json", { docs: this.docs });
  }

  private saveDoc(id: string): void {
    const chunks = (this.passages.get(id) ?? []).map((p) => ({
      text: p.text,
      ...(p.vector ? { vector: encodeVector(p.vector) } : {}),
    }));
    this.write(`${id}.json`, { chunks });
  }
}

export class KnowledgeNotFound extends Error {}
