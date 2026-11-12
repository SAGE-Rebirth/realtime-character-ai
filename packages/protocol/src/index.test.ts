import { describe, expect, it } from "vitest";
import { AgentConfig, decodeEvent, encodeEvent } from "./index";

describe("protocol", () => {
  it("round-trips an event", () => {
    const ev = { v: 1, ts: 1, type: "agent.state", state: "speaking" } as const;
    expect(decodeEvent(encodeEvent(ev))).toEqual(ev);
  });
  it("rejects malformed and unknown payloads", () => {
    expect(decodeEvent(new TextEncoder().encode("not json"))).toBeNull();
    expect(decodeEvent(new TextEncoder().encode(JSON.stringify({ v: 1, ts: 1, type: "nope" })))).toBeNull();
  });
  it("applies agent defaults", () => {
    const a = AgentConfig.parse({ id: "a", name: "Ava", instructions: "", avatar: { kind: "procedural" } });
    expect(a.voice).toBe("Kore");
    expect(a.audience).toBe("general");
  });
});
