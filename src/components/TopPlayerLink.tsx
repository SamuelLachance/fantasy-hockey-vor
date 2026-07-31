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
  /** Compact padding for nested position leader lists. */
  dense?: boolean;
  children: ReactNode;
  trailing: ReactNode;
}

/** Shared list-row link used by TopPlayers leaderboards. */
export function TopPlayerLink({
  href,
  accent = "cyan",
  dense = false,
  children,
  trailing,
}: TopPlayerLinkProps) {
  const a = ACCENT[accent];
  return (
    <a
      href={href}
      className={`flex min-h-11 items-center justify-between rounded-xl border border-white/5 bg-white/5 transition motion-reduce:transition-none ${
        dense ? "gap-2 px-2 py-1.5" : "px-4 py-3"
      } ${a.hover} hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 ${a.ring}`}
    >
      <div className={`flex items-center ${dense ? "gap-2 min-w-0" : "gap-3"}`}>
        {children}
      </div>
      {trailing}
    </a>
  );
}
