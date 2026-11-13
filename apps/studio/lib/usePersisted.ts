"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * State that survives a page refresh, kept in this browser only. Use it for view choices (which
 * agent the playground shows, which avatar is being previewed), never for agent data, which the
 * API stores. `loaded` turns true once the saved value has been read, so pages can wait for it.
 */
export function usePersisted<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`studio:${key}`);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // private window or blocked storage: carry on with the default
    }
    setLoaded(true);
  }, [key]);

  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        try {
          window.localStorage.setItem(`studio:${key}`, JSON.stringify(next));
        } catch {
          // ignore: the choice just won't be remembered
        }
        return next;
      });
    },
    [key],
  );
  return [value, set, loaded];
}
