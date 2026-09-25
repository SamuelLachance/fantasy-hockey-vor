import { ArrowUpDown, MoveRight, TrendingDown, TrendingUp } from "lucide-react";
import {
  SNAKE_PROBABLE_LABEL,
  SNAKE_PROBABLE_TITLE,
  stanceLabel,
  stanceToneClass,
  trendLabel,
} from "@/lib/snake/copy";
import type { SnakeStance, SnakeTrend } from "@/lib/snake/types";

/** Verdict chip: label + color (+ optional "Snake" prefix). Never color alone. */
export function SnakeVerdictChip({
  verdict,
  prefix,
  className = "",
}: {
  verdict: SnakeStance;
  /** Visible prefix, e.g. "Snake". */
  prefix?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${stanceToneClass(verdict)} ${className}`.trim()}
    >
      {prefix ? <span className="font-medium opacity-80">{prefix} :</span> : null}
      {stanceLabel(verdict)}
    </span>
  );
}

function TrendIcon({ trend, className }: { trend: SnakeTrend; className: string }) {
  switch (trend) {
    case "en hausse":
      return <TrendingUp className={className} aria-hidden="true" />;
    case "en baisse":
      return <TrendingDown className={className} aria-hidden="true" />;
    case "variable":
      return <ArrowUpDown className={className} aria-hidden="true" />;
    case "stable":
      return <MoveRight className={className} aria-hidden="true" />;
    default:
      return null;
  }
}

/** Trend of his opinion over time (hidden when unknown unless `showUnknown`). */
export function SnakeTrendBadge({ trend, showUnknown = false }: { trend: SnakeTrend; showUnknown?: boolean }) {
  if (trend === "inconnue" && !showUnknown) return null;
  const tone =
    trend === "en hausse"
      ? "text-emerald-300"
      : trend === "en baisse"
        ? "text-rose-300"
        : trend === "variable"
          ? "text-amber-200"
          : "text-slate-300";
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium ${tone}`}>
      <TrendIcon trend={trend} className="h-3.5 w-3.5 shrink-0" />
      {trendLabel(trend)}
    </span>
  );
}

/** Discreet "attribution probable" marker. */
export function SnakeProbableMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md border border-dashed border-amber-400/40 px-1.5 py-0.5 text-[11px] font-medium text-amber-200/90 ${className}`.trim()}
      title={SNAKE_PROBABLE_TITLE}
    >
      {SNAKE_PROBABLE_LABEL}
    </span>
  );
}
