import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  CreateSessionRequest,
  type CreateSessionResponse,
  KnowledgeSearchRequest,
  KnowledgeTextRequest,
  KnowledgeUrlRequest,
  MemoryAddRequest,
  MemorySearchRequest,
  PublishRequest,
} from "@metaavatar/protocol";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";
import { GeminiEmbedder } from "./knowledge/embedder";
import { KnowledgeError, KnowledgeNotFound, KnowledgeStore, MAX_FILE_BYTES } from "./knowledge/store";
import { MemoryStore } from "./memory";
import { AgentStore, ConflictError, NotFoundError } from "./store";
import { TEMPLATES } from "./templates";

export const AGENT_NAME = "meta-avatar";
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MAX_AVATAR_BYTES = 80 * 1024 * 1024;
const MAX_THUMB_BYTES = 400 * 1024;

export interface ApiConfig {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  allowedOrigins: string[];
  /** Where agents.json and uploaded avatars live. null keeps everything in memory (tests). */
  dataDir: string | null;
  /** Folder of .vrm avatar models. null turns the avatar library off (tests). */
  avatarDir?: string | null;
  /** Public base URL of this API, used in links to uploaded avatar files. */
  publicUrl: string;
  /** Gemini key for knowledge-base embeddings; without it, search matches on words only. */
  geminiApiKey?: string;
  embedModel?: string;
  /** Overrides the embedder's "unrelated" level (see GeminiEmbedder.minSimilarity). */
  minSimilarity?: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = env.API_PORT ?? "8787";
  return {
    livekitUrl: env.LIVEKIT_URL ?? "ws://localhost:7880",
    livekitApiKey: env.LIVEKIT_API_KEY ?? "devkey",
    livekitApiSecret: env.LIVEKIT_API_SECRET ?? "secret",
    allowedOrigins: (env.STUDIO_ORIGIN ?? "http://localhost:3100").split(",").map((s) => s.trim()),
    dataDir: env.DATA_DIR ?? join(REPO_ROOT, "data"),
    avatarDir: env.AVATAR_DIR ?? join(REPO_ROOT, "assets", "avatars"),
    publicUrl: env.API_PUBLIC_URL ?? `http://localhost:${port}`,
    geminiApiKey: (env.LIVE_MODEL_API_KEY || env.GEMINI_API_KEY || "").trim() || undefined,
    embedModel: env.GEMINI_EMBED_MODEL || undefined,
    minSimilarity: env.KNOWLEDGE_MIN_SIMILARITY ? Number(env.KNOWLEDGE_MIN_SIMILARITY) : undefined,
  };
}

/** Allows `max` requests per `windowMs` per caller address (in memory; one API process). */
function rateLimit(max: number, windowMs: number): MiddlewareHandler {
  const hits = new Map<string, number[]>();
  return async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const info = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
    const who = info?.socket?.remoteAddress ?? "local";
    const now = Date.now();
    const recent = (hits.get(who) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      c.header("retry-after", String(Math.ceil((windowMs - (now - recent[0]!)) / 1000)));
      return c.json({ error: "too_many_requests" }, 429);
    }
    recent.push(now);
    hits.set(who, recent);
    if (hits.size > 5000) hits.clear();
    return next();
  };
}

function geminiEmbedder(cfg: ApiConfig): GeminiEmbedder {
  const e = new GeminiEmbedder(cfg.geminiApiKey!, cfg.embedModel);
  if (cfg.minSimilarity !== undefined && Number.isFinite(cfg.minSimilarity)) e.minSimilarity = cfg.minSimilarity;
  return e;
}

export function createApp(
  cfg: ApiConfig,
  store = new AgentStore(cfg.dataDir && join(cfg.dataDir, "agents.json")),
  knowledge = new KnowledgeStore(
    cfg.dataDir && join(cfg.dataDir, "knowledge"),
    cfg.geminiApiKey ? geminiEmbedder(cfg) : null,
  ),
  memory = new MemoryStore(cfg.dataDir && join(cfg.dataDir, "memory.json")),
): Hono {
  const app = new Hono();
  const avatarDir = cfg.avatarDir ?? null;

  app.use(
    "*",
    cors({
      origin: cfg.allowedOrigins,
      allowMethods: ["GET", "POST", "PUT", "DELETE"],
      exposeHeaders: ["etag"],
      allowHeaders: ["content-type", "x-filename", "x-based-on"],
      maxAge: 600,
    }),
  );

  // Basic hardening. Responses are data, never pages: no sniffing, no framing, no referrer.
  app.use("*", async (c, next) => {
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("x-frame-options", "DENY");
    c.header("referrer-policy", "no-referrer");
  });
  // JSON bodies are small; file uploads (avatars, documents) check their own, larger limits.
  const smallBody = bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => c.json({ error: "too_large" }, 413) });
  for (const path of ["/agents/*", "/sessions", "/memory/*", "/memory", "/knowledge/text", "/knowledge/url", "/knowledge/search"]) {
    app.use(path, smallBody);
  }
  // Starting a conversation costs model quota and fetching a web page makes this server call out,
  // so both are limited per caller. Generous for one person, tight for a script.
  app.use("/sessions", rateLimit(30, 60_000));
  app.use("/knowledge/url", rateLimit(20, 60_000));

  app.onError((err, c) => {
    if (err instanceof NotFoundError || err instanceof KnowledgeNotFound) return c.json({ error: "not_found" }, 404);
    if (err instanceof ConflictError) return c.json({ error: "conflict" }, 409);
    if (err instanceof KnowledgeError) return c.json({ error: err.code }, 400);
    if (err.name === "ZodError") return c.json({ error: "invalid_request", issues: JSON.parse(err.message) }, 400);
    console.error(err);
    return c.json({ error: "internal" }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true }));

  // Non-secret workspace configuration for Studio's settings page. Never returns the key itself.
  app.get("/workspace", (c) =>
    c.json({
      model: process.env.GEMINI_LIVE_MODEL ?? "gemini-3.1-flash-live-preview",
      apiVersion: process.env.GEMINI_API_VERSION ?? "v1alpha",
      thinkingLevel: process.env.GEMINI_THINKING_LEVEL ?? "minimal",
      turnSilenceMs: Number(process.env.TURN_SILENCE_MS ?? 500),
      geminiKeyConfigured: Boolean(process.env.LIVE_MODEL_API_KEY || process.env.GEMINI_API_KEY),
      embedModel: cfg.geminiApiKey ? (cfg.embedModel ?? "gemini-embedding-001") : null,
      livekitUrl: cfg.livekitUrl,
      dataDir: cfg.dataDir,
      avatarDir,
    }),
  );

  // --- Agents --------------------------------------------------------------------------------
  app.get("/templates", (c) => c.json(TEMPLATES));
  app.get("/agents", (c) => c.json(store.list()));
  app.post("/agents", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { template?: string; name?: string };
    return c.json(store.create(body.template, body.name), 201);
  });
  app.get("/agents/:id", (c) => c.json(store.get(c.req.param("id"))));
  app.put("/agents/:id/draft", async (c) =>
    c.json(store.updateDraft(c.req.param("id"), await c.req.json(), c.req.header("x-based-on") || undefined)),
  );
  app.post("/agents/:id/publish", async (c) => {
    const { note } = PublishRequest.parse(await c.req.json().catch(() => ({})));
    return c.json(store.publish(c.req.param("id"), note));
  });
  // Save the draft as a version without making it live (a checkpoint).
  app.post("/agents/:id/versions", async (c) => {
    const { note } = PublishRequest.parse(await c.req.json().catch(() => ({})));
    return c.json(store.saveVersion(c.req.param("id"), note), 201);
  });
  app.get("/agents/:id/versions/:version", (c) =>
    c.json(store.version(c.req.param("id"), Number(c.req.param("version")))),
  );
  app.post("/agents/:id/live/:version", (c) =>
    c.json(store.setLive(c.req.param("id"), Number(c.req.param("version")))),
  );
  app.post("/agents/:id/restore/:version", (c) =>
    c.json(store.restore(c.req.param("id"), Number(c.req.param("version")))),
  );
  app.post("/agents/:id/duplicate", (c) => c.json(store.duplicate(c.req.param("id")), 201));
  app.delete("/agents/:id", (c) => {
    store.remove(c.req.param("id"));
    memory.forgetAgent(c.req.param("id"));
    return c.body(null, 204);
  });

  // --- Avatar files (VRM) ---------------------------------------------------------------------
  // The library is a plain folder (assets/avatars by default): every .vrm in it is listed, so a
  // model dropped there by hand shows up in Studio. An optional "<file>.json" beside a model holds
  // its display name, where it came from and its licence.
  const safeName = (file: string) => !/[\\/]/.test(file) && !file.startsWith(".") && /\.vrm$/i.test(file);
  const avatarList = () =>
    avatarDir && existsSync(avatarDir)
      ? readdirSync(avatarDir)
          .filter(safeName)
          .map((file) => {
            let meta: { name?: string; source?: string; licence?: string } = {};
            try {
              meta = JSON.parse(readFileSync(join(avatarDir, `${file}.json`), "utf8"));
            } catch {
              // no notes for this model, or unreadable ones: fall back to the file name
            }
            const st = statSync(join(avatarDir, file));
            return {
              file,
              name: meta.name || file.replace(/\.vrm$/i, "").replace(/[_-]+/g, " "),
              url: `${cfg.publicUrl}/avatars/files/${encodeURIComponent(file)}`,
              // Shown in Studio so people can find the file on disk.
              path: relative(REPO_ROOT, join(avatarDir, file)),
              source: meta.source,
              licence: meta.licence,
              // A small portrait Studio captures the first time the model is shown on a stage.
              thumbnail: existsSync(join(avatarDir, `${file}.png`))
                ? `${cfg.publicUrl}/avatars/thumbs/${encodeURIComponent(file)}?v=${Math.round(statSync(join(avatarDir, `${file}.png`)).mtimeMs)}`
                : undefined,
              bytes: st.size,
              addedAt: st.mtime.toISOString(),
            };
          })
          .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
      : [];

  app.get("/avatars", (c) => c.json(avatarList()));
  app.post("/avatars", async (c) => {
    if (!avatarDir) return c.json({ error: "uploads_disabled" }, 400);
    const name = decodeURIComponent(c.req.header("x-filename") ?? "avatar.vrm");
    if (!name.toLowerCase().endsWith(".vrm")) return c.json({ error: "not_vrm" }, 400);
    // Refuse oversized uploads before reading them into memory.
    if (Number(c.req.header("content-length") ?? 0) > MAX_AVATAR_BYTES) return c.json({ error: "bad_size" }, 400);
    const buf = Buffer.from(await c.req.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_AVATAR_BYTES) return c.json({ error: "bad_size" }, 400);
    // VRM files are glTF binaries: they start with "glTF".
    if (buf.subarray(0, 4).toString("latin1") !== "glTF") return c.json({ error: "not_vrm" }, 400);
    mkdirSync(avatarDir, { recursive: true });
    // Keep the name the file came with (made safe), so it is recognisable in the folder.
    const base = basename(name).replace(/\.vrm$/i, "").replace(/[^\w .()-]+/g, "_").replace(/^\.+/, "").slice(0, 80) || "avatar";
    let file = `${base}.vrm`;
    for (let n = 2; existsSync(join(avatarDir, file)); n++) file = `${base}-${n}.vrm`;
    writeFileSync(join(avatarDir, file), buf);
    return c.json(avatarList().find((a) => a.file === file), 201);
  });
  app.get("/avatars/files/:file", (c) => {
    const file = c.req.param("file");
    if (!avatarDir || !safeName(file) || !existsSync(join(avatarDir, file))) {
      return c.json({ error: "not_found" }, 404);
    }
    const st = statSync(join(avatarDir, file));
    // Files can be replaced on disk under the same name, so browsers re-check with the ETag and
    // get a 304 when nothing changed. The file is streamed: models are 10-80 MB, and reading each
    // one into memory per request made the API's memory balloon under load.
    const etag = `"${st.size}-${Math.round(st.mtimeMs)}"`;
    const headers = { "content-type": "model/gltf-binary", "cache-control": "no-cache", etag };
    if (c.req.header("if-none-match") === etag) return c.body(null, 304, headers);
    const stream = Readable.toWeb(createReadStream(join(avatarDir, file))) as unknown as ReadableStream;
    return new Response(stream, { headers: { ...headers, "content-length": String(st.size) } });
  });
  app.put("/avatars/:file/thumbnail", async (c) => {
    const file = c.req.param("file");
    if (!avatarDir || !safeName(file) || !existsSync(join(avatarDir, file))) return c.json({ error: "not_found" }, 404);
    if (Number(c.req.header("content-length") ?? 0) > MAX_THUMB_BYTES) return c.json({ error: "bad_size" }, 400);
    const buf = Buffer.from(await c.req.arrayBuffer());
    const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!png || buf.length > MAX_THUMB_BYTES) return c.json({ error: "bad_size" }, 400);
    writeFileSync(join(avatarDir, `${file}.png`), buf);
    return c.json(avatarList().find((a) => a.file === file));
  });
  app.get("/avatars/thumbs/:file", (c) => {
    const file = c.req.param("file");
    if (!avatarDir || !safeName(file) || !existsSync(join(avatarDir, `${file}.png`))) return c.json({ error: "not_found" }, 404);
    return c.body(readFileSync(join(avatarDir, `${file}.png`)), 200, {
      "content-type": "image/png",
      "cache-control": "public, max-age=31536000, immutable",
    });
  });
  app.delete("/avatars/:file", (c) => {
    const file = c.req.param("file");
    if (!avatarDir || !safeName(file) || !existsSync(join(avatarDir, file))) return c.json({ error: "not_found" }, 404);
    for (const f of [file, `${file}.json`, `${file}.png`]) if (existsSync(join(avatarDir, f))) unlinkSync(join(avatarDir, f));
    return c.body(null, 204);
  });

  // --- Knowledge base ------------------------------------------------------------------------
  app.get("/knowledge", (c) => c.json(knowledge.list()));
  app.post("/knowledge", async (c) => {
    const name = decodeURIComponent(c.req.header("x-filename") ?? "");
    if (!name) return c.json({ error: "invalid_request" }, 400);
    if (Number(c.req.header("content-length") ?? 0) > MAX_FILE_BYTES) return c.json({ error: "too_large" }, 400);
    return c.json(knowledge.addFile(name, new Uint8Array(await c.req.arrayBuffer())), 201);
  });
  app.post("/knowledge/text", async (c) => {
    const { title, text } = KnowledgeTextRequest.parse(await c.req.json().catch(() => ({})));
    return c.json(knowledge.addText(title, text), 201);
  });
  app.post("/knowledge/url", async (c) => {
    const parsed = KnowledgeUrlRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "bad_url" }, 400);
    return c.json(knowledge.addUrl(parsed.data.url), 201);
  });
  // Used by Studio's test console and by the agent worker's search_knowledge_base tool.
  app.post("/knowledge/search", async (c) =>
    c.json(await knowledge.search(KnowledgeSearchRequest.parse(await c.req.json().catch(() => ({}))))),
  );
  app.post("/knowledge/:id/embed", async (c) => c.json(await knowledge.reembed(c.req.param("id"))));
  app.delete("/knowledge/:id", (c) => {
    knowledge.remove(c.req.param("id"));
    return c.body(null, 204);
  });

  // --- Memory --------------------------------------------------------------------------------
  // What an agent remembers about one visitor. The worker's remember/recall tools and Studio's
  // Memory panel both use these routes.
  app.get("/memory", (c) => {
    const agentId = c.req.query("agentId");
    const endUser = c.req.query("endUser");
    // With a visitor: that visitor's notes for one agent. Without: everything (Studio's overview).
    if (endUser) return agentId ? c.json(memory.list(agentId, endUser)) : c.json({ error: "invalid_request" }, 400);
    return c.json(memory.all(agentId || undefined));
  });
  app.post("/memory", async (c) => {
    const { agentId, endUser, text } = MemoryAddRequest.parse(await c.req.json().catch(() => ({})));
    // Only agents with memory switched on (and never children's agents) may store anything.
    const agent = store.get(agentId);
    const allowed = [agent.draft, agent.published].some((a) => a?.memory && a.audience !== "kids");
    if (!allowed) return c.json({ error: "memory_off" }, 409);
    return c.json(memory.add(agentId, endUser, text), 201);
  });
  app.post("/memory/search", async (c) => {
    const { agentId, endUser, query, limit } = MemorySearchRequest.parse(await c.req.json().catch(() => ({})));
    return c.json(memory.search(agentId, endUser, query, limit));
  });
  // Undo for a removed note: Studio sends back the note it just deleted.
  app.post("/memory/restore", async (c) => {
    const m = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const ok = m && ["id", "agentId", "endUser", "text", "createdAt"].every((k) => typeof m[k] === "string");
    if (!ok || !/^mem_[a-f0-9]{12}$/.test(m.id as string) || (m.text as string).length > 300) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const { id, agentId, endUser, text, createdAt } = m as Record<string, string>;
    return c.json(memory.restore({ id: id!, agentId: agentId!, endUser: endUser!, text: text!, createdAt: createdAt! }), 201);
  });
  app.delete("/memory/:id", (c) =>
    memory.remove(c.req.param("id")) ? c.body(null, 204) : c.json({ error: "not_found" }, 404),
  );
  // "Forget me": everything about one visitor, for one agent or for all of them.
  app.delete("/memory", (c) => {
    const endUser = c.req.query("endUser");
    if (!endUser) return c.json({ error: "invalid_request" }, 400);
    return c.json({ removed: memory.forget(endUser, c.req.query("agentId") || undefined) });
  });

  // --- Sessions ------------------------------------------------------------------------------
  app.post("/sessions", async (c) => {
    const parsed = CreateSessionRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    const agent = store.sessionConfig(parsed.data.agentId, parsed.data.version);
    if (!agent) return c.json({ error: "not_published" }, 409);
    // Documents deleted from the library since the agent was saved are dropped here, so the worker
    // only offers the search tool when there is something to search.
    agent.knowledge = agent.knowledge.filter((id) => knowledge.has(id));
    // Memory needs a visitor to remember, and is never used with children.
    const endUser = parsed.data.endUserRef;
    agent.memory = agent.memory && agent.audience !== "kids" && Boolean(endUser);
    const session = agent.memory
      ? { agent, endUser, memories: memory.list(agent.id, endUser!).slice(0, 20).map((m) => m.text) }
      : { agent };

    const sessionId = `ses_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const identity = `user_${crypto.randomUUID().slice(0, 8)}`;
    const at = new AccessToken(cfg.livekitApiKey, cfg.livekitApiSecret, { identity, ttl: "15m" });
    at.addGrant({ room: sessionId, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    // Joining the room dispatches our worker with the agent config attached.
    at.roomConfig = new RoomConfiguration({
      agents: [new RoomAgentDispatch({ agentName: AGENT_NAME, metadata: JSON.stringify(session) })],
    });

    const body: CreateSessionResponse = {
      sessionId,
      livekitUrl: cfg.livekitUrl,
      token: await at.toJwt(),
      agent: { id: agent.id, name: agent.name, renderer: agent.renderer, avatar: agent.avatar },
    };
    return c.json(body, 201);
  });

  return app;
}
