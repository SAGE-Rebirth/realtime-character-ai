import { CreateSessionRequest, type CreateSessionResponse } from "@metaavatar/protocol";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";
import { getAgent, listAgents } from "./agents";

export const AGENT_NAME = "meta-avatar";

export interface ApiConfig {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  allowedOrigins: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    livekitUrl: env.LIVEKIT_URL ?? "ws://localhost:7880",
    livekitApiKey: env.LIVEKIT_API_KEY ?? "devkey",
    livekitApiSecret: env.LIVEKIT_API_SECRET ?? "secret",
    allowedOrigins: (env.STUDIO_ORIGIN ?? "http://localhost:3100").split(",").map((s) => s.trim()),
  };
}

export function createApp(cfg: ApiConfig): Hono {
  const app = new Hono();
  app.use("*", cors({ origin: cfg.allowedOrigins, allowMethods: ["GET", "POST"], maxAge: 600 }));

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/agents", (c) =>
    c.json(listAgents().map(({ id, name, voice, avatar, renderer }) => ({ id, name, voice, avatar, renderer }))),
  );

  app.post("/sessions", async (c) => {
    const parsed = CreateSessionRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    const agent = getAgent(parsed.data.agentId);
    if (!agent) return c.json({ error: "agent_not_found" }, 404);

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
