/**
 * "Will he still be there at my pick?" from a market position.
 *
 * Where a player goes is modelled as a logistic distribution around his
 * market position m with scale growing with m (early picks are tight, late
 * ones scatter). Logistic rather than normal: its tail is exponential, so a
 * player already sliding past his ADP keeps a steady hazard of going each
 * pick instead of the normal's collapse to 0 — and ratios of tail areas stay
 * numerically sane.
 *
 * The market is the Fantrax ADP when matched (a points-league crowd, so only
 * a proxy for a Yahoo categories room); otherwise the board's own VOR rank
 * with a wider spread, since our rank is not what other managers see.
 */

export interface MarketPlayer {
  adp: number | null;
  rank: number;
}

export interface MarketPosition {
  m: number;
  /** Standard deviation of the pick the player goes at. */
  sd: number;
  source: "adp" | "rank";
}

export function marketPosition(p: MarketPlayer): MarketPosition {
  // Spread ≈ 20 % of the ADP (+1 pick): consensus top-3 picks almost never
  // reach pick 5, while a 100-ADP player goes anywhere in ~80–120.
  if (p.adp != null && Number.isFinite(p.adp)) {
    return { m: p.adp, sd: 1 + 0.2 * p.adp, source: "adp" };
  }
  return { m: p.rank, sd: 4 + 0.3 * p.rank, source: "rank" };
}

/** P(still undrafted after pick x) for a logistic(m, sd). */
function survival(x: number, m: number, sd: number): number {
  const s = (sd * Math.sqrt(3)) / Math.PI;
  const t = (x - m) / s;
  // 1 / (1 + e^t), written to avoid overflow for large |t|.
  return t > 0 ? Math.exp(-t) / (1 + Math.exp(-t)) : 1 / (1 + Math.exp(t));
}

/**
 * P(available at `targetPick` | available at `currentPick`). A player is
 * available at pick t when nobody took him at picks < t, i.e. his draft
 * position X ≥ t (X continuous, integer picks → X > t − ½).
 */
export function probAvailableAt(
  p: MarketPlayer,
  currentPick: number,
  targetPick: number,
): number {
  if (targetPick <= currentPick) return 1;
  const { m, sd } = marketPosition(p);
  const now = survival(currentPick - 0.5, m, sd);
  const then = survival(targetPick - 0.5, m, sd);
  if (!(now > 0)) return 0;
  return Math.max(0, Math.min(1, then / now));
}

export type AvailabilityBand = "yes" | "maybe" | "no";

export function availabilityBand(prob: number): AvailabilityBand {
  if (prob >= 0.7) return "yes";
  if (prob >= 0.35) return "maybe";
  return "no";
}
