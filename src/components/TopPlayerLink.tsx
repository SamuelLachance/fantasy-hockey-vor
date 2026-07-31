import type { ReactNode } from "react";

type Accent = "cyan" | "emerald" | "amber";

const ACCENT: Record<
  Accent,
  { hover: string; ring: string }
> = {
  cyan: {
    hover: "hover:border-cyan-500/30",
    ring: "focus-visible:ring-cyan-300/80",
  },
  emerald: {
    hover: "hover:border-emerald-500/30",
    ring: "focus-visible:ring-emerald-300/80",
  },
  amber: {
    hover: "hover:border-amber-500/30",
    ring: "focus-visible:ring-amber-300/80",
  },
};

interface TopPlayerLinkProps {
  href: string;
  accent?: Accent;
  children: ReactNode;
  trailing: ReactNode;
}

/** Shared list-row link used by TopPlayers leaderboards. */
export function TopPlayerLink({
  href,
  accent = "cyan",
  children,
  trailing,
}: TopPlayerLinkProps) {
  const a = ACCENT[accent];
  return (
    <a
      href={href}
      className={`flex items-center justify-between rounded-xl border border-white/5 bg-white/5 px-4 py-3 transition ${a.hover} hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 ${a.ring}`}
    >
      <div className="flex items-center gap-3">{children}</div>
      {trailing}
    </a>
  );
}
