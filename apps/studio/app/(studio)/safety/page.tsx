import Link from "next/link";
import { PageHeader, Section, Tag, ui } from "@/components/ui";
import { AUDIENCES, PLATFORM_RULES } from "@/lib/safety";
import s from "./safety.module.css";

export const metadata = { title: "Safety" };

export default function SafetyPage() {
  return (
    <div className={s.page}>
      <PageHeader
        title="Safety"
        lead="The rules every agent follows, whatever its instructions say, and the extra rules for younger audiences."
      />
      <Section title="Platform rules" help="Added before every agent's own instructions. They can't be turned off.">
        <ul className={s.list}>
          {PLATFORM_RULES.map(([k, v]) => (
            <li key={k}>
              <strong>{k}</strong>
              <span className={ui.help}>{v}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section
        title="Audiences"
        help={
          <>
            Each agent has an audience, set under its Safety settings. <Link href="/agents">Go to agents</Link>
          </>
        }
      >
        <ul className={s.list}>
          {AUDIENCES.map((a) => (
            <li key={a.value}>
              <strong>{a.label}</strong>
              <span className={ui.help}>{a.summary}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Coming next" help="Safety work planned before anyone outside the team uses the platform.">
        <p>
          <Tag>Planned for phase 5</Tag>
        </p>
        <ul className={s.list}>
          <li>
            <strong>Moderation</strong>
            <span className={ui.help}>Checks on what visitors say and what agents reply, live.</span>
          </li>
          <li>
            <strong>Image checks</strong>
            <span className={ui.help}>Consent and abuse checks on photos used to create avatars.</span>
          </li>
          <li>
            <strong>Red-team tests</strong>
            <span className={ui.help}>An automated suite that tries to break the rules on every release.</span>
          </li>
        </ul>
      </Section>
    </div>
  );
}
