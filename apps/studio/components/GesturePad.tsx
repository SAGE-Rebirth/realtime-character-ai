"use client";

/** Buttons that play each gesture and expression on a stage, to check how an avatar moves. */
import type { AvatarRuntime } from "@metaavatar/avatar-runtime";
import type { Emotion, Gesture } from "@metaavatar/protocol";
import { useState } from "react";
import s from "./pickers.module.css";

const GESTURES: [Gesture, string][] = [
  ["wave", "Wave"],
  ["nod", "Nod"],
  ["shake_head", "Shake head"],
  ["shrug", "Shrug"],
  ["explain", "Explain"],
  ["point", "Point"],
  ["celebrate", "Celebrate"],
  ["think", "Think"],
];
const EMOTIONS: [Emotion, string][] = [
  ["neutral", "Neutral"],
  ["happy", "Happy"],
  ["sad", "Sad"],
  ["angry", "Angry"],
  ["surprised", "Surprised"],
  ["relaxed", "Relaxed"],
  ["thinking", "Thinking"],
];

export default function GesturePad({ runtime }: { runtime: AvatarRuntime | null }) {
  const [emotion, setEmotion] = useState<Emotion>("neutral");
  const off = !runtime;
  return (
    <div className={s.pad}>
      <div>
        <p className={s.padLabel}>Gestures</p>
        <div className={s.padChips}>
          {GESTURES.map(([g, label]) => (
            <button key={g} type="button" disabled={off} onClick={() => runtime?.playGesture(g, 1)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className={s.padLabel}>Expressions</p>
        <div className={s.padChips}>
          {EMOTIONS.map(([e, label]) => (
            <button
              key={e}
              type="button"
              disabled={off}
              aria-pressed={emotion === e}
              onClick={() => {
                setEmotion(e);
                runtime?.setEmotion(e, 0.9);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {off && <p className={s.padHint}>Waiting for the stage…</p>}
    </div>
  );
}
