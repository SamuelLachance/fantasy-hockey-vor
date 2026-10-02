/**
 * The asset score's one definition (dependency-free, so the player table and
 * the « Actifs » tab share it without pulling each other's code): a player's
 * key is his dynasty value, ties broken by his season points; his score is
 * the share of the league's rostered players' keys strictly below his.
 * Audit 2026-10-02: the tab broke no ties, so a zero-value player read 0
 * there and up to 9 in the table.
 */

/** One player's asset key: his dynasty value, ties broken by his season points (unknown: −1). */
export type AssetKey = readonly [value: number, seasonFp: number];

export const assetKey = (value: number | null | undefined, seasonFp: number | null | undefined): AssetKey => [
  value ?? 0,
  seasonFp ?? -1,
];

const keyLess = (a: AssetKey, b: AssetKey) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

/** The scale an asset score is read against: the league's rostered players' keys, ascending. */
export function assetScale(keys: Iterable<AssetKey>): AssetKey[] {
  return [...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Asset score 0-100: the share of the scale strictly below the key. */
export function assetScore(scale: readonly AssetKey[], key: AssetKey): number {
  const n = scale.length;
  if (!n) return 0;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keyLess(scale[mid]!, key)) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, Math.min(100, Math.round((lo / n) * 100)));
}
