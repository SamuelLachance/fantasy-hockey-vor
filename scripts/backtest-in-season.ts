/**
 * Day-by-day backtest of the daily in-season update (scripts/update-in-season.ts)
 * on past seasons, game by game.
 *
 * For each season 2021-22 → 2025-26 and each checkpoint (after his team's
 * T-th game, T = 5 … 70), every skater with a pre-season prior is projected
 * for the rest of the season from what was known that day only (his games
 * so far: box stats, ice time, power-play time, the team games he dressed
 * for), and scored against what he did after.
 *
 * Population: every skater with a pre-season prior who played in the
 * season, AND every pre-season pool player who played little or not at all
 * that season (at least POOL_PREV_GP games the season before, fewer than 10
 * that season, 0 included: sent down, unsigned, hurt all season, scratched
 * for good). The v2 walk-forward priors only exist for player-seasons of 10
 * games or more (the engine's training targets), so those pool players get
 * the Marcel prior. Scoring only the players who ended the season with 10
 * games would select on the outcome: a games-share rule that never lets a
 * player's share fall would look fine on them and keep giving games to the
 * ones who stopped playing. Cells by games that season: `:gp0`, `:gp1-9`,
 * `:gp10+`.
 *
 * Methods:
 * - `pre`: the pre-season projection alone (rate × pre-season games share);
 * - `pace`: the season pace alone (rates and games share to date);
 * - `cur`: the update as published at bd259b2 (src/lib/in-season.ts: per-stat
 *   shrinkage of the box stats, games share K 30);
 * - `new`: the usage-aware update (src/lib/inseason/skater.ts: role-adjusted
 *   prior, goals from shots × regressed shooting %, recency-weighted games
 *   share × a decay over the games missed in a row).
 *
 * Metrics: rest-of-season RMSE of Slapshot points (G 3.5, A 2.5, PPP 0.5,
 * SOG 0.25, HIT 0.15, BLK 0.3), Captains points (G 3, A 2, SOG 0.4, HIT 0.3,
 * BLK 0.3 for a D), Light the Lamp categories (G A PPP SOG HIT BLK, each
 * RMSE over the SD of the outcome, quadratic mean), games played, and each
 * stat at the games he actually played (rate only). By tier of pre-season
 * Slapshot points (top 150 / 151-400 / beyond). Error bars: 95 % interval of
 * the new / current RMSE ratio, bootstrap over player-seasons (all
 * checkpoints of a player-season resampled together), and the season by
 * season count of wins. `--tune` re-chooses every constant of
 * src/lib/inseason/skater.ts (the usage constants by coordinate search on the
 * Slapshot points at the games played, the per-stat rules on a grid, the
 * shooting K, the games-share constants on the games of the whole
 * population, minimizing the worst ratio to the current update among the
 * groups by games played and the checkpoints) and scores each season with
 * constants chosen on the other four (leave-one-season-out, Slapshot points
 * and games). `--fixed-usage` skips the usage search (faster).
 *
 * Priors: `--priors=<file>` reads the walk-forward v2 pre-season priors
 * (scripts/dump-walk-forward-priors.ts: per player-season `r[stat].cal`
 * and `gpModel`, the engine as published, trained on earlier seasons only);
 * without it, a Marcel 5/4/3 prior from the season aggregates (public,
 * cheap). Goalies are in scripts/backtest-in-season-goalies.ts.
 *
 * Data: scripts/fetch-in-season-history.ts (--cache=<dir>).
 * `--write` stores the summary in src/data/ml/in-season-backtest.json and,
 * with `--priors`, a frozen sample in src/data/ml/in-season-fixture.json
 * (scripts/in-season-fixture.ts), both checked by scripts/test-in-season.ts
 * (the published constants, no regression against the current update, and
 * the sample re-scored with the code as it stands).
 *
 * Run: npx tsx scripts/backtest-in-season.ts --cache=<dir> [--priors=<file>] [--tune] [--write]
 */
import { readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { shrinkRate, SKATER_RATE_K, SKATER_SHARE_K, updatedGameShare } from "../src/lib/in-season";
import {
  gamesShareNow,
  restOfSeasonRates,
  trailingMissed,
  SHARE_HALF_LIFE,
  SHARE_K,
  SHARE_MISS_HALF_LIFE,
  SHARE_SKIP_ABSENCE,
  SHARE_TOI_ELASTICITY,
  SHOOTING_K,
  STAT_RULES,
  USAGE_PARAMS,
  USAGE_STATS,
  usageNow,
  withoutCompletedAbsences,
  type StatRule,
  type Usage,
  type UsageParams,
  type UsageStat,
} from "../src/lib/inseason/skater";
import { priorUsageOf } from "../src/lib/inseason/live";
import { loadSeasonAggregates, loadSeasonGames, prevSeason, seasonTeamGames } from "./in-season-history";
import { DEFAULT_CACHE } from "./fetch-in-season-history";
import { FIXTURE_CHECKPOINTS, FIXTURE_EVERY, scoreFixture, type Fixture, type FixturePlayer } from "./in-season-fixture";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const DIR = arg("cache") ?? process.env.IN_SEASON_CACHE ?? DEFAULT_CACHE;
const PRIORS = arg("priors");
const TUNE = process.argv.includes("--tune");
const WRITE = process.argv.includes("--write");
export const BT_SEASONS = ["20212022", "20222023", "20232024", "20242025", "20252026"];
export const BT_CHECKPOINTS = [1, 2, 3, 5, 10, 15, 20, 30, 40, 50, 60, 70];
const BOOT = Number(arg("boot") ?? 400);
/** Pool players without a v2 prior: at least this many games the season before. */
export const POOL_PREV_GP = 10;

type Stats = Record<UsageStat, number>;
const zero = (): Stats => Object.fromEntries(USAGE_STATS.map((s) => [s, 0])) as Stats;
export const SLAPSHOT: Partial<Stats> = { goals: 3.5, assists: 2.5, powerplayPoints: 0.5, shots: 0.25, hits: 0.15, blocks: 0.3 };
export const CAPTAINS_F: Partial<Stats> = { goals: 3, assists: 2, shots: 0.4, hits: 0.3 };
export const CAPTAINS_D: Partial<Stats> = { ...CAPTAINS_F, blocks: 0.3 };
export const LTL_CATS: UsageStat[] = ["goals", "assists", "powerplayPoints", "shots", "hits", "blocks"];
const pts = (w: Partial<Stats>, x: Stats) => Object.entries(w).reduce((t, [k, v]) => t + (v as number) * x[k as UsageStat], 0);

// ---------------------------------------------------------------- priors
export interface Prior {
  rates: Stats;
  share: number;
}
export function v2Priors(path: string): Map<string, Prior> {
  const recs = JSON.parse(readFileSync(path, "utf8")) as Array<{ T: number; id: number; gpModel: number; r: Record<string, { cal: number }> }>;
  return new Map(recs.map((r) => [`${r.T}:${r.id}`, { rates: Object.fromEntries(USAGE_STATS.map((s) => [s, Math.max(0, r.r[s]?.cal ?? 0)])) as Stats, share: Math.min(1, Math.max(0, r.gpModel / 82)) }]));
}
/** Marcel 5/4/3 per-game rates regressed to the F / D mean of the previous season (R games per stat), games share 5/4/3. */
const MARCEL_R: Stats = { goals: 60, assists: 60, powerplayPoints: 60, shots: 40, hits: 40, blocks: 40, penaltyMinutes: 80, faceoffWins: 30 };
export function marcelPriors(seasons: string[]): Map<string, Prior> {
  const out = new Map<string, Prior>();
  for (const s of seasons) {
    const aggs = [1, 2, 3].map((k) => ({ a: loadSeasonAggregates(DIR, prevSeason(s, k)), sched: seasonTeamGames(prevSeason(s, k)), w: [5, 4, 3][k - 1]! }));
    const mean: Record<"F" | "D", Stats> = { F: zero(), D: zero() };
    for (const pos of ["F", "D"] as const) {
      let g = 0;
      const t = zero();
      for (const x of aggs[0]!.a.values()) if (x.pos === pos && x.gp >= 20) { g += x.gp; for (const st of USAGE_STATS) t[st] += x.s[st]; }
      for (const st of USAGE_STATS) mean[pos][st] = g > 0 ? t[st] / g : 0;
    }
    const ids = new Set<number>();
    for (const { a } of aggs) for (const id of a.keys()) ids.add(id);
    for (const id of ids) {
      let den = 0, sden = 0, sgp = 0;
      let pos: "F" | "D" | null = null;
      const num = zero();
      for (const { a, sched, w } of aggs) {
        const x = a.get(id);
        if (!x) continue;
        pos ??= x.pos;
        den += w * x.gp;
        sgp += w * x.gp;
        sden += w * sched;
        for (const st of USAGE_STATS) num[st] += w * x.s[st];
      }
      if (!pos || den <= 0) continue;
      const rates = zero();
      for (const st of USAGE_STATS) rates[st] = (num[st] + MARCEL_R[st] * mean[pos][st]) / (den + MARCEL_R[st]);
      out.set(`${s}:${id}`, { rates, share: Math.min(1, 0.06 + 0.85 * (sgp / sden)) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- checkpoints
export interface Ck {
  season: string;
  key: string;
  pos: "F" | "D";
  T: number;
  left: number;
  prior: Prior;
  tier: number;
  gp: number;
  totals: Stats;
  played: boolean[];
  toi: number[];
  pp: number[];
  toiPrior: number | null;
  ppPrior: number | null;
  rest: Stats;
  restGp: number;
  /** Games he played that whole season: "0", "1-9", "10+". */
  grp: "0" | "1-9" | "10+";
  /** Pool player without a v2 prior (Marcel prior). */
  ext: boolean;
}
export function buildCheckpoints(priors: Map<string, Prior>, poolPriors: Map<string, Prior>): Ck[] {
  const out: Ck[] = [];
  for (const s of BT_SEASONS) {
    const h = loadSeasonGames(DIR, s);
    const a1 = loadSeasonAggregates(DIR, prevSeason(s, 1));
    const a2 = loadSeasonAggregates(DIR, prevSeason(s, 2));
    // tiers: pre-season Slapshot points rank within the season
    // The population: skaters with a prior who played, and pool players
    // (POOL_PREV_GP games the season before) without one, whatever they
    // played (Marcel prior).
    const pop = new Map<number, { prior: Prior; ext: boolean }>();
    for (const id of h.skaters.keys()) {
      const p = priors.get(`${s}:${id}`);
      if (p) pop.set(id, { prior: p, ext: false });
    }
    for (const [id, x] of a1) {
      if (pop.has(id) || x.gp < POOL_PREV_GP) continue;
      const p = poolPriors.get(`${s}:${id}`);
      if (p) pop.set(id, { prior: p, ext: true });
    }
    const fp: Array<[number, number]> = [...pop].map(([id, { prior: p }]) => [id, pts(SLAPSHOT, p.rates) * p.share * 82]);
    fp.sort((a, b) => b[1] - a[1]);
    const rank = new Map(fp.map(([id], i) => [id, i]));
    // A player with no game that season: any club's schedule (he dresses for none of its games).
    const anyTeam = [...h.teamGames.keys()].sort()[0]!;
    for (const [id, { prior, ext }] of pop) {
      const pl = h.skaters.get(id) ?? { pos: a1.get(id)!.pos, name: "", lines: [] };
      const team = pl.lines[0]?.team ?? anyTeam;
      const tg = h.teamGames.get(team)!;
      const grp = pl.lines.length === 0 ? "0" : pl.lines.length < 10 ? "1-9" : "10+";
      const u = priorUsageOf([a1.get(id), a2.get(id)]);
      const r = rank.get(id)!;
      for (const T of BT_CHECKPOINTS) {
        if (tg.length < T + 5) continue;
        const dT = tg[T - 1]!.date;
        const d0 = tg[0]!.date;
        const to = pl.lines.filter((l) => l.date <= dT);
        const after = pl.lines.filter((l) => l.date > dT);
        // His team's games so far (if traded, his first team's: same count).
        const dates = new Set(to.map((l) => l.date));
        const played = tg.slice(0, T).map((g) => dates.has(g.date));
        if (to.some((l) => l.team !== team)) {
          // traded before T: count his own games as the latest ones
          for (let i = 0; i < played.length; i++) played[i] = i >= played.length - to.length;
        }
        const totals = zero();
        for (const l of to) for (const st of USAGE_STATS) totals[st] += l.s[st];
        const rest = zero();
        for (const l of after) for (const st of USAGE_STATS) rest[st] += l.s[st];
        void d0;
        out.push({
          season: s, key: `${s}:${id}`, pos: pl.pos, T, left: tg.length - T, prior, tier: r < 150 ? 0 : r < 400 ? 1 : 2,
          gp: to.length, totals, played, toi: to.map((l) => l.toi), pp: to.map((l) => l.pp), toiPrior: u.toi, ppPrior: u.pp, rest, restGp: after.length, grp, ext,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- methods
interface Pred {
  rates: Stats;
  games: number;
}
type Method = (c: Ck, usage: Usage) => Pred;
interface NewParams {
  usage: UsageParams;
  rules: Record<UsageStat, StatRule>;
  shootingK: number;
  shareK: number;
  shareHalfLife: number;
  shareToi: number;
  shareSkipAbsence: number;
  shareMissHalfLife: number;
}
const methods = (p: NewParams): Record<string, Method> => ({
  pre: (c) => ({ rates: c.prior.rates, games: c.prior.share * c.left }),
  pace: (c) => ({
    rates: c.gp > 0 ? (Object.fromEntries(USAGE_STATS.map((s) => [s, c.totals[s] / c.gp])) as Stats) : c.prior.rates,
    games: (c.gp / c.T) * c.left,
  }),
  cur: (c) => ({
    rates: Object.fromEntries(USAGE_STATS.map((s) => [s, shrinkRate(c.prior.rates[s], SKATER_RATE_K[s]!, c.totals[s], c.gp)])) as Stats,
    games: updatedGameShare(c.prior.share, c.gp, c.T, SKATER_SHARE_K) * c.left,
  }),
  new: (c, usage) => ({
    rates: restOfSeasonRates({ prior: c.prior.rates, totals: c.totals, gp: c.gp, usage }, p.rules, p.shootingK),
    games: gamesShareNow(c.prior.share, c.played, usage, p.shareK, p.shareHalfLife, p.shareToi, p.shareSkipAbsence, p.shareMissHalfLife) * c.left,
  }),
});
const SHIPPED: NewParams = { usage: { ...USAGE_PARAMS }, rules: { ...STAT_RULES }, shootingK: SHOOTING_K, shareK: SHARE_K, shareHalfLife: SHARE_HALF_LIFE, shareToi: SHARE_TOI_ELASTICITY, shareSkipAbsence: SHARE_SKIP_ABSENCE, shareMissHalfLife: SHARE_MISS_HALF_LIFE };

// ---------------------------------------------------------------- scoring
interface Err {
  slap: number;
  capt: number;
  gp: number;
  cats: Stats; // squared error per stat, total
  rate: Stats; // squared error per stat at the games he played
  rateSlap: number;
}
function errors(c: Ck, pr: Pred): Err {
  const tot = zero();
  const rate = zero();
  const cats = zero();
  const atGames = zero();
  for (const s of USAGE_STATS) {
    tot[s] = pr.rates[s] * pr.games;
    atGames[s] = pr.rates[s] * c.restGp;
    cats[s] = (tot[s] - c.rest[s]) ** 2;
    rate[s] = (atGames[s] - c.rest[s]) ** 2;
  }
  const capt = c.pos === "D" ? CAPTAINS_D : CAPTAINS_F;
  return {
    slap: (pts(SLAPSHOT, tot) - pts(SLAPSHOT, c.rest)) ** 2,
    capt: (pts(capt, tot) - pts(capt, c.rest)) ** 2,
    gp: (pr.games - c.restGp) ** 2,
    cats,
    rate,
    rateSlap: (pts(SLAPSHOT, atGames) - pts(SLAPSHOT, c.rest)) ** 2,
  };
}

const METRICS = ["slapshot", "captains", "ltl", "gp", "slapshotRateOnly", ...USAGE_STATS.map((s) => `rate:${s}`)] as const;
type Metric = (typeof METRICS)[number];
/** Per-checkpoint scalar contributions; LTL needs the SD of each category at T. */
function metricValues(cks: Ck[], errs: Err[], sdByT: Map<number, Stats>): Record<Metric, number[]> {
  const out = Object.fromEntries(METRICS.map((m) => [m, [] as number[]])) as Record<Metric, number[]>;
  cks.forEach((c, i) => {
    const e = errs[i]!;
    out.slapshot.push(e.slap);
    out.captains.push(e.capt);
    out.gp.push(e.gp);
    out.slapshotRateOnly.push(e.rateSlap);
    const sd = sdByT.get(c.T)!;
    out.ltl.push(LTL_CATS.reduce((t, s) => t + e.cats[s] / (sd[s] * sd[s]), 0) / LTL_CATS.length);
    for (const s of USAGE_STATS) out[`rate:${s}` as Metric].push(e.rate[s]);
  });
  return out;
}
const rmseOf = (sq: number[], idx?: number[]) => {
  const ix = idx ?? sq.map((_, i) => i);
  return Math.sqrt(ix.reduce((t, i) => t + sq[i]!, 0) / Math.max(1, ix.length));
};

/** Seeded PRNG (mulberry32) so the error bars are reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 95 % bootstrap interval of RMSE(a) / RMSE(b) − 1 over clusters. */
function bootRatio(a: number[], b: number[], idx: number[], cluster: string[]): [number, number] {
  const groups = new Map<string, number[]>();
  for (const i of idx) {
    const g = groups.get(cluster[i]!) ?? [];
    g.push(i);
    groups.set(cluster[i]!, g);
  }
  const gl = [...groups.values()];
  const sa = gl.map((g) => g.reduce((t, i) => t + a[i]!, 0));
  const sb = gl.map((g) => g.reduce((t, i) => t + b[i]!, 0));
  const r = rng(12345);
  const out: number[] = [];
  for (let k = 0; k < BOOT; k++) {
    let x = 0, y = 0;
    for (let j = 0; j < gl.length; j++) {
      const m = Math.floor(r() * gl.length);
      x += sa[m]!;
      y += sb[m]!;
    }
    out.push(Math.sqrt(x / y) - 1);
  }
  out.sort((p, q) => p - q);
  return [out[Math.floor(0.025 * BOOT)]!, out[Math.floor(0.975 * BOOT)]!];
}

// ---------------------------------------------------------------- tuning
const dressedLast = (c: Ck) => c.played[c.played.length - 1] === true;
const KF = [0.5, 0.75, 1, 1.25, 1.5, 2];
const BETA = [0, 0.25, 0.5, 0.75, 1, 1.25];
const GAMMA = [0, 0.25, 0.5, 0.75, 1];
const SHOOT = [0, 150, 250, 350, 500, 800];
const SHARE_KS = [5, 8, 10, 12, 15, 20, 30];
const SHARE_HLS = [0, 2, 3, 5, 8, 10];
const SHARE_ETAS = [0, 0.25, 0.5, 0.75];
const SHARE_ABSENCES = [0, 3, 6, 10];
const SHARE_MISS = [0, 10, 20, 30, 40, 60, 80];
/** Coordinate search of the usage constants (two passes from the published ones). */
const USAGE_GRID: { [K in keyof UsageParams]: number[] } = {
  toiK: [1, 3, 6, 10],
  toiHalfLife: [0, 5, 10, 20],
  ppK: [2, 5, 10],
  ppHalfLife: [0, 5, 10, 20],
  ppCushion: [0.25, 0.5, 1],
  ratioMin: [0.5, 0.7],
  ratioMax: [1.5, 2],
};
const usageCache = new WeakMap<Ck[], Map<string, Usage[]>>();
function usagesFor(cks: Ck[], p: UsageParams): Usage[] {
  const key = JSON.stringify(p);
  if (!usageCache.has(cks)) usageCache.set(cks, new Map());
  const byKey = usageCache.get(cks)!;
  let u = byKey.get(key);
  if (!u) {
    u = cks.map((c) => usageNow({ toiPrior: c.toiPrior, ppPrior: c.ppPrior, toi: c.toi, pp: c.pp }, p));
    byKey.set(key, u);
  }
  return u;
}
/** Per-stat rules on a grid and the shooting K, at the games he played (pool players with a v2 prior only: the rates are those of the engine). */
function tuneRates(cks: Ck[], usages: Usage[], idx: number[]): { rules: Record<UsageStat, StatRule>; shootingK: number; sse: number } {
  const rules = { ...STAT_RULES } as Record<UsageStat, StatRule>;
  const powT = new Map(BETA.map((b) => [b, idx.map((i) => Math.pow(usages[i]!.toiRatio, b))]));
  const powP = new Map(GAMMA.map((g) => [g, idx.map((i) => Math.pow(usages[i]!.ppRatio, g))]));
  for (const st of USAGE_STATS) {
    let best: [number, StatRule] = [Infinity, rules[st]];
    for (const kf of KF) for (const b of BETA) for (const g of GAMMA) {
      const k = SKATER_RATE_K[st]! * kf;
      const pt = powT.get(b)!;
      const pp = powP.get(g)!;
      let sse = 0;
      for (let j = 0; j < idx.length; j++) {
        const c = cks[idx[j]!]!;
        const prior = c.prior.rates[st] * pt[j]! * pp[j]!;
        sse += (((prior * k + c.totals[st]) / (k + c.gp)) * c.restGp - c.rest[st]) ** 2;
      }
      if (sse < best[0]) best = [sse, { k, toi: b, pp: g }];
    }
    rules[st] = best[1];
  }
  let bestS: [number, number] = [Infinity, 0];
  for (const sk of SHOOT) {
    let sse = 0;
    for (const i of idx) {
      const c = cks[i]!;
      const r = restOfSeasonRates({ prior: c.prior.rates, totals: c.totals, gp: c.gp, usage: usages[i]! }, rules, sk);
      sse += (r.goals * c.restGp - c.rest.goals) ** 2;
    }
    if (sse < bestS[0]) bestS = [sse, sk];
  }
  let sse = 0;
  for (const i of idx) {
    const c = cks[i]!;
    const r = restOfSeasonRates({ prior: c.prior.rates, totals: c.totals, gp: c.gp, usage: usages[i]! }, rules, bestS[1]);
    sse += (pts(SLAPSHOT, r) * c.restGp - pts(SLAPSHOT, c.rest)) ** 2;
  }
  return { rules, shootingK: bestS[1], sse };
}
/**
 * Games-share constants on the games of every checkpoint of the population
 * (those who stopped playing included), under each prior given (the v2
 * walk-forward one and Marcel 5/4/3: the constants must not hold for one
 * prior only). Objective: the WORST ratio of RMSE to the current update
 * (src/lib/in-season.ts, K 30) among the cells of each prior: the groups by
 * games that season (0, 1-9, 10+), the checkpoints, and dressed or not for
 * his team's last game; so neither the regulars nor the players who stopped
 * dressing pay for the other. Ties by the total squared error.
 */
interface ShareSet {
  label: string;
  cks: Ck[];
  usages: Usage[];
  idx: number[];
}
function tuneShare(sets: ShareSet[]) {
  const rows = sets.flatMap((st) => st.idx.map((i) => ({ c: st.cks[i]!, u: st.usages[i]!, label: st.label })));
  const cellsOf = (r: (typeof rows)[number]) => [`${r.label}:g${r.c.grp}`, `${r.label}:T${r.c.T}`, `${r.label}:dl${dressedLast(r.c) ? 1 : 0}`];
  const cells = [...new Set(rows.flatMap(cellsOf))];
  const cellIx = new Map(cells.map((c, j) => [c, j]));
  const ci = rows.map((r) => cellsOf(r).map((c) => cellIx.get(c)!));
  const curSse = new Float64Array(cells.length);
  rows.forEach(({ c }, j) => {
    const e = (updatedGameShare(c.prior.share, c.gp, c.T, SKATER_SHARE_K) * c.left - c.restGp) ** 2;
    for (const x of ci[j]!) curSse[x] += e;
  });
  const clamp1 = (x: number) => Math.min(1, Math.max(0, x));
  let best: { obj: number; tot: number; p: [number, number, number, number, number] } = { obj: Infinity, tot: Infinity, p: [0, 0, 0, 0, 0] };
  const powE = new Map(SHARE_ETAS.map((e) => [e, rows.map((r) => Math.pow(r.u.toiRatio, e))]));
  const sse = new Float64Array(cells.length);
  for (const ab of SHARE_ABSENCES) {
    const kept = rows.map((r) => withoutCompletedAbsences(r.c.played, ab));
    const decay = new Map(SHARE_MISS.map((m) => [m, kept.map((v) => (m > 0 ? Math.pow(0.5, trailingMissed(v) / m) : 1))]));
    for (const hl of SHARE_HLS) {
      // recencyMean(p, v, K, hl) = (p K + Σ w v) / (K + Σ w)
      const sw = new Float64Array(rows.length);
      const swv = new Float64Array(rows.length);
      kept.forEach((v, j) => {
        const n = v.length;
        for (let t = 0; t < n; t++) {
          const w = hl > 0 ? Math.pow(0.5, (n - 1 - t) / hl) : 1;
          sw[j] += w;
          if (v[t]) swv[j] += w;
        }
      });
      for (const k of SHARE_KS) for (const eta of SHARE_ETAS) for (const miss of SHARE_MISS) {
        const pe = powE.get(eta)!;
        const dc = decay.get(miss)!;
        sse.fill(0);
        let tot = 0;
        for (let j = 0; j < rows.length; j++) {
          const c = rows[j]!.c;
          const p0 = clamp1(c.prior.share);
          const share = clamp1(clamp1((p0 * k + swv[j]!) / (k + sw[j]!)) * pe[j]! * dc[j]!);
          const e = (share * c.left - c.restGp) ** 2;
          tot += e;
          for (const x of ci[j]!) sse[x] += e;
        }
        let obj = 0;
        for (let x = 0; x < cells.length; x++) obj = Math.max(obj, curSse[x]! > 0 ? sse[x]! / curSse[x]! : 0);
        if (obj < best.obj - 1e-12 || (Math.abs(obj - best.obj) <= 1e-12 && tot < best.tot)) best = { obj, tot, p: [k, hl, eta, ab, miss] };
      }
    }
  }
  const [shareK, shareHalfLife, shareToi, shareSkipAbsence, shareMissHalfLife] = best.p;
  return { shareK, shareHalfLife, shareToi, shareSkipAbsence, shareMissHalfLife };
}
/** `extra`: other checkpoint sets (the same seasons under another prior) the games-share constants must also hold on. */
function tune(cks: Ck[], seasons: Set<string>, extra: Array<{ label: string; cks: Ck[] }> = []): NewParams {
  const rateIdx = cks.map((_, i) => i).filter((i) => seasons.has(cks[i]!.season) && cks[i]!.restGp > 0 && !cks[i]!.ext);
  let usage: UsageParams = { ...USAGE_PARAMS };
  let fit = tuneRates(cks, usagesFor(cks, usage), rateIdx);
  // --fixed-usage: keep the published usage constants (faster, for exploring the rest).
  for (let pass = 0; pass < (process.argv.includes("--fixed-usage") ? 0 : 2); pass++) {
    let moved = false;
    for (const key of Object.keys(USAGE_GRID) as Array<keyof UsageParams>) {
      for (const v of USAGE_GRID[key]) {
        if (v === usage[key]) continue;
        const cand = { ...usage, [key]: v };
        if (cand.ratioMin >= 1 || cand.ratioMax <= 1) continue;
        const f = tuneRates(cks, usagesFor(cks, cand), rateIdx);
        if (f.sse < fit.sse * (1 - 1e-6)) {
          usage = cand;
          fit = f;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  const set = (label: string, x: Ck[]): ShareSet => ({ label, cks: x, usages: usagesFor(x, usage), idx: x.map((_, i) => i).filter((i) => seasons.has(x[i]!.season)) });
  return { usage, rules: fit.rules, shootingK: fit.shootingK, ...tuneShare([set(PRIORS ? "v2" : "marcel", cks), ...extra.map((e) => set(e.label, e.cks))]) };
}

// ---------------------------------------------------------------- CI fixture
/** Every FIXTURE_EVERY-th player-season at FIXTURE_CHECKPOINTS, scored with the code's constants (scripts/in-season-fixture.ts). */
function writeFixture(cks: Ck[]) {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
  const keys = [...new Set(cks.map((c) => c.key))].sort().filter((_, i) => i % FIXTURE_EVERY === 0);
  const players: FixturePlayer[] = [];
  for (const key of keys) {
    const mine = cks.filter((c) => c.key === key && FIXTURE_CHECKPOINTS.includes(c.T)).sort((a, b) => a.T - b.T);
    if (mine.length === 0) continue;
    const last = mine[mine.length - 1]!;
    const c0 = mine[0]!;
    players.push({
      key,
      prior: USAGE_STATS.map((s) => r4(c0.prior.rates[s])),
      share: r4(c0.prior.share),
      toiPrior: c0.toiPrior == null ? null : r2(c0.toiPrior),
      ppPrior: c0.ppPrior == null ? null : r2(c0.ppPrior),
      toi: last.toi.map(r2),
      pp: last.pp.map(r2),
      cks: mine.map((c) => ({ T: c.T, left: c.left, gp: c.gp, played: c.played.map((x) => (x ? "1" : "0")).join(""), tot: USAGE_STATS.map((s) => c.totals[s]), rest: USAGE_STATS.map((s) => c.rest[s]), restGp: c.restGp })),
    });
  }
  const sc = scoreFixture(players);
  const r4e = (x: number) => Math.round(x * 1e4) / 1e4;
  const fixture: Fixture = {
    stats: USAGE_STATS,
    players,
    expected: { cur: r4e(sc.cur), new: r4e(sc.new), gpCur: r4e(sc.gpCur), gpNew: r4e(sc.gpNew), absentGpCur: r4e(sc.absentGpCur), absentGpNew: r4e(sc.absentGpNew) },
  };
  const path = join(process.cwd(), "src", "data", "ml", "in-season-fixture.json");
  writeFileAtomic(path, `${JSON.stringify(fixture)}\n`);
  console.log(`wrote ${path}: ${players.length} player-seasons, ${sc.n} checkpoints, Slapshot ROS RMSE cur ${sc.cur.toFixed(2)} → new ${sc.new.toFixed(2)}, games ${sc.gpCur.toFixed(2)} → ${sc.gpNew.toFixed(2)}, under-10-game player-seasons (${sc.absentN} checkpoints) ${sc.absentGpCur.toFixed(2)} → ${sc.absentGpNew.toFixed(2)}`);
}

// ---------------------------------------------------------------- main
function main() {
  const t0 = Date.now();
  const marcel = marcelPriors(BT_SEASONS);
  const priors = PRIORS ? v2Priors(PRIORS) : marcel;
  const cks = buildCheckpoints(priors, marcel);
  const byGrp = (g: Ck["grp"]) => new Set(cks.filter((c) => c.grp === g).map((c) => c.key)).size;
  console.log(
    `${cks.length} checkpoints (${new Set(cks.map((c) => c.key)).size} player-seasons: ${byGrp("10+")} with 10+ games, ${byGrp("1-9")} with 1-9, ${byGrp("0")} with none; ${new Set(cks.filter((c) => c.ext).map((c) => c.key)).size} pool players on the Marcel prior), priors ${PRIORS ? "v2 walk-forward" : "Marcel"}, ${((Date.now() - t0) / 1000).toFixed(0)} s`,
  );

  let params = SHIPPED;
  const loso: Record<string, { cur: number; new: number; gpCur: number; gpNew: number; params: NewParams }> = {};
  if (TUNE) {
    // The games-share constants must also hold under the Marcel prior.
    const extra = PRIORS ? [{ label: "marcel", cks: buildCheckpoints(marcel, marcel) }] : [];
    params = tune(cks, new Set(BT_SEASONS), extra);
    console.log("tuned on all seasons:", JSON.stringify(params), `${((Date.now() - t0) / 1000).toFixed(0)} s`);
    for (const h of BT_SEASONS) {
      const p = tune(cks, new Set(BT_SEASONS.filter((s) => s !== h)), extra);
      const u = usagesFor(cks, p.usage);
      const m = methods(p);
      const idx = cks.map((_, i) => i).filter((i) => cks[i]!.season === h);
      let sc = 0, sn = 0, gc = 0, gn = 0;
      for (const i of idx) {
        const ec = errors(cks[i]!, m.cur!(cks[i]!, u[i]!));
        const en = errors(cks[i]!, m.new!(cks[i]!, u[i]!));
        sc += ec.slap;
        sn += en.slap;
        gc += ec.gp;
        gn += en.gp;
      }
      const r = (x: number) => Math.sqrt(x / idx.length);
      loso[h] = { cur: r(sc), new: r(sn), gpCur: r(gc), gpNew: r(gn), params: p };
      console.log(
        `LOSO ${h}: Slapshot ROS RMSE cur ${r(sc).toFixed(2)} → new ${r(sn).toFixed(2)} (${(100 * (r(sn) / r(sc) - 1)).toFixed(2)} %), games ${r(gc).toFixed(2)} → ${r(gn).toFixed(2)} (${(100 * (r(gn) / r(gc) - 1)).toFixed(2)} %) with ${JSON.stringify(p)}`,
      );
    }
  }
  const usages = usagesFor(cks, params.usage);

  const M = methods(params);
  const names = ["pre", "pace", "cur", "new"] as const;
  const errs = Object.fromEntries(names.map((n) => [n, cks.map((c, i) => errors(c, M[n]!(c, usages[i]!)))])) as Record<(typeof names)[number], Err[]>;
  const sdByT = new Map<number, Stats>();
  for (const T of BT_CHECKPOINTS) {
    const set = cks.filter((c) => c.T === T);
    const sd = zero();
    for (const s of USAGE_STATS) {
      const m = set.reduce((t, c) => t + c.rest[s], 0) / set.length;
      sd[s] = Math.sqrt(set.reduce((t, c) => t + (c.rest[s] - m) ** 2, 0) / set.length) || 1;
    }
    sdByT.set(T, sd);
  }
  const vals = Object.fromEntries(names.map((n) => [n, metricValues(cks, errs[n], sdByT)])) as Record<(typeof names)[number], Record<Metric, number[]>>;
  const cluster = cks.map((c) => c.key);
  const rateIdx = (idx: number[]) => idx.filter((i) => cks[i]!.restGp > 0);

  type Cell = { n: number; pre: number; pace: number; cur: number; new: number; vsCur: number; ci: [number, number]; seasonsWon: number };
  const cell = (metric: Metric, idx0: number[]): Cell => {
    const idx = metric.startsWith("rate") || metric === "slapshotRateOnly" ? rateIdx(idx0) : idx0;
    const r = Object.fromEntries(names.map((n) => [n, rmseOf(vals[n][metric], idx)])) as Record<(typeof names)[number], number>;
    let won = 0;
    for (const s of BT_SEASONS) {
      const si = idx.filter((i) => cks[i]!.season === s);
      if (rmseOf(vals.new[metric], si) < rmseOf(vals.cur[metric], si)) won++;
    }
    const ci = bootRatio(vals.new[metric], vals.cur[metric], idx, cluster);
    const f = (x: number) => Math.round(x * 1000) / 1000;
    return { n: idx.length, pre: f(r.pre), pace: f(r.pace), cur: f(r.cur), new: f(r.new), vsCur: f(100 * (r.new / r.cur - 1)), ci: [f(100 * ci[0]), f(100 * ci[1])], seasonsWon: won };
  };
  const all = cks.map((_, i) => i);
  const byT = (T: number) => all.filter((i) => cks[i]!.T === T);
  const summary: Record<string, Record<string, Cell>> = {};
  for (const metric of METRICS) {
    summary[metric] = { all: cell(metric, all) };
    for (const T of BT_CHECKPOINTS) summary[metric]![`T${T}`] = cell(metric, byT(T));
  }
  // By games played that whole season (the population includes the pool
  // players who barely or never played).
  for (const g of ["0", "1-9", "10+"] as const) {
    for (const metric of ["gp", "slapshot", "captains"] as const) {
      const key = `${metric}:gp${g}`;
      const sel = all.filter((i) => cks[i]!.grp === g);
      summary[key] = { all: cell(metric, sel) };
      for (const T of BT_CHECKPOINTS) summary[key]![`T${T}`] = cell(metric, sel.filter((i) => cks[i]!.T === T));
    }
  }
  // Dressed for his team's last game (the share alone drives his games in the
  // live update) or not (live: the injury report, or the share if unlisted).
  for (const [name, f] of [["dressedLast", true], ["outLast", false]] as const) {
    summary[`gp:${name}`] = { all: cell("gp", all.filter((i) => dressedLast(cks[i]!) === f)) };
    summary[`slapshot:${name}`] = { all: cell("slapshot", all.filter((i) => dressedLast(cks[i]!) === f)) };
    for (const T of BT_CHECKPOINTS) summary[`gp:${name}`]![`T${T}`] = cell("gp", byT(T).filter((i) => dressedLast(cks[i]!) === f));
  }
  const tiers: Record<string, Record<string, Cell>> = {};
  for (const [tier, name] of [[0, "top150"], [1, "151-400"], [2, "401+"]] as const) {
    tiers[name] = {};
    for (const metric of ["slapshot", "captains", "ltl", "gp", "slapshotRateOnly"] as const) tiers[name]![metric] = cell(metric, all.filter((i) => cks[i]!.tier === tier));
  }

  const line = (label: string, c: Cell) =>
    `${label.padEnd(22)} n=${String(c.n).padStart(5)}  pre ${c.pre.toFixed(2).padStart(7)}  pace ${c.pace.toFixed(2).padStart(7)}  cur ${c.cur.toFixed(2).padStart(7)}  new ${c.new.toFixed(2).padStart(7)}  new/cur ${c.vsCur >= 0 ? "+" : ""}${c.vsCur.toFixed(2)} % [${c.ci[0].toFixed(2)}, ${c.ci[1].toFixed(2)}]  seasons ${c.seasonsWon}/5`;
  for (const metric of Object.keys(summary)) {
    console.log(`\n== ${metric} (rest-of-season RMSE)`);
    console.log(line("all checkpoints", summary[metric]!.all!));
    for (const T of BT_CHECKPOINTS) if (summary[metric]![`T${T}`]) console.log(line(`after team game ${T}`, summary[metric]![`T${T}`]!));
  }
  console.log("\n== by tier of pre-season Slapshot points");
  for (const [name, t] of Object.entries(tiers)) for (const [metric, c] of Object.entries(t)) console.log(line(`${name} ${metric}`, c));

  if (WRITE) {
    const out = {
      generatedAt: new Date().toISOString(),
      generatedBy: "scripts/backtest-in-season.ts",
      priors: PRIORS ? "v2-walk-forward" : "marcel",
      seasons: BT_SEASONS,
      checkpoints: BT_CHECKPOINTS,
      playerSeasons: new Set(cks.map((c) => c.key)).size,
      population: { poolPrevGp: POOL_PREV_GP, checkpoints: cks.length, playerSeasons: { "0": byGrp("0"), "1-9": byGrp("1-9"), "10+": byGrp("10+") }, marcelPool: new Set(cks.filter((c) => c.ext).map((c) => c.key)).size },
      params: { usage: params.usage, rules: params.rules, shootingK: params.shootingK, shareK: params.shareK, shareHalfLife: params.shareHalfLife, shareToi: params.shareToi, shareSkipAbsence: params.shareSkipAbsence, shareMissHalfLife: params.shareMissHalfLife },
      current: { rateK: SKATER_RATE_K, shareK: SKATER_SHARE_K },
      summary,
      tiers,
      loso,
    };
    const path = join(process.cwd(), "src", "data", "ml", `in-season-backtest${PRIORS ? "" : "-marcel"}.json`);
    writeFileAtomic(path, `${JSON.stringify(out, null, 1)}\n`);
    console.log(`\nwrote ${path}`);
    if (PRIORS) writeFixture(cks);
  }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

// Run as a script (the explorers in scratch import its checkpoints).
if (/backtest-in-season\.ts$/.test(process.argv[1] ?? "")) main();
