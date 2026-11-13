/** Typed client for the platform API. */
import type {
  AgentDetail,
  AgentDraft,
  AgentSummary,
  AgentTemplate,
  CreateSessionResponse,
  KnowledgeDoc,
  KnowledgeSearchResponse,
} from "@metaavatar/protocol";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export interface AvatarFile {
  file: string;
  name: string;
  url: string;
  bytes: number;
  addedAt: string;
}

export interface Workspace {
  model: string;
  apiVersion: string;
  thinkingLevel: string;
  turnSilenceMs: number;
  geminiKeyConfigured: boolean;
  livekitUrl: string;
  dataDir: string | null;
  /** Embedding model used for document search, or null when no Gemini key is set. */
  embedModel: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(describe(status, code));
  }
}

function describe(status: number, code: string): string {
  if (status === 0) return `Can't reach the API at ${API_URL}. Start everything with: make start`;
  if (code === "not_published") return "This agent has no published version yet. Publish it first, or test the draft.";
  if (code === "not_found") return "That item no longer exists. It may have been deleted.";
  if (code === "invalid_request") return "Some fields aren't valid. Check the highlighted values.";
  if (code === "not_vrm") return "That file isn't a VRM model. Export your character as .vrm and try again.";
  if (code === "bad_size") return "That file is empty or larger than 80 MB.";
  if (code === "unsupported_file") return "That file type isn't supported. Use PDF, Word (.docx), text, Markdown or HTML.";
  if (code === "too_large") return "That file is empty or larger than 20 MB.";
  if (code === "bad_url") return "That doesn't look like a public web address. Use a full address starting with https://.";
  return `The API returned an error (${status}${code ? `, ${code}` : ""}).`;
}

async function request<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: body instanceof Blob ? headers : { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "unreachable");
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, err.error ?? "");
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  workspace: () => request<Workspace>("GET", "/workspace"),
  templates: () => request<AgentTemplate[]>("GET", "/templates"),
  agents: () => request<AgentSummary[]>("GET", "/agents"),
  agent: (id: string) => request<AgentDetail>("GET", `/agents/${id}`),
  createAgent: (template: string, name?: string) => request<AgentDetail>("POST", "/agents", { template, name }),
  saveDraft: (id: string, draft: AgentDraft) => request<AgentDetail>("PUT", `/agents/${id}/draft`, draft),
  publish: (id: string, note: string) => request<AgentDetail>("POST", `/agents/${id}/publish`, { note }),
  restore: (id: string, version: number) => request<AgentDetail>("POST", `/agents/${id}/restore/${version}`),
  duplicate: (id: string) => request<AgentDetail>("POST", `/agents/${id}/duplicate`),
  deleteAgent: (id: string) => request<void>("DELETE", `/agents/${id}`),
  avatars: () => request<AvatarFile[]>("GET", "/avatars"),
  uploadAvatar: (file: File) =>
    request<AvatarFile>("POST", "/avatars", file, { "x-filename": encodeURIComponent(file.name) }),
  deleteAvatar: (file: string) => request<void>("DELETE", `/avatars/${file}`),
  knowledge: () => request<KnowledgeDoc[]>("GET", "/knowledge"),
  uploadDocument: (file: File) =>
    request<KnowledgeDoc>("POST", "/knowledge", file, { "x-filename": encodeURIComponent(file.name) }),
  addDocumentText: (title: string, text: string) => request<KnowledgeDoc>("POST", "/knowledge/text", { title, text }),
  addDocumentUrl: (url: string) => request<KnowledgeDoc>("POST", "/knowledge/url", { url }),
  embedDocument: (id: string) => request<KnowledgeDoc>("POST", `/knowledge/${id}/embed`),
  deleteDocument: (id: string) => request<void>("DELETE", `/knowledge/${id}`),
  searchKnowledge: (query: string, documentIds?: string[]) =>
    request<KnowledgeSearchResponse>("POST", "/knowledge/search", { query, documentIds, limit: 4 }),
  session: (agentId: string, version: "draft" | "published") =>
    request<CreateSessionResponse>("POST", "/sessions", { agentId, version }),
};

/** "3 minutes ago"-style relative time, in plain words. */
export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(iso).toLocaleDateString();
}
