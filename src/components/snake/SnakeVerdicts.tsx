"use client";

import Link from "next/link";
import { SNAKE_PROBABLE_LABEL, snakeVerdictAria, stanceLabel, stanceToneClass } from "@/lib/snake/copy";
import type { SnakeTrend } from "@/lib/snake/types";
import { snakePlayerHref } from "@/lib/snake/url";
import { SnakeMiniChip } from "./SnakeBoardChip";
import { useSnakeFantrax, useSnakeNhl } from "./SnakeVerdictsContext";

// The store half (provider and hooks) lives in ./SnakeVerdictsContext; the
// pages and tables keep importing it from here.
export {
  SnakeVerdictsProvider,
  useSnakeFantrax,
  useSnakeFantraxRows,
  useSnakeNhl,
  useSnakeNhlRows,
} from "./SnakeVerdictsContext";

/** Compact trend marks for dense chips (the full word is in the accessible name). */
const TREND_ARROW: Record<SnakeTrend, string> = {
  "en hausse": "↗",
  "en baisse": "↘",
  stable: "→",
  variable: "↕",
  inconnue: "",
};

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

/** Mini marker for a player known by his NHL id (categories leagues' boards). */
export function SnakeNhlMini({ id, decorative = false }: { id: number | string | null | undefined; decorative?: boolean }) {
  const e = useSnakeNhl(id);
  if (!e) return null;
  const [, verdict, trend, probable] = e;
  return <SnakeMiniChip verdict={verdict} trend={trend} probable={probable === 1} decorative={decorative} />;
}
