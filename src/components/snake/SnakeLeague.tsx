"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { scheduleIdle } from "@/lib/schedule-idle";
import { loadSnakeFantrax } from "@/lib/snake/client";
import { SNAKE_PROBABLE_LABEL, snakeVerdictAria, stanceLabel, stanceToneClass } from "@/lib/snake/copy";
import type { SnakeFantraxEntry, SnakeFantraxFile, SnakeTrend } from "@/lib/snake/types";
import { snakePlayerHref } from "@/lib/snake/url";
import { SnakeMiniChip } from "./SnakeBoardChip";

type Rows = SnakeFantraxFile["rows"];

/** Compact trend marks for dense chips (the full word is in the accessible name). */
const TREND_ARROW: Record<SnakeTrend, string> = {
  "en hausse": "↗",
  "en baisse": "↘",
  stable: "→",
  variable: "↕",
  inconnue: "",
};

const SnakeLeagueContext = createContext<Rows | null>(null);

/**
 * Fantrax id → Snake verdict for the /league page. First paint uses the
 * build-time seed (the default team's players); the full lookup is fetched
 * when the browser is idle, so any team, waiver or draft player gets his
 * chip too.
 */
export function SnakeLeagueProvider({ seed, children }: { seed: Rows; children: ReactNode }) {
  const [rows, setRows] = useState<Rows | null>(null);
  useEffect(() => {
    let cancelled = false;
    const cancelIdle = scheduleIdle(() => {
      loadSnakeFantrax().then(
        (d) => {
          if (!cancelled) setRows(d.rows);
        },
        () => {
          // Silent: the seed keeps the default team's chips.
        },
      );
    }, 1_000);
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, []);
  const value = useMemo(() => (rows ? { ...seed, ...rows } : seed), [rows, seed]);
  return <SnakeLeagueContext.Provider value={value}>{children}</SnakeLeagueContext.Provider>;
}

export function useSnakeFantrax(id: string | null | undefined): SnakeFantraxEntry | null {
  const rows = useContext(SnakeLeagueContext);
  return id && rows ? (rows[id] ?? null) : null;
}

/**
 * Snake chip for a Fantrax player (links to his /snake page), plus his
 * one-line synthesis when `line`. Renders nothing for players he never
 * discussed.
 */
export function SnakeLeagueNote({
  id,
  name,
  line = false,
  className = "",
}: {
  id: string | null | undefined;
  name?: string;
  line?: boolean;
  className?: string;
}) {
  const e = useSnakeFantrax(id);
  if (!e) return null;
  const [key, verdict, trend, summary, probable] = e;
  const aria = `${snakeVerdictAria(verdict, trend, probable === 1, name)}. Voir ses opinions`;
  const arrow = TREND_ARROW[trend];
  return (
    <span className={`flex min-w-0 flex-col gap-0.5 ${className}`.trim()}>
      <span className="flex flex-wrap items-center gap-1.5">
        <Link
          href={snakePlayerHref(key)}
          prefetch={false}
          aria-label={aria}
          className={`inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-semibold ring-1 ring-inset hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 ${stanceToneClass(verdict)}`}
        >
          <span className="font-medium opacity-80">Snake :</span> {stanceLabel(verdict)}
          {arrow ? <span aria-hidden="true">{arrow}</span> : null}
        </Link>
        {probable ? <span className="text-[11px] text-amber-200/80">({SNAKE_PROBABLE_LABEL})</span> : null}
      </span>
      {line && summary ? <span className="line-clamp-2 text-xs text-slate-400">{summary}</span> : null}
    </span>
  );
}

/**
 * Non-interactive mini marker (dense grids): S + verdict symbol, with a
 * visible mark when the attribution is only probable. `decorative` inside a
 * row header, where a sentence would be repeated on every cell move (the
 * lineup card above carries the full, linked verdict).
 */
export function SnakeLeagueMini({ id, decorative = false }: { id: string | null | undefined; decorative?: boolean }) {
  const e = useSnakeFantrax(id);
  if (!e) return null;
  const [, verdict, trend, , probable] = e;
  return <SnakeMiniChip verdict={verdict} trend={trend} probable={probable === 1} decorative={decorative} />;
}
