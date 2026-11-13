/** Shared wording and polling for knowledge-base documents. */
import type { KnowledgeDoc } from "@metaavatar/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export function describeDoc(d: KnowledgeDoc): string {
  const from = d.kind === "url" ? d.origin.replace(/^https?:\/\//, "") : d.kind === "file" ? d.origin : "Pasted text";
  if (d.status !== "ready") return from;
  const words = Math.round(d.chars / 6);
  const size = words >= 1000 ? `${(words / 1000).toFixed(1)}k words` : `about ${Math.max(words, 1)} words`;
  return `${from} · ${size} · ${d.chunks} ${d.chunks === 1 ? "passage" : "passages"}`;
}

/** Loads the library and keeps refreshing while any document is still being processed. */
export function useKnowledge() {
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      const list = await api.knowledge();
      setDocs(list);
      setError(null);
      if (list.some((d) => d.status === "processing")) timer.current = setTimeout(() => void refresh(), 1200);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  return { docs, error, refresh };
}
