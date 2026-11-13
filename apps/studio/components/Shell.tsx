"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { NAV, type NavItem, SETTINGS } from "@/lib/nav";
import s from "./shell.module.css";

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

export default function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const isActive = (href: string) => path === href || path.startsWith(`${href}/`);

  return (
    <div className={s.app}>
      <a href="#main" className={s.skip}>
        Skip to content
      </a>
      <header className={s.topbar}>
        <Link href="/agents" className={s.brand}>
          <Mark />
          <span>MetaAvatar</span>
        </Link>
        <button className={s.menuBtn} aria-expanded={open} aria-controls="studio-nav" onClick={() => setOpen(!open)}>
          {open ? "Close" : "Menu"}
        </button>
      </header>

      <nav id="studio-nav" className={s.rail} data-open={open} aria-label="Studio">
        <Link href="/agents" className={`${s.brand} ${s.railBrand}`}>
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
        {children}
      </main>
    </div>
  );
}
