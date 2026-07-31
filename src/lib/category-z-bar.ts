import { formatSigned } from "@/lib/format";

/** Absolute clamp for category z meters (aria-valuenow + valuemin/max). */
export const CATEGORY_Z_METER_BOUND = 4;

/** aria-valuemin for category z meters. */
export const CATEGORY_Z_METER_MIN = -CATEGORY_Z_METER_BOUND;

/** aria-valuemax for category z meters. */
export const CATEGORY_Z_METER_MAX = CATEGORY_Z_METER_BOUND;

/** Map a category z-score to a bar width percent for expand UI. */
export function categoryZBarWidth(z: number): number {
  return Math.min(100, Math.max(8, 50 + z * 12));
}

/** Tailwind fill classes for the category z meter (match label polarity). */
export function categoryZBarFillClass(z: number): string {
  return z >= 0
    ? "bg-gradient-to-r from-cyan-500 to-blue-500"
    : "bg-gradient-to-r from-rose-500 to-rose-400";
}

/** Decimal places for ±σ display beside a projected counting stat. */
export function categorySigmaDigits(cat: string): number {
  return cat === "goals" || cat === "assists" || cat === "powerplayPoints"
    ? 1
    : 0;
}

/** Clamp z for aria meter bounds while valuetext keeps the true score. */
export function categoryZMeterValue(
  z: number,
  bound = CATEGORY_Z_METER_BOUND,
): number {
  if (!Number.isFinite(z)) return 0;
  return Math.max(-bound, Math.min(bound, Number(z.toFixed(2))));
}

/** Visible z chip next to the category label. */
export function categoryZScoreLabel(z: number): string {
  return `${formatSigned(z, { digits: 2, plusZero: true })} z`;
}

/** Meter accessible name. */
export function categoryZMeterAriaLabel(categoryLabel: string): string {
  return `${categoryLabel} category z-score`;
}

/** Projected stat line prefix. */
export function categoryProjectionPrefix(): string {
  return "Proj:";
}
