"use client";

import type { AvatarRef } from "@metaavatar/protocol";
import { useCallback, useEffect, useState } from "react";
import { api, type AvatarFile } from "@/lib/api";
import { Notice } from "./ui";
import s from "./pickers.module.css";

const BUILT_IN: AvatarRef = { kind: "procedural", style: "default" };

function Thumb({ label }: { label: string }) {
  return (
    <span className={s.thumb} aria-hidden>
      <svg viewBox="0 0 40 52" width="34" height="44">
        <ellipse cx="20" cy="49" rx="13" ry="2.5" fill="rgba(255,232,200,.3)" />
        <circle cx="20" cy="12" r="7" fill="#ffe2bd" />
        <path d="M8 46c0-14 5-24 12-24s12 10 12 24z" fill="#ffe2bd" opacity=".75" />
      </svg>
      <span className={s.thumbKind}>{label}</span>
    </span>
  );
}

/**
 * Lists the built-in character and every uploaded VRM model, and accepts new uploads.
 * With `onChange`, picking an avatar selects it for an agent; without it, it's a library view.
 */
export default function AvatarPicker({
  value,
  onChange,
  onPreview,
}: {
  value?: AvatarRef;
  onChange?: (ref: AvatarRef) => void;
  onPreview?: (ref: AvatarRef) => void;
}) {
  const [files, setFiles] = useState<AvatarFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [over, setOver] = useState(false);

  const load = useCallback(() => {
    api
      .avatars()
      .then(setFiles)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.name.toLowerCase().endsWith(".vrm")) {
      setError("Only .vrm files are supported. Export your character from VRoid Studio or Blender as VRM.");
      return;
    }
    setUploading(true);
    try {
      const added = await api.uploadAvatar(file);
      load();
      const ref: AvatarRef = { kind: "vrm", url: added.url };
      onChange?.(ref);
      onPreview?.(ref);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (f: AvatarFile) => {
    if (!window.confirm(`Remove "${f.name}" from the library? Agents using it will fall back to the built-in character.`)) return;
    await api.deleteAvatar(f.file).catch((e: Error) => setError(e.message));
    load();
  };

  const isSelected = (ref: AvatarRef) => JSON.stringify(ref) === JSON.stringify(value);
  const pick = (ref: AvatarRef) => {
    onChange?.(ref);
    onPreview?.(ref);
  };

  const items: { key: string; name: string; detail: string; ref: AvatarRef; file?: AvatarFile }[] = [
    { key: "builtin", name: "Studio character", detail: "Built in", ref: BUILT_IN },
    ...(files ?? []).map((f) => ({
      key: f.file,
      name: f.name,
      detail: `VRM · ${(f.bytes / 1024 / 1024).toFixed(1)} MB`,
      ref: { kind: "vrm", url: f.url } as AvatarRef,
      file: f,
    })),
  ];

  return (
    <div className={s.avatars}>
      <ul className={s.avatarGrid}>
        {items.map((it) => (
          <li key={it.key} className={s.avatar} data-selected={isSelected(it.ref)}>
            <button type="button" className={s.avatarMain} onClick={() => pick(it.ref)} aria-pressed={isSelected(it.ref)}>
              <Thumb label={it.ref.kind === "vrm" ? "VRM" : "3D"} />
              <span className={s.avatarText}>
                <span className={s.avatarName}>{it.name}</span>
                <span className={s.avatarDetail}>{isSelected(it.ref) && onChange ? "Selected" : it.detail}</span>
              </span>
            </button>
            {it.file && (
              <button type="button" className={s.remove} onClick={() => void remove(it.file!)} aria-label={`Remove ${it.name}`}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      <label
        className={s.drop}
        data-over={over}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files[0]);
        }}
      >
        <input type="file" accept=".vrm" className={s.fileInput} onChange={(e) => void upload(e.target.files?.[0])} />
        <span className={s.dropTitle}>{uploading ? "Uploading…" : "Add a VRM avatar"}</span>
        <span className={s.dropHelp}>
          Drop a .vrm file here or choose one. Make characters for free in VRoid Studio, or use CC0 models. Up to 80 MB.
        </span>
      </label>
      {error && <Notice error>{error}</Notice>}
    </div>
  );
}
