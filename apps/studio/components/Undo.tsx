"use client";

/**
 * Undo for deletes. Instead of asking "are you sure?", the item disappears at once and a bar
 * offers Undo for a few seconds; only then is it really deleted. One pending delete at a time:
 * starting another, or leaving the page, carries out the pending one straight away.
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import s from "./shell.module.css";

export interface UndoOffer {
  /** What was removed, for example: Deleted "Ava". */
  message: string;
  /** Put the item back on screen. */
  undo: () => void;
  /** Really delete it. Called when the time runs out. */
  commit: () => Promise<unknown>;
  /** The delete failed: put the item back and say why. */
  onError?: (e: Error) => void;
}

const WINDOW_MS = 7000;
const Ctx = createContext<(offer: UndoOffer) => void>(() => undefined);

export const useUndo = () => useContext(Ctx);

export function UndoProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<UndoOffer | null>(null);
  const pending = useRef<UndoOffer | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const offer = pending.current;
    pending.current = null;
    setShown(null);
    if (offer) offer.commit().catch((e: Error) => (offer.undo(), offer.onError?.(e)));
  }, []);

  const offer = useCallback(
    (next: UndoOffer) => {
      finish(); // one at a time
      pending.current = next;
      setShown(next);
      timer.current = setTimeout(finish, WINDOW_MS);
    },
    [finish],
  );

  const undo = () => {
    if (timer.current) clearTimeout(timer.current);
    pending.current?.undo();
    pending.current = null;
    setShown(null);
  };

  // Leaving or hiding the page: don't lose the delete.
  useEffect(() => {
    window.addEventListener("pagehide", finish);
    return () => {
      window.removeEventListener("pagehide", finish);
      finish();
    };
  }, [finish]);

  return (
    <Ctx.Provider value={offer}>
      {children}
      {shown && (
        <div className={s.undo} role="status">
          <span>{shown.message}</span>
          <button type="button" onClick={undo}>
            Undo
          </button>
        </div>
      )}
    </Ctx.Provider>
  );
}
