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

describe("avatar library folder", () => {
  it("lists every .vrm in the folder with its path and notes, keeps upload names, and refuses bad names", async () => {
    const { mkdtempSync, writeFileSync, existsSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "avatars-"));
    const glb = Buffer.concat([Buffer.from("glTF"), Buffer.alloc(16)]);
    // A model copied into the folder by hand, with notes beside it.
    writeFileSync(join(dir, "Teacher_Suit.vrm"), glb);
    writeFileSync(join(dir, "Teacher_Suit.vrm.json"), JSON.stringify({ name: "Ms Hale", licence: "CC0", source: "https://example.com" }));
    writeFileSync(join(dir, "notes.txt"), "ignored");
    const lib = createApp({ ...cfg, avatarDir: dir }, new AgentStore(null));

    type Row = { file: string; name: string; path: string; url: string; licence?: string };
    const list = (await (await lib.request("/avatars")).json()) as Row[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ file: "Teacher_Suit.vrm", name: "Ms Hale", licence: "CC0" });
    expect(list[0]!.path.endsWith("Teacher_Suit.vrm")).toBe(true);
    expect((await lib.request(new URL(list[0]!.url).pathname)).status).toBe(200);

    const upload = (name: string, body: Buffer) =>
      lib.request("/avatars", { method: "POST", body, headers: { "x-filename": encodeURIComponent(name) } });
    const first = (await (await upload("../My Avatar!.vrm", glb)).json()) as Row;
    expect(first.file).toBe("My Avatar_.vrm");
    expect(existsSync(join(dir, "My Avatar_.vrm"))).toBe(true);
    // Same name again doesn't overwrite the first file.
    expect(((await (await upload("My Avatar!.vrm", glb)).json()) as Row).file).toBe("My Avatar_-2.vrm");
    expect((await upload("x.vrm", Buffer.from("not a model"))).status).toBe(400);
    expect((await upload("x.glb", glb)).status).toBe(400);

    expect((await lib.request("/avatars/files/..%2F..%2Fagents.json")).status).toBe(404);
    expect((await lib.request("/avatars/files/notes.txt")).status).toBe(404);
    expect((await lib.request("/avatars/Teacher_Suit.vrm", { method: "DELETE" })).status).toBe(204);
    expect(existsSync(join(dir, "Teacher_Suit.vrm.json"))).toBe(false);
  });

  it("refuses a draft save made on top of an older version of the agent", async () => {
    const a = (await (await call("GET", "/agents/demo-ava")).json()) as AgentDetail;
    const { id: _id, ...draft } = a.draft;
    const save = (basedOn: string, role: string) =>
      app.request("/agents/demo-ava/draft", {
        method: "PUT",
        body: JSON.stringify({ ...draft, role }),
        headers: { "content-type": "application/json", "x-based-on": basedOn },
      });
    await new Promise((r) => setTimeout(r, 5));
    const ok = await save(a.updatedAt, "first tab");
    expect(ok.status).toBe(200);
    expect((await save(a.updatedAt, "stale tab")).status).toBe(409);
    expect(((await (await call("GET", "/agents/demo-ava")).json()) as AgentDetail).draft.role).toBe("first tab");
  });
});

describe("versions", () => {
  it("saves checkpoints without going live, shows a version's settings, and switches the live one", async () => {
    const a = (await (await call("POST", "/agents", { template: "tutor", name: "Vee" })).json()) as AgentDetail;
    const { id: _id, ...draft } = a.draft;
    const put = (greeting: string) => call("PUT", `/agents/${a.id}/draft`, { ...draft, greeting });

    await put("one");
    const v1 = (await (await call("POST", `/agents/${a.id}/publish`, { note: "first" })).json()) as AgentDetail;
    expect(v1.versions).toMatchObject([{ version: 1, live: true }]);

    await put("two");
    const v2 = (await (await call("POST", `/agents/${a.id}/versions`, { note: "trial" })).json()) as AgentDetail;
    // Saved, but visitors still get version 1.
    expect(v2.versions).toMatchObject([{ version: 2, live: false, note: "trial" }, { version: 1, live: true }]);
    expect(v2.publishedVersion).toBe(1);
    expect(v2.published?.greeting).toBe("one");
    expect(v2.hasUnpublishedChanges).toBe(true);

    const cfg2 = (await (await call("GET", `/agents/${a.id}/versions/2`)).json()) as { greeting: string };
    expect(cfg2.greeting).toBe("two");
    expect((await call("GET", `/agents/${a.id}/versions/9`)).status).toBe(404);

    const live2 = (await (await call("POST", `/agents/${a.id}/live/2`)).json()) as AgentDetail;
    expect(live2.publishedVersion).toBe(2);
    expect(live2.hasUnpublishedChanges).toBe(false);
    // Going back is one step and leaves the draft alone.
    const back = (await (await call("POST", `/agents/${a.id}/live/1`)).json()) as AgentDetail;
    expect(back.published?.greeting).toBe("one");
    expect(back.draft.greeting).toBe("two");
  });
});

describe("memory", () => {
  it("remembers per agent and visitor only when switched on, feeds sessions, and forgets on request", async () => {
    const add = (agentId: string, endUser: string, text: string) => call("POST", "/memory", { agentId, endUser, text });
    expect((await add("demo-ava", "v1", "Their name is Priya.")).status).toBe(409); // memory is off

    const a = (await (await call("GET", "/agents/demo-ava")).json()) as AgentDetail;
    const { id: _id, ...draft } = a.draft;
    await call("PUT", "/agents/demo-ava/draft", { ...draft, memory: true });
    expect((await add("demo-ava", "v1", "Their name is Priya.")).status).toBe(201);
    await add("demo-ava", "v1", "their name is priya."); // same note again
    await add("demo-ava", "v1", "They are learning to bake bread.");
    await add("demo-ava", "v2", "Their name is Sam.");
    expect((await add("demo-ava", "v1", "")).status).toBe(400);

    type Item = { id: string; text: string };
    const mine = (await (await call("GET", "/memory?agentId=demo-ava&endUser=v1")).json()) as Item[];
    expect(mine.map((m) => m.text)).toEqual(["They are learning to bake bread.", "Their name is Priya."]);
    const found = (await (await call("POST", "/memory/search", { agentId: "demo-ava", endUser: "v1", query: "what is their name" })).json()) as Item[];
    expect(found[0]?.text).toBe("Their name is Priya.");

    const { TokenVerifier } = await import("livekit-server-sdk");
    const meta = async (body: object) => {
      const s = (await (await call("POST", "/sessions", body)).json()) as { token: string };
      const claims = await new TokenVerifier(cfg.livekitApiKey, cfg.livekitApiSecret).verify(s.token);
      return JSON.parse(claims.roomConfig?.agents?.[0]?.metadata ?? "{}");
    };
    const withVisitor = await meta({ agentId: "demo-ava", version: "draft", endUserRef: "v1" });
    expect(withVisitor.endUser).toBe("v1");
    expect(withVisitor.memories).toHaveLength(2);
    // No visitor reference, or a children's agent: no memory in the session.
    const anonymous = await meta({ agentId: "demo-ava", version: "draft" });
    expect(anonymous.agent.memory).toBe(false);
    expect(anonymous.memories).toBeUndefined();
    await call("PUT", "/agents/demo-ava/draft", { ...draft, memory: true, audience: "kids" });
    expect((await meta({ agentId: "demo-ava", version: "draft", endUserRef: "v1" })).memories).toBeUndefined();
    expect((await add("demo-ava", "v1", "Another note.")).status).toBe(409);

    expect((await call("DELETE", `/memory/${mine[0]!.id}`)).status).toBe(204);
    expect((await call("DELETE", `/memory/${mine[0]!.id}`)).status).toBe(404);
    expect(await (await call("DELETE", "/memory?agentId=demo-ava&endUser=v1")).json()).toEqual({ removed: 1 });
    expect((await (await call("GET", "/memory?agentId=demo-ava&endUser=v2")).json()) as Item[]).toHaveLength(1);
    await call("DELETE", "/agents/demo-ava");
    expect((await (await call("GET", "/memory?agentId=demo-ava&endUser=v2")).json()) as Item[]).toHaveLength(0);
  });
});

describe("hardening", () => {
  it("sets safe headers, refuses oversized JSON, and limits how fast conversations can be started", async () => {
    const res = await call("GET", "/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");

    const big = await app.request("/knowledge/text", {
      method: "POST",
      body: JSON.stringify({ title: "big", text: "x".repeat(3 * 1024 * 1024) }),
      headers: { "content-type": "application/json", "content-length": String(3 * 1024 * 1024 + 30) },
    });
    expect(big.status).toBe(413);

    const codes: number[] = [];
    for (let i = 0; i < 32; i++) codes.push((await call("POST", "/sessions", { agentId: "demo-ava" })).status);
    expect(codes.filter((s) => s === 201)).toHaveLength(30);
    expect(codes.slice(-2)).toEqual([429, 429]);
  });
});
