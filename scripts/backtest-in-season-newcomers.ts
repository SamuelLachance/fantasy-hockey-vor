/**
 * Backtest of the newcomer prior of the daily in-season update: a skater
 * with NHL games this season and no pre-season projection (here: no NHL game
 * in the three seasons before, 2021-22 → 2025-26).
 *
 * After his team's T-th game (T = 5 … 70, at least one game of his), his rest
 * of season is projected
 * - `cur`: flat first-season prior per 82 games (F / D), K 10, games share
 *   0.4 of his team's games since his debut, K 10 (src/lib/in-season.ts);
 * - `new`: role-based prior (src/lib/inseason/newcomer.ts): rates and games
 *   share as lines in his recency-weighted ice time and PP time, the lines
 *   fit on the OTHER four seasons (leave-one-season-out), K NEWCOMER_USAGE_K;
 * - `pace`: his rates and share so far.
 * Scored on Slapshot and Captains points, games, and Slapshot points at the
 * games he played; error bars by bootstrap over player-seasons.
 * `--write` stores src/data/ml/in-season-newcomer-backtest.json with the
 * lines fit on all five seasons (the published constants must match them,
 * scripts/test-in-season.ts).
 *
 * Run: npx tsx scripts/backtest-in-season-newcomers.ts --cache=<dir> [--write]
 */
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { NEWCOMER_PER82, NEWCOMER_RATE_K, NEWCOMER_SHARE_K, NEWCOMER_SHARE_PRIOR, shrinkRate, updatedGameShare } from "../src/lib/in-season";
import { NEWCOMER_USAGE_K, newcomerRates, newcomerShare } from "../src/lib/inseason/newcomer";
import { USAGE_PARAMS, USAGE_STATS, usageNow, type UsageStat } from "../src/lib/inseason/skater";
import { DEFAULT_CACHE } from "./fetch-in-season-history";
import { loadSeasonAggregates, loadSeasonGames, prevSeason } from "./in-season-history";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const DIR = arg("cache") ?? process.env.IN_SEASON_CACHE ?? DEFAULT_CACHE;
const WRITE = process.argv.includes("--write");
const SEASONS = ["20212022", "20222023", "20232024", "20242025", "20252026"];
const CHECKPOINTS = [5, 10, 15, 20, 30, 40, 50, 60, 70];
const BOOT = Number(arg("boot") ?? 400);
type Stats = Record<UsageStat, number>;
const SLAP: Partial<Stats> = { goals: 3.5, assists: 2.5, powerplayPoints: 0.5, shots: 0.25, hits: 0.15, blocks: 0.3 };
const CAPT_F: Partial<Stats> = { goals: 3, assists: 2, shots: 0.4, hits: 0.3 };
const CAPT_D: Partial<Stats> = { ...CAPT_F, blocks: 0.3 };
const pts = (w: Partial<Stats>, x: Stats) => Object.entries(w).reduce((t, [k, v]) => t + (v as number) * x[k as UsageStat], 0);

interface Ck {
  season: string;
  key: string;
  pos: "F" | "D";
  T: number;
  left: number;
  gp: number;
  since: number;
  toi: number;
  pp: number;
  totals: Stats;
  rest: Stats;
  restGp: number;
}
function checkpoints(): Ck[] {
  const out: Ck[] = [];
  for (const s of SEASONS) {
    const h = loadSeasonGames(DIR, s);
    const prev = [1, 2, 3].map((k) => loadSeasonAggregates(DIR, prevSeason(s, k)));
    for (const [id, p] of h.skaters) {
      if (prev.some((a) => (a.get(id)?.gp ?? 0) > 0)) continue;
      const team = p.lines[0]!.team;
      const tg = h.teamGames.get(team)!;
      const debut = tg.findIndex((g) => g.date >= p.lines[0]!.date);
      for (const T of CHECKPOINTS) {
        if (tg.length < T + 5) continue;
        const dT = tg[T - 1]!.date;
        const to = p.lines.filter((l) => l.date <= dT);
        if (!to.length) continue;
        const after = p.lines.filter((l) => l.date > dT);
        const totals = {} as Stats;
        const rest = {} as Stats;
        for (const st of USAGE_STATS) {
          totals[st] = to.reduce((t, l) => t + l.s[st], 0);
          rest[st] = after.reduce((t, l) => t + l.s[st], 0);
        }
        const u = usageNow({ toiPrior: null, ppPrior: null, toi: to.map((l) => l.toi), pp: to.map((l) => l.pp) }, USAGE_PARAMS);
        out.push({
          season: s, key: `${s}:${id}`, pos: p.pos, T, left: tg.length - T, gp: to.length, since: Math.max(to.length, T - Math.max(0, debut)),
          toi: u.toi ?? 0, pp: u.pp ?? 0, totals, rest, restGp: after.length,
        });
      }
    }
  }
  return out;
}

/** Weighted least squares of the rest-of-season per-game rate (weight: games) on [1, ice time, PP time]. */
function fitLines(train: Ck[]) {
  const solve = (A: number[][], b: number[]) => {
    const n = b.length;
    const M = A.map((r, i) => [...r, b[i]!]);
    for (let i = 0; i < n; i++) {
      M[i]![i]! += 1e-9;
      let p = i;
      for (let k = i + 1; k < n; k++) if (Math.abs(M[k]![i]!) > Math.abs(M[p]![i]!)) p = k;
      [M[i], M[p]] = [M[p]!, M[i]!];
      for (let k = 0; k < n; k++) if (k !== i) {
        const f = M[k]![i]! / M[i]![i]!;
        for (let j = i; j <= n; j++) M[k]![j]! -= f * M[i]![j]!;
      }
    }
    return M.map((r, i) => r[n]! / r[i]!);
  };
  const r4 = (x: number) => Math.round(x * 1e5) / 1e5;
  const rates = {} as Record<"F" | "D", Record<UsageStat, [number, number, number]>>;
  const share = {} as Record<"F" | "D", [number, number]>;
  for (const pos of ["F", "D"] as const) {
    rates[pos] = {} as Record<UsageStat, [number, number, number]>;
    const set = train.filter((c) => c.pos === pos);
    for (const st of USAGE_STATS) {
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      const b = [0, 0, 0];
      for (const c of set) {
        if (!(c.restGp > 0)) continue;
        const x = [1, c.toi, c.pp];
        const y = c.rest[st] / c.restGp;
        for (let j = 0; j < 3; j++) {
          b[j]! += c.restGp * x[j]! * y;
          for (let k = 0; k < 3; k++) A[j]![k]! += c.restGp * x[j]! * x[k]!;
        }
      }
      const [a, bb, cc] = solve(A, b);
      rates[pos][st] = [r4(a!), r4(bb!), r4(cc!)];
    }
    const A = [[0, 0], [0, 0]];
    const b = [0, 0];
    for (const c of set) {
      const x = [1, c.toi];
      const y = c.restGp / c.left;
      for (let j = 0; j < 2; j++) {
        b[j]! += c.left * x[j]! * y;
        for (let k = 0; k < 2; k++) A[j]![k]! += c.left * x[j]! * x[k]!;
      }
    }
    const [a, bb] = solve(A, b);
    share[pos] = [r4(a!), r4(bb!)];
  }
  return { rates, share };
}

interface Pred { rates: Stats; games: number }
function predict(c: Ck, method: "cur" | "new" | "pace" | "newShareOnly" | "newRatesOnly", lines?: ReturnType<typeof fitLines>): Pred {
  if (method === "newShareOnly") return { rates: predict(c, "cur").rates, games: predict(c, "new", lines).games };
  if (method === "newRatesOnly") return { rates: predict(c, "new", lines).rates, games: predict(c, "cur").games };
  if (method === "pace") return { rates: Object.fromEntries(USAGE_STATS.map((s) => [s, c.totals[s] / c.gp])) as Stats, games: (c.gp / c.since) * c.left };
  if (method === "cur") {
    const rates = {} as Stats;
    for (const st of USAGE_STATS) rates[st] = shrinkRate(NEWCOMER_PER82[c.pos][st]! / 82, NEWCOMER_RATE_K, c.totals[st], c.gp);
    return { rates, games: updatedGameShare(NEWCOMER_SHARE_PRIOR, c.gp, c.since, NEWCOMER_SHARE_K) * c.left };
  }
  const prior = newcomerRates(c.pos, c.toi, c.pp, lines?.rates);
  const rates = {} as Stats;
  for (const st of USAGE_STATS) rates[st] = shrinkRate(prior[st], NEWCOMER_USAGE_K, c.totals[st], c.gp);
  return { rates, games: updatedGameShare(newcomerShare(c.pos, c.toi, lines?.share), c.gp, c.since, NEWCOMER_SHARE_K) * c.left };
}
function sq(c: Ck, p: Pred) {
  const tot = {} as Stats, at = {} as Stats;
  for (const s of USAGE_STATS) { tot[s] = p.rates[s] * p.games; at[s] = p.rates[s] * c.restGp; }
  const capt = c.pos === "D" ? CAPT_D : CAPT_F;
  return {
    slapshot: (pts(SLAP, tot) - pts(SLAP, c.rest)) ** 2,
    captains: (pts(capt, tot) - pts(capt, c.rest)) ** 2,
    gp: (p.games - c.restGp) ** 2,
    slapshotRateOnly: (pts(SLAP, at) - pts(SLAP, c.rest)) ** 2,
  };
}
type Metric = keyof ReturnType<typeof sq>;
const METRICS: Metric[] = ["slapshot", "captains", "gp", "slapshotRateOnly"];

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function main() {
  const cks = checkpoints();
  console.log(`${cks.length} newcomer checkpoints (${new Set(cks.map((c) => c.key)).size} first NHL seasons)`);
  // leave-one-season-out: the lines of season s are fit on the other four
  const errs = { pace: [] as ReturnType<typeof sq>[], cur: [] as ReturnType<typeof sq>[], new: [] as ReturnType<typeof sq>[] };
  const order: Ck[] = [];
  for (const h of SEASONS) {
    const lines = fitLines(cks.filter((c) => c.season !== h));
    for (const c of cks.filter((x) => x.season === h)) {
      order.push(c);
      errs.pace.push(sq(c, predict(c, "pace")));
      errs.cur.push(sq(c, predict(c, "cur")));
      errs.new.push(sq(c, predict(c, "new", lines)));
    }
  }
  type Cell = { n: number; pace: number; cur: number; new: number; vsCur: number; ci: [number, number]; seasonsWon: number };
  const cell = (m: Metric, idx0: number[]): Cell => {
    const idx = m === "slapshotRateOnly" ? idx0.filter((i) => order[i]!.restGp > 0) : idx0;
    const r = (k: "pace" | "cur" | "new", ix: number[]) => Math.sqrt(ix.reduce((t, i) => t + errs[k][i]![m], 0) / Math.max(1, ix.length));
    let won = 0;
    for (const s of SEASONS) { const si = idx.filter((i) => order[i]!.season === s); if (r("new", si) < r("cur", si)) won++; }
    const groups = new Map<string, number[]>();
    for (const i of idx) { const g = groups.get(order[i]!.key) ?? []; g.push(i); groups.set(order[i]!.key, g); }
    const gl = [...groups.values()];
    const a = gl.map((g) => g.reduce((t, i) => t + errs.new[i]![m], 0)), b = gl.map((g) => g.reduce((t, i) => t + errs.cur[i]![m], 0));
    const rand = rng(99);
    const bs: number[] = [];
    for (let k = 0; k < BOOT; k++) { let x = 0, y = 0; for (let j = 0; j < gl.length; j++) { const q = Math.floor(rand() * gl.length); x += a[q]!; y += b[q]!; } bs.push(Math.sqrt(x / y) - 1); }
    bs.sort((p, q) => p - q);
    const f = (x: number) => Math.round(x * 1000) / 1000;
    return { n: idx.length, pace: f(r("pace", idx)), cur: f(r("cur", idx)), new: f(r("new", idx)), vsCur: f(100 * (r("new", idx) / r("cur", idx) - 1)), ci: [f(100 * bs[Math.floor(0.025 * BOOT)]!), f(100 * bs[Math.floor(0.975 * BOOT)]!)], seasonsWon: won };
  };
  const all = order.map((_, i) => i);
  const summary: Record<string, Record<string, Cell>> = {};
  for (const m of METRICS) {
    summary[m] = { all: cell(m, all) };
    for (const T of CHECKPOINTS) summary[m]![`T${T}`] = cell(m, all.filter((i) => order[i]!.T === T));
  }
  const line = (label: string, c: Cell) =>
    `${label.padEnd(22)} n=${String(c.n).padStart(5)}  pace ${c.pace.toFixed(2).padStart(7)}  cur ${c.cur.toFixed(2).padStart(7)}  new ${c.new.toFixed(2).padStart(7)}  new/cur ${c.vsCur >= 0 ? "+" : ""}${c.vsCur.toFixed(2)} % [${c.ci[0].toFixed(2)}, ${c.ci[1].toFixed(2)}]  seasons ${c.seasonsWon}/5`;
  for (const m of METRICS) {
    console.log(`\n== newcomers ${m} (rest-of-season RMSE, lines fit leave-one-season-out)`);
    console.log(line("all checkpoints", summary[m]!.all!));
    for (const T of CHECKPOINTS) console.log(line(`after team game ${T}`, summary[m]![`T${T}`]!));
  }
  // the two halves alone (Slapshot, per season)
  const halves: Record<string, number[]> = {};
  for (const v of ["newShareOnly", "newRatesOnly"] as const) {
    halves[v] = SEASONS.map((h) => {
      const ln = fitLines(cks.filter((c) => c.season !== h));
      const ix = cks.filter((c) => c.season === h);
      const e = (m: "cur" | typeof v) => Math.sqrt(ix.reduce((t, c) => t + sq(c, predict(c, m, ln)).slapshot, 0) / ix.length);
      return Math.round(1000 * 100 * (e(v) / e("cur") - 1)) / 1000;
    });
    console.log(`${v}: Slapshot ROS RMSE vs cur per season ${halves[v]!.map((x) => x.toFixed(2)).join(" ")} %`);
  }
  const lines = fitLines(cks);
  console.log("\nlines fit on all seasons:", JSON.stringify(lines));
  if (WRITE) {
    const path = join(process.cwd(), "src", "data", "ml", "in-season-newcomer-backtest.json");
    writeFileAtomic(path, `${JSON.stringify({ generatedAt: new Date().toISOString(), generatedBy: "scripts/backtest-in-season-newcomers.ts", seasons: SEASONS, checkpoints: CHECKPOINTS, playerSeasons: new Set(cks.map((c) => c.key)).size, k: NEWCOMER_USAGE_K, lines, summary }, null, 1)}\n`);
    console.log(`wrote ${path}`);
  }
}

main();
