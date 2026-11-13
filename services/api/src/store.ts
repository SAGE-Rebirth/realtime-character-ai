/**
 * Agent store: each agent has a working draft and an append-only list of published versions.
 * Studio edits the draft and tests it live; embeds and apps get the latest published version.
 *
 * Laptop profile: one JSON file under data/ (git-ignored), written atomically. The interface is
 * what matters; a Postgres implementation replaces this file without touching the routes.
 */
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  AgentConfig,
  AgentDraft,
  type AgentDetail,
  type AgentSummary,
  type AgentVersionMeta,
} from "@metaavatar/protocol";
import { templateDraft } from "./templates";

interface StoredVersion extends Omit<AgentVersionMeta, "live"> {
  config: AgentDraft;
}

interface StoredAgent {
  id: string;
  draft: AgentDraft;
  versions: StoredVersion[];
  /** Number of the version visitors get. Older files have none: the newest version is live. */
  liveVersion?: number | null;
  createdAt: string;
  updatedAt: string;
}

interface StoreFile {
  agents: StoredAgent[];
}

export class NotFoundError extends Error {}
/** The draft was changed by someone else since the caller last read it. */
export class ConflictError extends Error {}

const same = (a: AgentDraft, b: AgentDraft) => JSON.stringify(a) === JSON.stringify(b);

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return `${base || "agent"}-${randomBytes(2).toString("hex")}`;
}

export class AgentStore {
  private data: StoreFile;

  constructor(
    private file: string | null,
    seed = true,
  ) {
    this.data = { agents: [] };
    if (file && existsSync(file)) this.data = { agents: this.load(file) };
    // Seed the demo agents only into a store that has never held anything.
    if (seed && this.data.agents.length === 0 && !(file && existsSync(file))) this.seed();
  }

  /**
   * Reads the store file. A file we can't read is never overwritten: it is copied aside first, so a
   * bad edit or a schema change can't silently wipe someone's agents. Agents are checked one by one
   * and a broken one is skipped (and kept in the copy) rather than taking the rest down with it.
   */
  private load(file: string): StoredAgent[] {
    const keepCopy = (why: string) => {
      const copy = `${file}.unreadable-${Date.now()}-${randomBytes(2).toString("hex")}`;
      copyFileSync(file, copy);
      console.warn(`agent store: ${why}; the original is kept at ${copy}`);
    };
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      keepCopy("the file is not valid JSON, starting empty");
      return [];
    }
    const list = (raw as Partial<StoreFile> | null)?.agents;
    if (!Array.isArray(list)) {
      keepCopy("the file has no agents list, starting empty");
      return [];
    }
    const agents: StoredAgent[] = [];
    for (const a of list) {
      const draft = AgentDraft.safeParse(a?.draft);
      if (!draft.success || typeof a?.id !== "string") continue;
      // Versions are re-read through the schema too, so a field added later gets its default in old
      // versions and doesn't show up as an unpublished change.
      const versions = (Array.isArray(a.versions) ? a.versions : []).flatMap((v: StoredVersion) => {
        const config = AgentDraft.safeParse(v?.config);
        return config.success ? [{ ...v, config: config.data }] : [];
      });
      agents.push({ ...a, draft: draft.data, versions });
    }
    if (agents.length !== list.length) keepCopy(`${list.length - agents.length} agent(s) could not be read and were skipped`);
    return agents;
  }

  private seed(): void {
    const ava = this.create("blank", undefined, "demo-ava");
    this.updateDraft(ava.id, {
      ...ava.draft,
      name: "Ava",
      role: "Friendly guide for curious questions",
      instructions:
        "You are a warm, curious guide who loves explaining things simply. Keep answers conversational, " +
        "because you are speaking out loud.",
      greeting: "Hi! I'm Ava. What would you like to talk about today?",
      voice: "Kore",
    });
    this.publish(ava.id, "First version");
    const leo = this.create("tutor", undefined, "demo-tutor");
    this.publish(leo.id, "First version");
  }

  private save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  private find(id: string): StoredAgent {
    const a = this.data.agents.find((x) => x.id === id);
    if (!a) throw new NotFoundError(id);
    return a;
  }

  /** The version visitors get, if any. */
  private live(a: StoredAgent): StoredVersion | undefined {
    if (a.liveVersion === null) return undefined;
    return a.versions.find((v) => v.version === a.liveVersion) ?? (a.liveVersion === undefined ? a.versions.at(-1) : undefined);
  }

  private summary(a: StoredAgent): AgentSummary {
    const latest = this.live(a);
    return {
      id: a.id,
      name: a.draft.name,
      role: a.draft.role,
      voice: a.draft.voice,
      avatar: a.draft.avatar,
      publishedVersion: latest?.version ?? null,
      hasUnpublishedChanges: !latest || !same(latest.config, a.draft),
      updatedAt: a.updatedAt,
    };
  }

  list(): AgentSummary[] {
    return [...this.data.agents].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)).map((a) => this.summary(a));
  }

  get(id: string): AgentDetail {
    const a = this.find(id);
    const latest = this.live(a);
    return {
      ...this.summary(a),
      draft: AgentConfig.parse({ ...a.draft, id: a.id }),
      published: latest ? AgentConfig.parse({ ...latest.config, id: a.id }) : null,
      versions: a.versions
        .map(({ version, publishedAt, note }) => ({ version, publishedAt, note, live: version === latest?.version }))
        .reverse(),
    };
  }

  /** The config a live session should use, or null if that version doesn't exist. */
  sessionConfig(id: string, which: "draft" | "published"): AgentConfig | null {
    const a = this.find(id);
    const cfg = which === "draft" ? a.draft : this.live(a)?.config;
    return cfg ? AgentConfig.parse({ ...cfg, id: a.id }) : null;
  }

  create(templateId = "blank", name?: string, id?: string): AgentDetail {
    const draft = templateDraft(templateId) ?? templateDraft("blank")!;
    const chosen = name?.trim();
    if (chosen && chosen !== draft.name) {
      // Templates mention their own name ("Hi, I'm Maya"); carry the chosen name through.
      const swap = (t?: string) => t?.replaceAll(draft.name, chosen);
      draft.greeting = swap(draft.greeting);
      draft.instructions = swap(draft.instructions) ?? "";
      draft.name = chosen;
    }
    const now = new Date().toISOString();
    const agent: StoredAgent = { id: id ?? slug(draft.name), draft, versions: [], createdAt: now, updatedAt: now };
    this.data.agents.push(agent);
    this.save();
    return this.get(agent.id);
  }

  /**
   * Saves the draft. With `basedOn` (the `updatedAt` the caller last saw), the save is refused if
   * the agent changed in the meantime, so a stale browser tab can't silently undo newer edits.
   */
  updateDraft(id: string, draft: unknown, basedOn?: string): AgentDetail {
    const a = this.find(id);
    if (basedOn && basedOn !== a.updatedAt) throw new ConflictError(id);
    a.draft = AgentDraft.parse(draft);
    a.updatedAt = new Date().toISOString();
    this.save();
    return this.get(id);
  }

  /** Saves the draft as a new version and makes it the live one. */
  publish(id: string, note = ""): AgentDetail {
    return this.saveVersion(id, note, true);
  }

  /**
   * Saves the draft as a numbered version. With `live` false it is only kept (a checkpoint to come
   * back to); visitors keep getting the current live version.
   */
  saveVersion(id: string, note = "", live = false): AgentDetail {
    const a = this.find(id);
    const version = (a.versions.at(-1)?.version ?? 0) + 1;
    const now = new Date().toISOString();
    // Pin the current live version before adding one, for files written before liveVersion existed.
    if (a.liveVersion === undefined) a.liveVersion = this.live(a)?.version ?? null;
    a.versions.push({ version, publishedAt: now, note, config: structuredClone(a.draft) });
    if (live) a.liveVersion = version;
    a.updatedAt = now;
    this.save();
    return this.get(id);
  }

  /** Makes an existing version the one visitors get, without touching the draft. */
  setLive(id: string, version: number): AgentDetail {
    const a = this.find(id);
    if (!a.versions.some((v) => v.version === version)) throw new NotFoundError(`${id}@${version}`);
    a.liveVersion = version;
    a.updatedAt = new Date().toISOString();
    this.save();
    return this.get(id);
  }

  /** The full settings of one saved version. */
  version(id: string, version: number): AgentConfig {
    const a = this.find(id);
    const v = a.versions.find((x) => x.version === version);
    if (!v) throw new NotFoundError(`${id}@${version}`);
    return AgentConfig.parse({ ...v.config, id: a.id });
  }

  /** Copies a published version back into the draft (nothing is published until Publish). */
  restore(id: string, version: number): AgentDetail {
    const a = this.find(id);
    const v = a.versions.find((x) => x.version === version);
    if (!v) throw new NotFoundError(`${id}@${version}`);
    a.draft = structuredClone(v.config);
    a.updatedAt = new Date().toISOString();
    this.save();
    return this.get(id);
  }

  duplicate(id: string): AgentDetail {
    const src = this.find(id);
    const name = `${src.draft.name} copy`.slice(0, 80);
    const copy = this.create("blank", name);
    return this.updateDraft(copy.id, { ...structuredClone(src.draft), name });
  }

  remove(id: string): void {
    this.find(id);
    this.data.agents = this.data.agents.filter((a) => a.id !== id);
    this.save();
  }
}
