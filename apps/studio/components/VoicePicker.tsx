"use client";

import { VOICES } from "@metaavatar/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import s from "./pickers.module.css";

/** Plays one voice sample at a time. Samples live in /public/voices (make voices). */
export function useVoicePreview() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [missing, setMissing] = useState<Set<string>>(new Set());

  useEffect(() => () => audio.current?.pause(), []);

  const toggle = (name: string) => {
    audio.current?.pause();
    if (playing === name) {
      setPlaying(null);
      return;
    }
    const a = new Audio(`/voices/${name}.m4a`);
    audio.current = a;
    a.onended = () => setPlaying(null);
    a.onerror = () => {
      setPlaying(null);
      setMissing((m) => new Set(m).add(name));
    };
    setPlaying(name);
    void a.play().catch(() => setPlaying(null));
  };
  return { playing, missing, toggle };
}

function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      {playing ? (
        <path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" fill="currentColor" />
      ) : (
        <path d="M3 1.4v9.2a.5.5 0 0 0 .76.43l7.4-4.6a.5.5 0 0 0 0-.86L3.76.97A.5.5 0 0 0 3 1.4z" fill="currentColor" />
      )}
    </svg>
  );
}

export default function VoicePicker({ value, onChange }: { value?: string; onChange?: (name: string) => void }) {
  const { playing, missing, toggle } = useVoicePreview();
  const characters = useMemo(() => [...new Set(VOICES.map((v) => v.character))].sort(), []);
  const [filter, setFilter] = useState<string | null>(null);
  const shown = VOICES.filter((v) => !filter || v.character === filter);

  return (
    <div className={s.voices}>
      <div className={s.filters} role="group" aria-label="Filter voices by character">
        <button type="button" aria-pressed={filter === null} onClick={() => setFilter(null)}>
          All {VOICES.length}
        </button>
        {characters.map((c) => (
          <button key={c} type="button" aria-pressed={filter === c} onClick={() => setFilter(filter === c ? null : c)}>
            {c}
          </button>
        ))}
      </div>
      <ul className={s.voiceGrid}>
        {shown.map((v) => {
          const selected = value === v.name;
          return (
            <li key={v.name} className={s.voice} data-selected={selected}>
              <button
                type="button"
                className={s.play}
                onClick={() => toggle(v.name)}
                disabled={missing.has(v.name)}
                aria-label={playing === v.name ? `Stop ${v.name}` : `Play a sample of ${v.name}`}
                title={missing.has(v.name) ? "No sample yet (run make voices)" : undefined}
              >
                <PlayIcon playing={playing === v.name} />
              </button>
              <span className={s.voiceText}>
                <span className={s.voiceName}>{v.name}</span>
                <span className={s.voiceChar}>{v.character}</span>
              </span>
              {onChange &&
                (selected ? (
                  <span className={s.chosen}>Selected</span>
                ) : (
                  <button
                    type="button"
                    className={s.choose}
                    onClick={() => onChange(v.name)}
                    aria-label={`Use ${v.name}`}
                  >
                    Use
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
