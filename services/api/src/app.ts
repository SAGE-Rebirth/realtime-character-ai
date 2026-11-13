import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CreateSessionRequest,
  type CreateSessionResponse,
  KnowledgeSearchRequest,
  KnowledgeTextRequest,
  KnowledgeUrlRequest,
  PublishRequest,
} from "@metaavatar/protocol";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";
import { GeminiEmbedder } from "./knowledge/embedder";
import { KnowledgeError, KnowledgeNotFound, KnowledgeStore, MAX_FILE_BYTES } from "./knowledge/store";
import { AgentStore, NotFoundError } from "./store";
import { TEMPLATES } from "./templates";

export const AGENT_NAME = "meta-avatar";
const MAX_AVATAR_BYTES = 80 * 1024 * 1024;

export interface ApiConfig {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  allowedOrigins: string[];
  /** Where agents.json and uploaded avatars live. null keeps everything in memory (tests). */
  dataDir: string | null;
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
    dataDir: env.DATA_DIR ?? new URL("../../../data", import.meta.url).pathname,
    publicUrl: env.API_PUBLIC_URL ?? `http://localhost:${port}`,
    geminiApiKey: (env.LIVE_MODEL_API_KEY || env.GEMINI_API_KEY || "").trim() || undefined,
    embedModel: env.GEMINI_EMBED_MODEL || undefined,
    minSimilarity: env.KNOWLEDGE_MIN_SIMILARITY ? Number(env.KNOWLEDGE_MIN_SIMILARITY) : undefined,
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
): Hono {
  const app = new Hono();
  const avatarDir = cfg.dataDir && join(cfg.dataDir, "avatars");

  app.use(
    "*",
    cors({
      origin: cfg.allowedOrigins,
      allowMethods: ["GET", "POST", "PUT", "DELETE"],
      allowHeaders: ["content-type", "x-filename"],
      maxAge: 600,
    }),
  );

  app.onError((err, c) => {
    if (err instanceof NotFoundError || err instanceof KnowledgeNotFound) return c.json({ error: "not_found" }, 404);
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
  app.put("/agents/:id/draft", async (c) => c.json(store.updateDraft(c.req.param("id"), await c.req.json())));
  app.post("/agents/:id/publish", async (c) => {
    const { note } = PublishRequest.parse(await c.req.json().catch(() => ({})));
    return c.json(store.publish(c.req.param("id"), note));
  });
  app.post("/agents/:id/restore/:version", (c) =>
    c.json(store.restore(c.req.param("id"), Number(c.req.param("version")))),
  );
  app.post("/agents/:id/duplicate", (c) => c.json(store.duplicate(c.req.param("id")), 201));
  app.delete("/agents/:id", (c) => {
    store.remove(c.req.param("id"));
    return c.body(null, 204);
  });

  // --- Avatar files (VRM) ---------------------------------------------------------------------
  const avatarList = () =>
    avatarDir && existsSync(avatarDir)
      ? readdirSync(avatarDir)
          .filter((f) => f.endsWith(".vrm"))
          .map((file) => {
            const meta = existsSync(join(avatarDir, `${file}.json`))
              ? (JSON.parse(readFileSync(join(avatarDir, `${file}.json`), "utf8")) as { name: string })
              : { name: file };
            const st = statSync(join(avatarDir, file));
            return { file, name: meta.name, url: `${cfg.publicUrl}/avatars/files/${file}`, bytes: st.size, addedAt: st.mtime.toISOString() };
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
    const file = `${randomBytes(6).toString("hex")}.vrm`;
    writeFileSync(join(avatarDir, file), buf);
    writeFileSync(join(avatarDir, `${file}.json`), JSON.stringify({ name: name.replace(/\.vrm$/i, "") }));
    return c.json(avatarList().find((a) => a.file === file), 201);
  });
  app.get("/avatars/files/:file", (c) => {
    const file = c.req.param("file");
    if (!avatarDir || !/^[a-f0-9]{12}\.vrm$/.test(file) || !existsSync(join(avatarDir, file))) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.body(readFileSync(join(avatarDir, file)), 200, {
      "content-type": "model/gltf-binary",
      "cache-control": "public, max-age=31536000, immutable",
    });
  });
  app.delete("/avatars/:file", (c) => {
    const file = c.req.param("file");
    if (!avatarDir || !/^[a-f0-9]{12}\.vrm$/.test(file)) return c.json({ error: "not_found" }, 404);
    for (const f of [file, `${file}.json`]) if (existsSync(join(avatarDir, f))) unlinkSync(join(avatarDir, f));
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

  // --- Sessions ------------------------------------------------------------------------------
  app.post("/sessions", async (c) => {
    const parsed = CreateSessionRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    const agent = store.sessionConfig(parsed.data.agentId, parsed.data.version);
    if (!agent) return c.json({ error: "not_published" }, 409);
    // Documents deleted from the library since the agent was saved are dropped here, so the worker
    // only offers the search tool when there is something to search.
    agent.knowledge = agent.knowledge.filter((id) => knowledge.has(id));

    const sessionId = `ses_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const identity = `user_${crypto.randomUUID().slice(0, 8)}`;
    const at = new AccessToken(cfg.livekitApiKey, cfg.livekitApiSecret, { identity, ttl: "15m" });
    at.addGrant({ room: sessionId, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    // Joining the room dispatches our worker with the agent config attached.
    at.roomConfig = new RoomConfiguration({
      agents: [new RoomAgentDispatch({ agentName: AGENT_NAME, metadata: JSON.stringify({ agent }) })],
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
