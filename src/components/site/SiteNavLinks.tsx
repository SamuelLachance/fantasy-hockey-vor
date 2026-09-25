"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { SITE_NAV_LABEL, isNavActive, navCurrent, navItems, type NavItem } from "@/lib/site-nav";

const ITEMS = navItems();
const MENU_ID = "navigation-principale";

const LINK =
  "inline-flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-medium transition motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 sm:w-auto";
const IDLE = "text-slate-300 hover:bg-white/5 hover:text-white";
const ACTIVE = "bg-white/10 text-white underline decoration-cyan-400 decoration-2 underline-offset-8";

function ItemLink({
  item,
  active,
  current,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  /** "page" only on the page the link opens; "true" inside a league (another of its tabs). */
  current: "page" | "true" | undefined;
  onNavigate: () => void;
}) {
  const cls = `${LINK} ${active ? ACTIVE : IDLE}`;
  const body = (
    <>
      <span>{item.label}</span>
      {item.tag ? (
        <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[0.7rem] font-normal text-slate-400 no-underline ring-1 ring-inset ring-white/10">
          {item.tag}
        </span>
      ) : null}
    </>
  );
  // 404.html is prerendered once and served at any address, so the active
  // item may differ once hydrated (this attribute only).
  return item.kind === "document" ? (
    <a
      href={item.href}
      title={item.title}
      aria-current={current}
      onClick={onNavigate}
      className={cls}
      suppressHydrationWarning
    >
      {body}
    </a>
  ) : (
    <Link
      href={item.href}
      prefetch={false}
      title={item.title}
      aria-current={current}
      onClick={onNavigate}
      className={cls}
      suppressHydrationWarning
    >
      {body}
    </Link>
  );
}

/**
 * The global nav: inline from `sm` up; on phones behind a « Menu » button
 * that opens it in the page flow (not an overlay). Escape closes it and
 * puts the focus back on the button; any navigation closes it.
 */
export function SiteNavLinks() {
  const pathname = usePathname();
  // Open "for" the address it was opened at, so a navigation closes it
  // without an effect.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt !== null && openAt === pathname;
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || !open) return;
    e.preventDefault();
    setOpenAt(null);
    buttonRef.current?.focus();
  };
  const close = () => setOpenAt(null);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={MENU_ID}
        aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
        onClick={() => setOpenAt(open ? null : (pathname ?? "/"))}
        onKeyDown={onKeyDown}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-medium text-slate-200 transition motion-reduce:transition-none hover:border-cyan-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 sm:hidden"
      >
        {open ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
        <span aria-hidden="true">Menu</span>
      </button>
      <nav
        id={MENU_ID}
        aria-label={SITE_NAV_LABEL}
        onKeyDown={onKeyDown}
        className={`${open ? "block" : "hidden"} w-full border-t border-white/10 pt-2 sm:block sm:w-auto sm:border-0 sm:pt-0`}
      >
        <ul className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {ITEMS.map((item) => (
            <li key={item.key}>
              <ItemLink
                item={item}
                active={isNavActive(pathname, item)}
                current={navCurrent(pathname, item)}
                onNavigate={close}
              />
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
