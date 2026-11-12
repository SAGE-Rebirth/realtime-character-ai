import { TokenVerifier } from "livekit-server-sdk";
import { describe, expect, it } from "vitest";
import { AGENT_NAME, createApp } from "./app";

const cfg = { livekitUrl: "ws://lk", livekitApiKey: "k", livekitApiSecret: "secret-secret-secret-secret-32b", allowedOrigins: ["http://localhost:3000"] };
const app = createApp(cfg);
const post = (body: unknown) =>
  app.request("/sessions", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("POST /sessions", () => {
  it("mints a token that dispatches the agent with its config", async () => {
    const res = await post({ agentId: "demo-ava" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; sessionId: string };
    const claims = await new TokenVerifier(cfg.livekitApiKey, cfg.livekitApiSecret).verify(body.token);
    expect(claims.video?.room).toBe(body.sessionId);
    const dispatch = claims.roomConfig?.agents?.[0];
    expect(dispatch?.agentName).toBe(AGENT_NAME);
    expect(JSON.parse(dispatch?.metadata ?? "{}").agent.id).toBe("demo-ava");
  });
  it("rejects unknown agents and bad bodies", async () => {
    expect((await post({ agentId: "nope" })).status).toBe(404);
    expect((await post({})).status).toBe(400);
  });
});
