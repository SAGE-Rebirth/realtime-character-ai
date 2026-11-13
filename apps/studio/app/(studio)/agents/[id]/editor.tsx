"use client";

/** Shared state for the agent editor: the draft, autosave, publishing. */
import type { AgentDetail, AgentDraft } from "@metaavatar/protocol";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { AvatarRuntime } from "@metaavatar/avatar-runtime";
import { api, ApiError } from "@/lib/api";

export type SaveState = "saved" | "saving" | "unsaved" | "error";

interface EditorValue {
  agent: AgentDetail;
  draft: AgentDraft;
  save: SaveState;
  saveError: string | null;
  /** The save was refused because the agent changed elsewhere; only a reload helps. */
  saveConflict: boolean;
  /** The stage's avatar runtime, so panels can play gestures on it. Null until the stage is ready. */
  runtime: AvatarRuntime | null;
  setRuntime: (rt: AvatarRuntime | null) => void;
  /** Change part of the draft; saved automatically a moment later. */
  update: (patch: Partial<AgentDraft>) => void;
  /** Replace the whole agent after a server-side action (publish, restore). */
  replace: (a: AgentDetail) => void;
  flush: () => Promise<void>;
}

const Ctx = createContext<EditorValue | null>(null);

export function useEditor(): EditorValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEditor outside the agent editor");
  return v;
}

const toDraft = (a: AgentDetail): AgentDraft => {
  const { id: _id, ...rest } = a.draft;
  return rest;
};

export function EditorProvider({ initial, children }: { initial: AgentDetail; children: React.ReactNode }) {
  const [agent, setAgent] = useState(initial);
  const [draft, setDraft] = useState<AgentDraft>(() => toDraft(initial));
  const [save, setSave] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
  const [runtime, setRuntime] = useState<AvatarRuntime | null>(null);
  const pending = useRef<AgentDraft | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inFlight = useRef<Promise<void>>(Promise.resolve());
  // The version of the agent our draft is based on; the API refuses a save made on top of an older one.
  const basedOn = useRef(initial.updatedAt);

  // Saves run one at a time, so a slow earlier save can never land after (and undo) a later one.
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    inFlight.current = inFlight.current.then(async () => {
      const next = pending.current;
      if (!next) return;
      pending.current = null;
      setSave("saving");
      try {
        const saved = await api.saveDraft(agent.id, next, basedOn.current);
        basedOn.current = saved.updatedAt;
        setAgent(saved);
        setSaveError(null);
        setSave(pending.current ? "unsaved" : "saved");
      } catch (e) {
        pending.current ??= next;
        setSave("error");
        setSaveError((e as Error).message);
        setSaveConflict(e instanceof ApiError && e.code === "conflict");
      }
    });
    return inFlight.current;
  }, [agent.id]);

  const update = useCallback(
    (patch: Partial<AgentDraft>) => {
      setDraft((d) => {
        const next = { ...d, ...patch };
        pending.current = next;
        return next;
      });
      setSave("unsaved");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 700);
    },
    [flush],
  );

  const replace = useCallback((a: AgentDetail) => {
    setAgent(a);
    setDraft(toDraft(a));
    basedOn.current = a.updatedAt;
    pending.current = null;
    setSave("saved");
  }, []);

  // Don't lose edits when leaving the page.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      void flush();
    };
  }, [flush]);

  return <Ctx.Provider value={{ agent, draft, save, saveError, saveConflict, runtime, setRuntime, update, replace, flush }}>{children}</Ctx.Provider>;
}
