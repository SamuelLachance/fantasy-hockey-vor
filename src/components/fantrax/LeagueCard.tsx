import type { ReactNode, Ref } from "react";
import type { PlanPlayer } from "@/lib/fantrax/daily-plan";
import type { SlotId } from "@/lib/fantrax/config";
import { SLOT_LABEL, positionsLabel } from "@/lib/fantrax/league-copy";

/** Resolves a Fantrax id to what the page shows (plan first, then the snapshot). */
export type PlayerLookup = (id: string | null | undefined) => PlanPlayer | undefined;

interface LeagueCardProps {
  /** Section anchor (the quick links jump here). */
  id: string;
  icon: ReactNode;
  title: string;
  accentClass?: string;
  description?: ReactNode;
  headerExtra?: ReactNode;
  className?: string;
  /** Lets script move focus to the heading (a link from another panel jumped here). */
  focusableHeading?: boolean;
  sectionRef?: Ref<HTMLElement>;
  children: ReactNode;
}

/** Card chrome shared by the /league sections (same look as the leader panels). */
export function LeagueCard({
  id,
  icon,
  title,
  accentClass = "text-cyan-400",
  description,
  headerExtra,
  className = "",
  focusableHeading = false,
  sectionRef,
  children,
}: LeagueCardProps) {
  const headingId = `${id}-titre`;
  return (
    <section
      id={id}
      ref={sectionRef}
      aria-labelledby={headingId}
      className={`min-w-0 scroll-mt-4 rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-4 sm:p-6 ${className}`.trim()}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className={`flex items-center gap-2 ${accentClass}`}>
          <span aria-hidden="true" className="inline-flex shrink-0">
            {icon}
          </span>
          <h2
            id={headingId}
            tabIndex={focusableHeading ? -1 : undefined}
            className="rounded-md text-lg font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            {title}
          </h2>
        </div>
        {headerExtra}
      </div>
      {description ? (
        <p className="mb-4 text-sm text-slate-400">{description}</p>
      ) : null}
      {children}
    </section>
  );
}

const SLOT_COLORS: Record<SlotId, string> = {
  C: "bg-cyan-500/20 text-cyan-300 ring-cyan-500/30",
  W: "bg-sky-500/20 text-sky-300 ring-sky-500/30",
  F: "bg-blue-500/20 text-blue-300 ring-blue-500/30",
  D: "bg-indigo-500/20 text-indigo-300 ring-indigo-500/30",
  Skt: "bg-amber-500/20 text-amber-200 ring-amber-500/40",
  G: "bg-violet-500/20 text-violet-300 ring-violet-500/30",
};

/** Fantrax slot code (what the user sees in Fantrax), French name on hover / for AT. */
export function SlotBadge({ slot }: { slot: SlotId }) {
  return (
    <span
      className={`inline-flex min-w-[2.25rem] items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${SLOT_COLORS[slot]}`}
      title={SLOT_LABEL[slot]}
    >
      <span aria-hidden="true">{slot}</span>
      <span className="sr-only">{SLOT_LABEL[slot]}</span>
    </span>
  );
}

/** Name, NHL team and positions; unknown ids (added since the sync) say so. */
export function PlayerName({
  id,
  player,
  className = "",
}: {
  id: string;
  player: PlayerLookup;
  className?: string;
}) {
  const p = player(id);
  if (!p) {
    return (
      <span className={`text-slate-300 ${className}`.trim()}>
        Nouveau joueur{" "}
        <span className="text-xs text-slate-400">(ajouté depuis la dernière synchro)</span>
      </span>
    );
  }
  return (
    <span className={`min-w-0 ${className}`.trim()}>
      <span className="font-medium text-white">{p.n}</span>{" "}
      <span className="whitespace-nowrap text-xs text-slate-400">
        {p.t} · {positionsLabel(p.e)}
      </span>
    </span>
  );
}

/** Small neutral tag (roster status, "vient des mineures"…). */
export function Tag({
  children,
  tone = "slate",
  wrap = false,
}: {
  children: ReactNode;
  tone?: "slate" | "amber" | "rose" | "emerald" | "violet" | "cyan";
  /** Long tags may wrap on phones (a nowrap one widens its table column past the screen). */
  wrap?: boolean;
}) {
  const tones = {
    slate: "bg-white/5 text-slate-300 ring-white/10",
    cyan: "bg-cyan-500/10 text-cyan-200 ring-cyan-500/30",
    amber: "bg-amber-500/10 text-amber-200 ring-amber-500/30",
    rose: "bg-rose-500/10 text-rose-200 ring-rose-500/30",
    emerald: "bg-emerald-500/10 text-emerald-200 ring-emerald-500/30",
    violet: "bg-violet-500/10 text-violet-200 ring-violet-500/30",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        wrap ? "rounded-lg max-sm:whitespace-normal sm:whitespace-nowrap sm:rounded-full" : "whitespace-nowrap rounded-full"
      } ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
