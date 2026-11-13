"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { EDITOR_PANELS, NAV, type NavItem, SETTINGS } from "@/lib/nav";
import s from "./shell.module.css";
import { UndoProvider } from "./Undo";

function Mark() {
  // A tiny stage with a spotlight: the product in one glyph.
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
      <rect width="26" height="26" rx="7" fill="var(--stage-1)" />
      <ellipse cx="13" cy="19.5" rx="8" ry="2.6" fill="rgba(255,232,200,.35)" />
      <circle cx="13" cy="10.5" r="4.2" fill="#ffe2bd" />
    </svg>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link href={item.href} className={s.link} aria-current={active ? "page" : undefined} title={item.hint}>
      <span>{item.label}</span>
      {item.phase && <span className={s.phase}>Phase {item.phase}</span>}
    </Link>
  );
}

/** Back and forward buttons plus "where am I": section, then agent, then panel. */
function Wayfinder({ path }: { path: string }) {
  const router = useRouter();
  const [agentName, setAgentName] = useState<{ id: string; name: string } | null>(null);
  const [, section, id, panel] = path.split("/");
  const item = [...NAV.flatMap((g) => g.items), SETTINGS].find((i) => i.href === `/${section ?? ""}`);
  const inAgent = section === "agents" && id;

  useEffect(() => {
    if (!inAgent) return;
    let live = true;
    api
      .agent(id)
      .then((a) => live && setAgentName({ id, name: a.draft.name }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [inAgent, id]);

  const crumbs: { label: string; href?: string }[] = [];
  if (item) crumbs.push({ label: item.label, href: inAgent ? item.href : undefined });
  if (inAgent) {
    const name = agentName?.id === id ? agentName.name : "Agent";
    const panelLabel = EDITOR_PANELS.find((p) => p.slug === (panel ?? ""))?.label;
    crumbs.push({ label: name, href: panel ? `/agents/${id}` : undefined });
    if (panelLabel) crumbs.push({ label: panelLabel });
  }

  return (
    <div className={s.way}>
      <div className={s.wayButtons}>
        <button type="button" onClick={() => router.back()} aria-label="Go back" title="Back">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" onClick={() => router.forward()} aria-label="Go forward" title="Forward">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <nav aria-label="You are here" className={s.crumbs}>
        {crumbs.map((c, i) => (
          <span key={`${c.label}-${i}`} className={s.crumb}>
            {i > 0 && <span aria-hidden>/</span>}
            {c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
          </span>
        ))}
      </nav>
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

  return (
    <div className={s.app}>
      <a href="#main" className={s.skip}>
        Skip to content
      </a>
      <header className={s.topbar}>
        <Link href="/" className={s.brand}>
          <Mark />
          <span>MetaAvatar</span>
        </Link>
        <button className={s.menuBtn} aria-expanded={open} aria-controls="studio-nav" onClick={() => setOpen(!open)}>
          {open ? "Close" : "Menu"}
        </button>
      </header>

      <nav id="studio-nav" className={s.rail} data-open={open} aria-label="Studio">
        <Link href="/" className={`${s.brand} ${s.railBrand}`}>
          <Mark />
          <span>MetaAvatar</span>
          <span className={s.brandSub}>Studio</span>
        </Link>
        {NAV.map((g) => (
          <div key={g.label} className={s.group}>
            <p className={s.groupLabel}>{g.label}</p>
            {g.items.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} />
            ))}
          </div>
        ))}
        <div className={s.railFoot}>
          <NavLink item={SETTINGS} active={isActive(SETTINGS.href)} />
        </div>
      </nav>

      <main id="main" className={s.main}>
        <Wayfinder path={path} />
        <UndoProvider>{children}</UndoProvider>
      </main>
    </div>
  );
}
