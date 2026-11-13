/** Small, shared building blocks so every panel looks and behaves the same. */
import type { ReactNode } from "react";
import s from "./ui.module.css";

export const ui = s;

type BtnKind = "primary" | "quiet" | "danger" | "default";

export function btn(kind: BtnKind = "default", small = false): string {
  return [s.btn, kind !== "default" && s[kind], small && s.small].filter(Boolean).join(" ");
}

export function PageHeader({ title, lead, actions }: { title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className={s.pageHeader}>
      <div>
        <h1 className={s.pageTitle}>{title}</h1>
        {lead && <p className={s.pageLead}>{lead}</p>}
      </div>
      {actions && <div style={{ display: "flex", gap: 8 }}>{actions}</div>}
    </header>
  );
}

export function Section({ title, help, children }: { title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <h2 className={s.sectionTitle}>{title}</h2>
        {help && <p className={s.help}>{help}</p>}
      </div>
      {children}
    </section>
  );
}

export function Field({
  label,
  help,
  htmlFor,
  children,
  counter,
}: {
  label: string;
  help?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  counter?: string;
}) {
  return (
    <div className={s.field}>
      <label className={s.fieldLabel} htmlFor={htmlFor}>
        {label}
      </label>
      {help && <p className={s.help}>{help}</p>}
      {children}
      {counter && <span className={s.counter}>{counter}</span>}
    </div>
  );
}

export function Toggle({
  label,
  help,
  checked,
  onChange,
  id,
}: {
  label: string;
  help?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
}) {
  return (
    <div className={s.toggleRow}>
      <div className={s.field}>
        <label className={s.fieldLabel} htmlFor={id}>
          {label}
        </label>
        {help && <p className={s.help}>{help}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        className={s.toggle}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className={s.seg} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  id,
  label,
  value,
  onChange,
  ends,
  describe,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  ends: [string, string];
  describe: (v: number) => string;
}) {
  return (
    <div className={s.slider}>
      <label className={s.fieldLabel} htmlFor={id}>
        {label}
      </label>
      <span className={s.sliderValue} aria-live="polite">
        {describe(value)}
      </span>
      <input
        id={id}
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className={s.sliderEnds} aria-hidden>
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </span>
    </div>
  );
}

export function Tag({ tone = "default", children }: { tone?: "default" | "live" | "warn"; children: ReactNode }) {
  const cls = [s.tag, tone === "live" && s.tagLive, tone === "warn" && s.tagWarn].filter(Boolean).join(" ");
  return <span className={cls}>{children}</span>;
}

export function Notice({ error, children }: { error?: boolean; children: ReactNode }) {
  return (
    <p className={`${s.notice} ${error ? s.noticeError : ""}`} role={error ? "alert" : undefined}>
      {children}
    </p>
  );
}

/** A roadmap feature that has its place in Studio but isn't built yet. */
export function Planned({
  title,
  lead,
  phase,
  items,
  today,
  inline = false,
}: {
  title: string;
  lead: string;
  phase: number;
  items: [string, string][];
  today?: ReactNode;
  /** Inside the agent editor: a section, not a page. */
  inline?: boolean;
}) {
  return (
    <div className={inline ? `${s.planned} ${s.section}` : s.planned}>
      {inline ? (
        <div className={s.sectionHead}>
          <h2 className={s.sectionTitle}>{title}</h2>
          <p className={s.help}>{lead}</p>
        </div>
      ) : (
        <PageHeader title={title} lead={lead} />
      )}
      <p>
        <Tag>{phase === 2 ? "Coming later in phase 2" : `Planned for phase ${phase}`}</Tag>
      </p>
      <ul className={s.plannedList}>
        {items.map(([k, v]) => (
          <li key={k}>
            <strong>{k}</strong>
            <span>{v}</span>
          </li>
        ))}
      </ul>
      {today && <Notice>{today}</Notice>}
    </div>
  );
}
