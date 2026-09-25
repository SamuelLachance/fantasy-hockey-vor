import { snakeChipTitle, snakeVerdictAria, stanceSymbol, stanceToneClass } from "@/lib/snake/copy";
import type { SnakeStance, SnakeTrend } from "@/lib/snake/types";

/**
 * Compact verdict marker (S + verdict symbol, colored) for dense spots: the
 * rankings board name cell and the /league week grid. The full French
 * verdict is the hover title and, unless `decorative`, the accessible text.
 * A verdict resting only on "probable" passages is visibly marked too (a
 * dashed ring and "?"), not only in the hover text. Not interactive.
 */
export function SnakeMiniChip({
  verdict,
  trend,
  probable,
  decorative = false,
}: {
  verdict: SnakeStance;
  trend: SnakeTrend;
  probable: boolean;
  /** The verdict is announced elsewhere (e.g. the row's own label). */
  decorative?: boolean;
}) {
  const label = snakeVerdictAria(verdict, trend, probable);
  return (
    <span
      lang="fr-CA"
      title={snakeChipTitle(verdict, trend, probable)}
      aria-hidden={decorative || undefined}
      className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-px font-mono text-[10px] font-bold leading-4 ring-1 ring-inset ${stanceToneClass(verdict)} ${probable ? "outline outline-1 outline-dashed outline-offset-1 outline-amber-300/70" : ""}`.trim()}
    >
      <span aria-hidden="true">
        S{stanceSymbol(verdict)}
        {probable ? "?" : ""}
      </span>
      {decorative ? null : <span className="sr-only">{label}</span>}
    </span>
  );
}

/** Board name-cell chip (the row's label already carries the verdict in English). */
export function SnakeBoardChip({ entry }: { entry: readonly [string, SnakeStance, SnakeTrend, 0 | 1] }) {
  const [, verdict, trend, probable] = entry;
  return <SnakeMiniChip verdict={verdict} trend={trend} probable={probable === 1} />;
}
