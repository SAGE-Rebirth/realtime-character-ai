"use client";

import type { AvatarRef } from "@metaavatar/protocol";
import { useState } from "react";
import AvatarPicker from "@/components/AvatarPicker";
import Stage from "@/components/Stage";
import { PageHeader, Section, Tag, ui } from "@/components/ui";
import s from "./avatars.module.css";

export default function AvatarsPage() {
  const [preview, setPreview] = useState<AvatarRef>({ kind: "procedural", style: "default" });
  return (
    <div className={s.page}>
      <PageHeader
        title="Avatars"
        lead="The bodies your agents perform with. Pick one to see it on the stage, add your own VRM characters, and assign them to agents under Appearance."
      />
      <div className={s.grid}>
        <div className={s.side}>
          <Section title="Library">
            <AvatarPicker value={preview} onPreview={setPreview} />
          </Section>
          <Section title="Create from a photo" help="Turn a photo or a character drawing into an avatar, with consent checks for real people.">
            <p>
              <Tag>Planned for phase 4</Tag>
            </p>
            <p className={ui.help}>
              Until then, VRoid Studio (free) makes stylised characters you can export as VRM and add above.
            </p>
          </Section>
        </div>
        <div className={s.stage}>
          <Stage agentId={null} agentName="Preview" avatar={preview} framing="full" variant="fill" />
        </div>
      </div>
    </div>
  );
}
