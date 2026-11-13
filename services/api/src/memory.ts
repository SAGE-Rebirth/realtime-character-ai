/**
 * Memory: short facts an agent has been asked to keep about one visitor, per agent.
 *
 * A visitor is a pseudonymous reference chosen by the site embedding the agent (Studio uses a
 * random id kept in the browser). Nothing is remembered unless the agent has memory switched on,
 * and a visitor's facts can be listed and deleted at any time ("forget me").
 *
 * Laptop profile: one JSON file under data/. Same seam as the other stores for a move to Postgres.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { MemoryItem } from "@metaavatar/protocol";
import { tokens } from "./knowledge/text";

/** Facts kept per visitor and agent; the oldest are dropped beyond this. */
const MAX_PER_VISITOR = 100;

export class MemoryStore {
  private items: MemoryItem[] = [];

  constructor(private file: string | null) {
    if (!file || !existsSync(file)) return;
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as { items?: MemoryItem[] };
      this.items = Array.isArray(raw.items) ? raw.items.filter((m) => m && typeof m.text === "string") : [];
    } catch {
      console.warn("memory store: file is unreadable, starting empty");
    }
  }

  private save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify({ items: this.items }, null, 2));
    renameSync(`${this.file}.tmp`, this.file);
  }

  /** Everything, newest first, optionally for one agent (Studio's workspace view). */
  all(agentId?: string): MemoryItem[] {
    return this.items.filter((m) => !agentId || m.agentId === agentId).reverse();
  }

  /** Puts back a note that was removed (undo). */
  restore(item: MemoryItem): MemoryItem {
    if (!this.items.some((m) => m.id === item.id)) {
      this.items.push(item);
      this.items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      this.save();
    }
    return item;
  }

  /** Newest first. */
  list(agentId: string, endUser: string): MemoryItem[] {
    return this.items.filter((m) => m.agentId === agentId && m.endUser === endUser).reverse();
  }

  add(agentId: string, endUser: string, text: string): MemoryItem {
    const clean = text.replace(/\s+/g, " ").trim();
    const same = this.items.find(
      (m) => m.agentId === agentId && m.endUser === endUser && m.text.toLowerCase() === clean.toLowerCase(),
    );
    if (same) return same;
    const item: MemoryItem = {
      id: `mem_${randomBytes(6).toString("hex")}`,
      agentId,
      endUser,
      text: clean,
      createdAt: new Date().toISOString(),
    };
    this.items.push(item);
    const mine = this.items.filter((m) => m.agentId === agentId && m.endUser === endUser);
    if (mine.length > MAX_PER_VISITOR) {
      const drop = new Set(mine.slice(0, mine.length - MAX_PER_VISITOR).map((m) => m.id));
      this.items = this.items.filter((m) => !drop.has(m.id));
    }
    this.save();
    return item;
  }

  /** Facts sharing the most words with the query; with no query (or no match), the newest. */
  search(agentId: string, endUser: string, query: string, limit: number): MemoryItem[] {
    const mine = this.list(agentId, endUser);
    const terms = new Set(tokens(query));
    const scored = mine
      .map((m) => ({ m, score: tokens(m.text).filter((t) => terms.has(t)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.m);
    return (scored.length ? scored : mine).slice(0, limit);
  }

  /** Removes one fact. Returns false when it doesn't exist. */
  remove(id: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((m) => m.id !== id);
    if (this.items.length === before) return false;
    this.save();
    return true;
  }

  /** "Forget me": removes everything about a visitor, for one agent or (without agentId) for all. */
  forget(endUser: string, agentId?: string): number {
    const before = this.items.length;
    this.items = this.items.filter((m) => !(m.endUser === endUser && (!agentId || m.agentId === agentId)));
    if (this.items.length !== before) this.save();
    return before - this.items.length;
  }

  /** When an agent is deleted, what it remembered goes with it. */
  forgetAgent(agentId: string): void {
    const before = this.items.length;
    this.items = this.items.filter((m) => m.agentId !== agentId);
    if (this.items.length !== before) this.save();
  }
}
