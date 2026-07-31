/** Map a category z-score to a bar width percent for expand UI. */
export function categoryZBarWidth(z: number): number {
  return Math.min(100, Math.max(8, 50 + z * 12));
}

/** Decimal places for ±σ display beside a projected counting stat. */
export function categorySigmaDigits(cat: string): number {
  return cat === "goals" || cat === "assists" || cat === "powerplayPoints"
    ? 1
    : 0;
}

/** Clamp z for aria meter bounds while valuetext keeps the true score. */
export function categoryZMeterValue(z: number, bound = 4): number {
  if (!Number.isFinite(z)) return 0;
  return Math.max(-bound, Math.min(bound, Number(z.toFixed(2))));
}
