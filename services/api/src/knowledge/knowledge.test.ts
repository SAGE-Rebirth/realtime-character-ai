import type { AgentDetail, KnowledgeDoc, KnowledgeSearchResponse } from "@metaavatar/protocol";
import { describe, expect, it } from "vitest";
import { type ApiConfig, createApp } from "../app";
import { AgentStore } from "../store";
import { type Embedder, normalise } from "./embedder";
import { assertPublicUrl, KnowledgeStore } from "./store";
import { chunkText, htmlToText } from "./text";

const cfg: ApiConfig = {
  livekitUrl: "ws://lk",
  livekitApiKey: "k",
  livekitApiSecret: "secret-secret-secret-secret-32b",
  allowedOrigins: ["http://localhost:3100"],
  dataDir: null,
  publicUrl: "http://api",
};

/** Places text on three axes (pets, money, travel) by topic words, including synonyms BM25 can't see. */
class TopicEmbedder implements Embedder {
  readonly model = "topic-test";
  calls = 0;
  fail = false;
  async embed(texts: string[]): Promise<Float32Array[]> {
    this.calls++;
    if (this.fail) throw new Error("quota");
    const axis = (t: string, words: string[]) => words.filter((w) => t.toLowerCase().includes(w)).length;
    return texts.map((t) =>
      normalise(
        Float32Array.from([
          axis(t, ["dog", "puppy", "cat", "pet", "vet"]) + 0.01,
          axis(t, ["refund", "money back", "invoice", "price"]) + 0.01,
          axis(t, ["flight", "hotel", "luggage", "baggage"]) + 0.01,
        ]),
      ),
    );
  }
}

const PETS = "Puppies need three meals a day until six months old. Take your dog to the vet for vaccinations at eight weeks.";
const MONEY = "Refunds are issued within fourteen days of a return. The invoice shows the price paid including tax.";

describe("text handling", () => {
  it("splits long text into overlapping passages at sentence ends", () => {
    const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} talks about topic ${i % 7}.`).join(" ");
    const chunks = chunkText(text, 300, 60);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 300)).toBe(true);
    expect(chunks.slice(0, -1).every((c) => c.endsWith("."))).toBe(true);
    // Nothing is lost: every sentence appears in some passage.
    for (let i = 0; i < 60; i++) expect(chunks.some((c) => c.includes(`Sentence number ${i} `))).toBe(true);
  });

  it("reads the visible text of a web page", () => {
    const page = htmlToText(
      "<html><head><title>Help &amp; FAQ</title><style>p{}</style></head><body><nav>Menu</nav><p>Open 9&ndash;5.</p><script>x()</script><p>Closed&nbsp;Sunday</p></body></html>",
    );
    expect(page.title).toBe("Help & FAQ");
    expect(page.text).toContain("Closed Sunday");
    expect(page.text).not.toMatch(/Menu|x\(\)|p\{\}/);
  });

  it("refuses addresses on this machine or a private network", () => {
    for (const bad of ["http://localhost:8787/x", "http://127.0.0.1/", "http://192.168.1.4/", "file:///etc/passwd", "ftp://example.com", "nope"]) {
      expect(() => assertPublicUrl(bad)).toThrow();
    }
    expect(assertPublicUrl("https://example.com/help").hostname).toBe("example.com");
  });
});

describe("KnowledgeStore", () => {
  it("finds passages by meaning, and by words when embeddings are unavailable", async () => {
    const embedder = new TopicEmbedder();
    const store = new KnowledgeStore(null, embedder);
    const pets = store.addText("Pet care", PETS);
    const money = store.addText("Billing", MONEY);
    expect(pets.status).toBe("processing");
    await store.idle();
    expect(store.list().every((d) => d.status === "ready" && d.embedded)).toBe(true);

    // "money back" shares no word with the billing text; only the embedding links them.
    const byMeaning = await store.search({ query: "Can I get my money back?", limit: 2 });
    expect(byMeaning.mode).toBe("meaning");
    expect(byMeaning.passages[0]?.documentId).toBe(money.id);

    embedder.fail = true;
    const byWords = await store.search({ query: "when is the vet visit for vaccinations", limit: 2 });
    expect(byWords.mode).toBe("words");
    expect(byWords.passages[0]?.documentId).toBe(pets.id);
    expect((await store.search({ query: "zebra quantum", limit: 2 })).passages).toEqual([]);

    // Restricting to an agent's documents never leaks the others.
    const scoped = await store.search({ query: "vet vaccinations refund invoice", documentIds: [money.id], limit: 4 });
    expect(scoped.passages.every((p) => p.documentId === money.id)).toBe(true);
  });

  it("keeps a document usable when embedding fails, and can retry later", async () => {
    const embedder = new TopicEmbedder();
    embedder.fail = true;
    const store = new KnowledgeStore(null, embedder);
    const doc = store.addText("Pet care", PETS);
    await store.idle();
    expect(store.list()[0]).toMatchObject({ status: "ready", embedded: false });
    embedder.fail = false;
    expect((await store.reembed(doc.id)).embedded).toBe(true);
  });

  it("survives a restart, and reports unreadable documents in plain words", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "kb-"));
    const store = new KnowledgeStore(dir, new TopicEmbedder());
    store.addText("Pet care", PETS);
    const empty = store.addFile("scan.txt", new TextEncoder().encode("   \n "));
    await store.idle();
    expect(store.list().find((d) => d.id === empty.id)).toMatchObject({ status: "failed" });
    expect(() => store.addFile("photo.png", new Uint8Array([1, 2, 3]))).toThrow();

    const reopened = new KnowledgeStore(dir, new TopicEmbedder());
    expect(reopened.list()).toHaveLength(2);
    const found = await reopened.search({ query: "puppy meals", limit: 1 });
    expect(found.mode).toBe("meaning");
    expect(found.passages[0]?.title).toBe("Pet care");
  });

  it("reads a web page through the fetcher it is given", async () => {
    const fakeFetch = (async () =>
      new Response("<title>Opening hours</title><p>The shop opens at nine and closes at five on weekdays.</p>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      })) as unknown as typeof fetch;
    const store = new KnowledgeStore(null, null, fakeFetch);
    store.addUrl("https://shop.example/hours");
    await store.idle();
    expect(store.list()[0]).toMatchObject({ title: "Opening hours", status: "ready", kind: "url" });
  });
});

describe("knowledge routes", () => {
  it("adds, searches and removes documents, and sessions only carry documents that still exist", async () => {
    const knowledge = new KnowledgeStore(null, new TopicEmbedder());
    const app = createApp(cfg, new AgentStore(null), knowledge);
    const json = (method: string, path: string, body?: unknown) =>
      app.request(path, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

    const upload = await app.request("/knowledge", {
      method: "POST",
      body: new TextEncoder().encode(MONEY),
      headers: { "x-filename": encodeURIComponent("billing policy.md") },
    });
    expect(upload.status).toBe(201);
    const doc = (await upload.json()) as KnowledgeDoc;
    expect(doc.title).toBe("billing policy");
    expect((await json("POST", "/knowledge/text", { title: "", text: "x" })).status).toBe(400);
    expect((await json("POST", "/knowledge/url", { url: "http://localhost/x" })).status).toBe(400);
    expect(
      (await app.request("/knowledge", { method: "POST", body: "x", headers: { "x-filename": "a.exe" } })).status,
    ).toBe(400);
    await knowledge.idle();

    const found = (await (await json("POST", "/knowledge/search", { query: "refund" })).json()) as KnowledgeSearchResponse;
    expect(found.passages[0]?.documentId).toBe(doc.id);

    const agent = (await (await json("GET", "/agents/demo-ava")).json()) as AgentDetail;
    const { id: _id, ...draft } = agent.draft;
    await json("PUT", "/agents/demo-ava/draft", { ...draft, knowledge: [doc.id, "doc_gone"] });
    const { TokenVerifier } = await import("livekit-server-sdk");
    const session = (await (await json("POST", "/sessions", { agentId: "demo-ava", version: "draft" })).json()) as { token: string };
    const claims = await new TokenVerifier(cfg.livekitApiKey, cfg.livekitApiSecret).verify(session.token);
    expect(JSON.parse(claims.roomConfig?.agents?.[0]?.metadata ?? "{}").agent.knowledge).toEqual([doc.id]);

    expect((await json("DELETE", `/knowledge/${doc.id}`)).status).toBe(204);
    expect((await json("DELETE", `/knowledge/${doc.id}`)).status).toBe(404);
  });
});

describe("relevance", () => {
  it("returns nothing by meaning when every passage is below the model's unrelated level", async () => {
    const embedder = new TopicEmbedder();
    const store = new KnowledgeStore(null, embedder);
    store.addText("Pet care", PETS);
    store.addText("Billing", MONEY);
    await store.idle();
    // Both documents are equally (un)related to a travel question on the test axes.
    (embedder as { minSimilarity?: number }).minSimilarity = 0.9;
    const off = await store.search({ query: "is hotel baggage storage free", limit: 4 });
    expect(off).toEqual({ passages: [], mode: "meaning" });
    // A related question still gets only the related document, not filler up to the limit.
    const on = await store.search({ query: "puppy vet", limit: 4 });
    expect(on.passages.map((p) => p.title)).toEqual(["Pet care"]);
  });
});
