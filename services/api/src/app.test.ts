import type { AgentDetail, AgentSummary } from "@metaavatar/protocol";
import { TokenVerifier } from "livekit-server-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { AGENT_NAME, type ApiConfig, createApp } from "./app";
import { AgentStore } from "./store";

const cfg: ApiConfig = {
  livekitUrl: "ws://lk",
  livekitApiKey: "k",
  livekitApiSecret: "secret-secret-secret-secret-32b",
  allowedOrigins: ["http://localhost:3100"],
  dataDir: null,
  publicUrl: "http://api",
};

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp(cfg, new AgentStore(null));
});

const call = (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

describe("POST /sessions", () => {
  it("mints a token that dispatches the agent with its published config", async () => {
    const res = await call("POST", "/sessions", { agentId: "demo-ava" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; sessionId: string };
    const claims = await new TokenVerifier(cfg.livekitApiKey, cfg.livekitApiSecret).verify(body.token);
    expect(claims.video?.room).toBe(body.sessionId);
    const dispatch = claims.roomConfig?.agents?.[0];
    expect(dispatch?.agentName).toBe(AGENT_NAME);
    expect(JSON.parse(dispatch?.metadata ?? "{}").agent.id).toBe("demo-ava");
  });

  it("rejects unknown agents, bad bodies, and unpublished agents outside draft mode", async () => {
    expect((await call("POST", "/sessions", { agentId: "nope" })).status).toBe(404);
    expect((await call("POST", "/sessions", {})).status).toBe(400);
    const created = (await (await call("POST", "/agents", { template: "tutor" })).json()) as AgentDetail;
    expect((await call("POST", "/sessions", { agentId: created.id })).status).toBe(409);
    expect((await call("POST", "/sessions", { agentId: created.id, version: "draft" })).status).toBe(201);
  });
});

describe("agents", () => {
  it("creates from a template, edits the draft, publishes, and restores", async () => {
    const created = (await (await call("POST", "/agents", { template: "support", name: "Nia" })).json()) as AgentDetail;
    expect(created.name).toBe("Nia");
    expect(created.draft.greeting).toBe("Hi, I'm Nia from support. What can I help you with?");
    expect(created.voice).toBe("Achird");
    expect(created.publishedVersion).toBeNull();

    const edited = (await (
      await call("PUT", `/agents/${created.id}/draft`, { ...created.draft, id: undefined, greeting: "Hello!" })
    ).json()) as AgentDetail;
    expect(edited.draft.greeting).toBe("Hello!");

    const v1 = (await (await call("POST", `/agents/${created.id}/publish`, { note: "launch" })).json()) as AgentDetail;
    expect(v1.publishedVersion).toBe(1);
    expect(v1.hasUnpublishedChanges).toBe(false);
    expect(v1.versions[0]).toMatchObject({ version: 1, note: "launch" });

    await call("PUT", `/agents/${created.id}/draft`, { ...v1.draft, greeting: "Changed" });
    const list = (await (await call("GET", "/agents")).json()) as AgentSummary[];
    expect(list.find((a) => a.id === created.id)?.hasUnpublishedChanges).toBe(true);

    const restored = (await (await call("POST", `/agents/${created.id}/restore/1`)).json()) as AgentDetail;
    expect(restored.draft.greeting).toBe("Hello!");
    expect(restored.hasUnpublishedChanges).toBe(false);
  });

  it("validates drafts and deletes agents", async () => {
    const bad = await call("PUT", "/agents/demo-ava/draft", { name: "" });
    expect(bad.status).toBe(400);
    expect((await call("DELETE", "/agents/demo-ava")).status).toBe(204);
    expect((await call("GET", "/agents/demo-ava")).status).toBe(404);
  });
});

describe("agent store file", () => {
  it("keeps a copy of a file it can't read instead of overwriting it with demo agents", async () => {
    const { mkdtempSync, readdirSync, writeFileSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "store-"));
    const file = join(dir, "agents.json");

    const first = new AgentStore(file);
    const mine = first.create("tutor", "Keep me");
    first.publish(mine.id);
    // One good agent, one whose draft no longer fits the schema.
    const data = JSON.parse(readFileSync(file, "utf8")) as { agents: { id: string; draft: unknown; versions: { config: Record<string, unknown> }[] }[] };
    data.agents = data.agents.filter((a) => a.id === mine.id);
    delete data.agents[0]!.versions[0]!.config.knowledge; // written before the field existed
    data.agents.push({ id: "broken", draft: { name: 42 }, versions: [] });
    writeFileSync(file, JSON.stringify(data));

    const reopened = new AgentStore(file);
    expect(reopened.list().map((a) => a.id)).toEqual([mine.id]);
    expect(reopened.get(mine.id).hasUnpublishedChanges).toBe(false);
    expect(readdirSync(dir).some((f) => f.startsWith("agents.json.unreadable-"))).toBe(true);

    writeFileSync(file, "{ not json");
    expect(new AgentStore(file).list()).toEqual([]);
  });
});
