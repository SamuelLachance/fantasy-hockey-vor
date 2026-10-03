/**
 * Usage-aware rest-of-season rates of a skater (daily in-season update,
 * scripts/update-in-season.ts; backtested by scripts/backtest-in-season.ts).
 *
 * Box stats are slow to speak (a goal total needs ~80 games before it weighs
 * as much as the pre-season rate), ice time is fast (3 games): a winger moved
 * to the first line or the first power-play unit plays those minutes from
 * the next game on. So each rate is
 *
 *   1. the pre-season rate moved by the change of role: × (ice time now /
 *      ice time last seasons)^β × ((PP time now + c) / (PP time before + c))^γ,
 *      β and γ per stat (shots and goals follow the minutes, hits barely);
 *   2. shrunk toward what he has done this season, K games per stat
 *      ((prior × K + total) / (K + games), as before);
 *   3. goals: his shot rate × his shooting percentage regressed toward his
 *      pre-season one (SHOOTING_K shots), not the goal total: shots settle
 *      fast, finishing does not.
 *
 * "Ice time now" is a recency-weighted mean of his games this season
 * (half-life in games), shrunk toward the prior with a few games.
 */

export const USAGE_STATS = ["goals", "assists", "powerplayPoints", "shots", "hits", "blocks", "penaltyMinutes", "faceoffWins"] as const;
export type UsageStat = (typeof USAGE_STATS)[number];

export interface UsageParams {
  /** Prior weight (games) and half-life (games) of the ice-time estimate. */
  toiK: number;
  toiHalfLife: number;
  ppK: number;
  ppHalfLife: number;
  /** Minutes added to both PP times so a ratio of small numbers stays tame. */
  ppCushion: number;
  /** Bounds of each usage ratio. */
  ratioMin: number;
  ratioMax: number;
}
export interface StatRule {
  /** Games before the season's rate weighs as much as the role-adjusted prior. */
  k: number;
  /** Elasticity to all-situations ice time and to power-play time. */
  toi: number;
  pp: number;
}

/** Chosen on 2021-22 → 2025-26 (scripts/backtest-in-season.ts --tune). */
export const USAGE_PARAMS: Readonly<UsageParams> = { toiK: 3, toiHalfLife: 10, ppK: 5, ppHalfLife: 5, ppCushion: 0.5, ratioMin: 0.5, ratioMax: 2 };
export const STAT_RULES: Readonly<Record<UsageStat, StatRule>> = {
  goals: { k: 100, toi: 1.25, pp: 0 },
  assists: { k: 81.25, toi: 0.75, pp: 0.25 },
  powerplayPoints: { k: 62.5, toi: 1, pp: 0.5 },
  shots: { k: 35, toi: 0.75, pp: 0 },
  hits: { k: 20, toi: 0.25, pp: 0 },
  blocks: { k: 50, toi: 0.75, pp: 0 },
  penaltyMinutes: { k: 120, toi: 0.25, pp: 0 },
  faceoffWins: { k: 7.5, toi: 0.25, pp: 0 },
};
/** Shots before a season's shooting percentage weighs as much as the pre-season one. */
export const SHOOTING_K = 350;
/** Games share: prior weight (team games) and half-life (team games) of the games he dressed for. */
export const SHARE_K = 12;
export const SHARE_HALF_LIFE = 5;
/** A cut in ice time foretells scratches and demotions: share × (role ratio)^η. */
export const SHARE_TOI_ELASTICITY = 0.25;
/** Completed absences of at least this many team games are left out of the share (0: none). */
export const SHARE_SKIP_ABSENCE = 10;

/**
 * Recency-weighted mean of per-game values (oldest first), shrunk toward
 * `prior` with weight `k`: game i of n weighs 0.5^((n − 1 − i) / halfLife)
 * (halfLife 0: all games alike).
 */
export function recencyMean(prior: number, values: readonly number[], k: number, halfLife: number): number {
  let num = prior * k;
  let den = k;
  const n = values.length;
  for (let i = 0; i < n; i++) {
    const w = halfLife > 0 ? Math.pow(0.5, (n - 1 - i) / halfLife) : 1;
    num += w * values[i]!;
    den += w;
  }
  return den > 0 ? num / den : prior;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface UsageInput {
  /** Pre-season ice time and power-play time per game (minutes); null: unknown. */
  toiPrior: number | null;
  ppPrior: number | null;
  /** This season's games, oldest first (minutes). */
  toi: readonly number[];
  pp: readonly number[];
}
export interface Usage {
  /** Ice time and PP time per game expected from now on. */
  toi: number | null;
  pp: number | null;
  /** Role ratios (1: same role as before the season). */
  toiRatio: number;
  ppRatio: number;
}

/** His role now against his role before the season. */
export function usageNow(u: UsageInput, p: UsageParams = USAGE_PARAMS): Usage {
  if (u.toiPrior == null || !(u.toiPrior > 0) || u.toi.length === 0) {
    return { toi: u.toi.length ? recencyMean(0, u.toi, 0, p.toiHalfLife) : null, pp: u.pp.length ? recencyMean(0, u.pp, 0, p.ppHalfLife) : null, toiRatio: 1, ppRatio: 1 };
  }
  const toi = recencyMean(u.toiPrior, u.toi, p.toiK, p.toiHalfLife);
  const ppPrior = Math.max(0, u.ppPrior ?? 0);
  const pp = recencyMean(ppPrior, u.pp, p.ppK, p.ppHalfLife);
  return {
    toi,
    pp,
    toiRatio: clamp(toi / u.toiPrior, p.ratioMin, p.ratioMax),
    ppRatio: clamp((pp + p.ppCushion) / (ppPrior + p.ppCushion), p.ratioMin, p.ratioMax),
  };
}

export interface SkaterRateInput {
  /** Pre-season per-game rates. */
  prior: Readonly<Record<UsageStat, number>>;
  /** Season totals and games so far. */
  totals: Readonly<Record<UsageStat, number>>;
  gp: number;
  usage: Usage;
}

/** Rest-of-season per-game rates. */
export function restOfSeasonRates(
  x: SkaterRateInput,
  rules: Readonly<Record<UsageStat, StatRule>> = STAT_RULES,
  shootingK: number = SHOOTING_K,
): Record<UsageStat, number> {
  const out = {} as Record<UsageStat, number>;
  const gp = Math.max(0, x.gp);
  for (const st of USAGE_STATS) {
    const r = rules[st];
    const k = r.k;
    const prior = Math.max(0, x.prior[st] ?? 0) * Math.pow(x.usage.toiRatio, r.toi) * Math.pow(x.usage.ppRatio, r.pp);
    const d = k + gp;
    out[st] = d > 0 ? (prior * k + Math.max(0, x.totals[st] ?? 0)) / d : prior;
  }
  if (shootingK > 0) {
    const priorShots = Math.max(0, x.prior.shots ?? 0);
    const priorGoals = Math.max(0, x.prior.goals ?? 0);
    if (priorShots > 0) {
      const pct = ((priorGoals / priorShots) * shootingK + Math.max(0, x.totals.goals ?? 0)) / (shootingK + Math.max(0, x.totals.shots ?? 0));
      out.goals = out.shots * pct;
    }
  }
  return out;
}

/**
 * Expected share of his team's games from now on: the pre-season share
 * updated by the team games he played, recent ones weighing more
 * (half-life in team games). `played` lists his team's games so far, oldest
 * first (true: he dressed); leave out the games of a CURRENT reported
 * absence (the injury takes out his games until his return).
 */
export function recentGameShare(priorShare: number, played: readonly boolean[], k: number, halfLife: number): number {
  const v = played.map((x) => (x ? 1 : 0));
  return clamp(recencyMean(clamp(priorShare, 0, 1), v, k, halfLife), 0, 1);
}

/**
 * The team games he dressed for, with every COMPLETED absence of at least
 * `minLength` games left out (he came back: a past injury says little about
 * the rest of his season beyond what the pre-season share already holds).
 * A trailing absence (still out) is kept.
 */
export function withoutCompletedAbsences(played: readonly boolean[], minLength: number): boolean[] {
  if (!(minLength > 0)) return [...played];
  const out: boolean[] = [];
  let run = 0;
  for (const p of played) {
    if (!p) {
      run++;
      continue;
    }
    // a run that ended with this game: keep it only if short (or before his first game)
    if (run > 0 && (run < minLength || out.length === 0)) for (let i = 0; i < run; i++) out.push(false);
    run = 0;
    out.push(true);
  }
  for (let i = 0; i < run; i++) out.push(false);
  return out;
}

/** Games share from now on: recency-weighted share × (ice-time ratio)^η, within [0, 1]. */
export function gamesShareNow(
  priorShare: number,
  played: readonly boolean[],
  usage: Usage,
  k: number = SHARE_K,
  halfLife: number = SHARE_HALF_LIFE,
  eta: number = SHARE_TOI_ELASTICITY,
  absenceMin: number = SHARE_SKIP_ABSENCE,
): number {
  return clamp(recentGameShare(priorShare, withoutCompletedAbsences(played, absenceMin), k, halfLife) * Math.pow(usage.toiRatio, eta), 0, 1);
}
