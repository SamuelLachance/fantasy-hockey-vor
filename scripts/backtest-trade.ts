/**
 * Walk-forward backtest of the trade evaluator's season accounting
 * (src/lib/trade/team-value.ts `lineupPoints`) on real NHL seasons, in a
 * Slapshot-shaped league: 32 teams, Slapshot scoring (G 3.5, A 2.5, PPP 0.5,
 * SOG 0.25, Hit 0.15, SB 0.3; goalie W 3, GA −1, SV 0.25, SHO 5), C4 LW4 RW4
 * D6 G2 + 3 reserves, daily lineups.
 *
 * Each test season: leagues drafted from Marcel projections (prior three
 * seasons, 5/4/3, regressed); random trades between random teams (1-for-1,
 * 2-for-1, 1-for-2, 2-for-2), kept when they look balanced on paper (the
 * two sides' projected points within ±25 %: the trades where judgment
 * matters). For the receiving team « a », each trade is predicted by:
 *
 *   naive   Σ projected points received − Σ sent (what a human adds up);
 *   tool    the change in the best lineup's projected points (`lineupPoints`:
 *           seats, every other active player at the bench share, the roster
 *           limit);
 *
 * and scored against the TRUTH: the team's real season, replayed day by day
 * from the box scores — every day the players who dressed, seated by
 * projected points per game (the manager's daily lineup), the seated ones'
 * real fantasy points — after the trade minus before.
 *
 * The bench shares (skaters, goalies) are fitted on the trades of the FIRST
 * season only (the grid point whose predictions rank the real outcomes best;
 * the scored seasons never see it). Error bars: 95 % bootstrap over trades,
 * paired for tool - naive.
 *
 * Writes src/data/trade/backtest-summary.json (committed; checked by
 * scripts/test-trade.ts).
 *
 * Usage: npx tsx scripts/backtest-trade.ts [--cache <dir>] [--leagues 2] [--trades 1500]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { parseArgs } from "util";
import { hashStr, mulberry32 } from "../src/lib/dynasty/rng";
import { fillSlots, type SlotSpec } from "../src/lib/leagues/slot-fill";
import { lineupPoints, type LineupRules, type TeamPlayer } from "../src/lib/trade/team-value";
import { TRADE_BENCH } from "../src/lib/trade/params";

const { values: args } = parseArgs({
  options: {
    cache: { type: "string" },
    leagues: { type: "string", default: "2" },
    trades: { type: "string", default: "1500" },
    out: { type: "string", default: join(process.cwd(), "src", "data", "trade", "backtest-summary.json") },
  },
});
const CACHE = args.cache ?? process.env.NHL_STATS_CACHE ?? join(process.cwd(), ".cache", "nhl-stats");
const SEASONS = [20222023, 20232024, 20242025, 20252026];
const FIT_SEASON = SEASONS[0]!;

type SkG = [number, string, string, string, string, number, number, number, number, number, number, number];
type GkG = [number, string, string, string, number, number, number, number, number, number];
type SkS = [number, string, number, number, number, number, number, number, number, number];
type GkS = [number, number, number, number, number, number, number, number];
const load = <T,>(f: string): T => {
  const p = join(CACHE, f);
  if (!existsSync(p)) throw new Error(`missing ${p}: run scripts/fetch-nhl-game-logs.ts first`);
  return JSON.parse(readFileSync(p, "utf8")) as T;
};
const prev = (s: number) => {
  const y = Math.floor(s / 10000);
  return (y - 1) * 10000 + y;
};
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const POS: Record<string, string> = { C: "C", L: "LW", R: "RW", D: "D" };

/** Slapshot points of a skater line (G A PPP SOG HIT BLK) and of a goalie start (W GA SA SHO). */
const skFp = (g: number, a: number, ppp: number, sog: number, hit: number, blk: number) => 3.5 * g + 2.5 * a + 0.5 * ppp + 0.25 * sog + 0.15 * hit + 0.3 * blk;
const gkFp = (w: number, ga: number, sa: number, sho: number) => 3 * w - ga + 0.25 * (sa - ga) + 5 * sho;

const SEATS: SlotSpec<string>[] = [
  { slot: "C", capacity: 4, accepts: ["C"] },
  { slot: "LW", capacity: 4, accepts: ["LW"] },
  { slot: "RW", capacity: 4, accepts: ["RW"] },
  { slot: "D", capacity: 6, accepts: ["D"] },
  { slot: "G", capacity: 2, accepts: ["G"] },
];
const ROSTER = 23;

interface Proj {
  id: number;
  pos: string;
  goalie: boolean;
  /** Projected season points and per game (per start for goalies). */
  fp: number;
  fpg: number;
}

function marcel(season: number): Map<number, Proj> {
  const prior = [prev(season), prev(prev(season)), prev(prev(prev(season)))];
  const W = [5, 4, 3];
  const files = prior.map((s) => load<{ skaters: SkS[]; goalies: GkS[] }>(`totals-${s}.json`));
  const sk = new Map<number, { pos: string; gp: number; fp: number; w: number }>();
  files.forEach((f, i) => {
    for (const r of f.skaters) {
      const a = sk.get(r[0]) ?? { pos: r[1], gp: 0, fp: 0, w: 0 };
      a.gp += W[i]! * r[2];
      a.fp += W[i]! * skFp(r[3], r[4], r[5], r[6], r[7], r[8]);
      a.w += W[i]!;
      sk.set(r[0], a);
    }
  });
  const out = new Map<number, Proj>();
  const all = [...sk.values()];
  const meanF = sum(all.filter((a) => a.pos !== "D").map((a) => a.fp)) / sum(all.filter((a) => a.pos !== "D").map((a) => a.gp));
  const meanD = sum(all.filter((a) => a.pos === "D").map((a) => a.fp)) / sum(all.filter((a) => a.pos === "D").map((a) => a.gp));
  for (const [id, a] of sk) {
    if (!POS[a.pos]) continue;
    const m = a.pos === "D" ? meanD : meanF;
    const K = 60;
    const fpg = (a.fp + K * m * 0.8) / (a.gp + K);
    const gp = Math.min(82, (a.gp / a.w) * 0.95);
    out.set(id, { id, pos: POS[a.pos]!, goalie: false, fp: fpg * gp, fpg });
  }
  const gk = new Map<number, { gs: number; fp: number; w: number }>();
  files.forEach((f, i) => {
    for (const r of f.goalies) {
      const a = gk.get(r[0]) ?? { gs: 0, fp: 0, w: 0 };
      a.gs += W[i]! * r[2];
      a.fp += W[i]! * gkFp(r[3], r[4], r[5], r[6]);
      a.w += W[i]!;
      gk.set(r[0], a);
    }
  });
  const gall = [...gk.values()];
  const gm = sum(gall.map((a) => a.fp)) / sum(gall.map((a) => a.gs));
  for (const [id, a] of gk) {
    const K = 40;
    const fpg = (a.fp + K * gm * 0.9) / (a.gs + K);
    const gs = Math.min(65, (a.gs / a.w) * 0.95);
    out.set(id, { id, pos: "G", goalie: true, fp: fpg * gs, fpg });
  }
  return out;
}

interface Days {
  dates: string[];
  sk: Map<string, Map<number, number>>; // date -> id -> fp
  gk: Map<string, Map<number, number>>; // date -> id -> fp (starts only)
}
function seasonDays(season: number): Days {
  const g = load<{ skaters: SkG[]; goalies: GkG[] }>(`games-${season}.json`);
  const sk = new Map<string, Map<number, number>>();
  const gk = new Map<string, Map<number, number>>();
  for (const r of g.skaters) (sk.get(r[1]) ?? sk.set(r[1], new Map()).get(r[1])!).set(r[0], skFp(r[5], r[6], r[7], r[8], r[9], r[10]));
  for (const r of g.goalies) if (r[4] === 1) (gk.get(r[1]) ?? gk.set(r[1], new Map()).get(r[1])!).set(r[0], gkFp(r[5], r[6], r[7], r[8]));
  return { dates: [...sk.keys()].sort(), sk, gk };
}

/** The truth: a roster's real season, day by day (dressed players seated by projected points per game). */
function realSeason(ids: readonly number[], proj: Map<number, Proj>, days: Days): number {
  const ps = ids.map((id) => proj.get(id)!).filter(Boolean).sort((a, b) => b.fpg - a.fpg || a.id - b.id);
  const sk = ps.filter((p) => !p.goalie);
  const gk = ps.filter((p) => p.goalie);
  let tot = 0;
  for (const d of days.dates) {
    const rows = days.sk.get(d)!;
    const dressed = sk.filter((p) => rows.has(p.id));
    if (dressed.length) {
      const fill = fillSlots<number, { id: number; positions: readonly string[] }, string>(
        dressed.map((p) => ({ id: p.id, positions: [p.pos] })),
        SEATS,
      );
      for (const id of fill.slotOf.keys()) tot += rows.get(id)!;
    }
    const g = days.gk.get(d);
    if (g) {
      let n = 0;
      for (const p of gk) {
        if (n >= 2) break;
        const x = g.get(p.id);
        if (x != null) {
          tot += x;
          n++;
        }
      }
    }
  }
  return tot;
}

function draft(proj: Map<number, Proj>, seed: string): number[][] {
  const rng = mulberry32(hashStr(seed));
  const items = [...proj.values()].map((p) => ({ p, v: p.fp * (1 + 0.15 * rng.n()) })).sort((a, b) => b.v - a.v);
  const teams: number[][] = Array.from({ length: 32 }, () => []);
  const need = (t: number[]) => {
    const c: Record<string, number> = { C: 4, LW: 4, RW: 4, D: 6, G: 2 };
    for (const id of t) {
      const pos = proj.get(id)!.pos;
      if (c[pos]! > 0) c[pos]!--;
    }
    return c;
  };
  const taken = new Set<number>();
  for (let r = 0; r < ROSTER; r++) {
    for (let k = 0; k < 32; k++) {
      const t = teams[r % 2 === 0 ? k : 31 - k]!;
      const nd = need(t);
      const unmet = sum(Object.values(nd));
      const goalies = t.filter((id) => proj.get(id)!.goalie).length;
      const pick = items.find(({ p }) => {
        if (taken.has(p.id)) return false;
        if (p.goalie && goalies >= 3) return false;
        if (unmet >= ROSTER - r) return (nd[p.pos] ?? 0) > 0;
        return true;
      });
      if (!pick) continue;
      taken.add(pick.p.id);
      t.push(pick.p.id);
    }
  }
  return teams;
}

const rules = (bench: number, goalieBench: number): LineupRules => ({
  seats: SEATS,
  benchShare: bench,
  goalieBenchShare: goalieBench,
  rosterSize: ROSTER,
  captainBonus: 0,
});
const toTP = (p: Proj): TeamPlayer => ({
  id: String(p.id),
  name: String(p.id),
  pos: [p.pos],
  goalie: p.goalie,
  dv: { winNow: p.fp, balanced: p.fp, longTerm: p.fp },
  fp: p.fp,
  minorsOk: false,
});
/** The tool's prediction of a roster's season: its best projected lineup (the roster limit applied inside `lineupPoints`). */
function toolSeason(ids: readonly number[], proj: Map<number, Proj>, bench: number, goalieBench: number): number {
  return lineupPoints(ids.map((id) => toTP(proj.get(id)!)), rules(bench, goalieBench)).points;
}

/** The bench shares tried by the fit (skaters x goalies). */
const GRID: Array<[number, number]> = [];
for (const b of [0.5, 0.6, 0.7, 0.85, 1]) for (const g of [0.25, 0.5, 0.7, 0.9]) GRID.push([b, g]);
const key = ([b, g]: readonly [number, number]) => `${b}|${g}`;

interface TradeRow {
  naive: number;
  tool: Record<string, number>;
  truth: number;
  kind: string;
}

/**
 * Random trades of one season: leagues drafted from Marcel, random 1-for-1,
 * 2-for-1, 1-for-2 and 2-for-2 trades kept when balanced on paper; for each,
 * the naive sum, the tool under every bench rule of `grid`, and the truth.
 */
function seasonTrades(season: number, nLeagues: number, nTrades: number, grid: ReadonlyArray<readonly [number, number]>): TradeRow[] {
  const proj = marcel(season);
  const days = seasonDays(season);
  const out: TradeRow[] = [];
  for (let li = 0; li < nLeagues; li++) {
    const teams = draft(proj, `trade|${season}|${li}`);
    const truthBase = teams.map((t) => realSeason(t, proj, days));
    const toolBase = new Map(grid.map((r) => [key(r), teams.map((t) => toolSeason(t, proj, r[0], r[1]))]));
    const rng = mulberry32(hashStr(`trades|${season}|${li}`));
    let made = 0;
    let tries = 0;
    while (made < nTrades && tries < nTrades * 50) {
      tries++;
      const ai = Math.floor(rng.u() * 32);
      let bi = Math.floor(rng.u() * 31);
      if (bi >= ai) bi++;
      const u = rng.u();
      const [na, nb] = u < 0.4 ? [1, 1] : u < 0.6 ? [2, 1] : u < 0.8 ? [1, 2] : [2, 2];
      const pickN = (t: number[], n: number) => {
        const s = new Set<number>();
        while (s.size < n) s.add(t[Math.floor(rng.u() * t.length)]!);
        return [...s];
      };
      const A = teams[ai]!;
      const B = teams[bi]!;
      const give = pickN(A, na); // a sends
      const get = pickN(B, nb); // a receives
      const fp = (ids: number[]) => sum(ids.map((id) => proj.get(id)!.fp));
      const g = fp(give);
      const r = fp(get);
      if (g <= 0 || r <= 0 || Math.abs(g - r) / Math.max(g, r) > 0.25) continue;
      const after = [...A.filter((id) => !give.includes(id)), ...get];
      // the roster limit: a team over it lets its lowest projected go, in the truth as in the tool
      const kept = [...after].sort((x, y) => proj.get(y)!.fp - proj.get(x)!.fp).slice(0, ROSTER);
      const tool: Record<string, number> = {};
      for (const rr of grid) tool[key(rr)] = toolSeason(after, proj, rr[0], rr[1]) - toolBase.get(key(rr))![ai]!;
      out.push({ naive: r - g, tool, truth: realSeason(kept, proj, days) - truthBase[ai]!, kind: `${na}x${nb}` });
      made++;
    }
  }
  return out;
}

function spearman(x: number[], y: number[]): number {
  const rank = (a: number[]) => {
    const idx = a.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(a.length);
    idx.forEach(([, i], k) => (r[i] = k));
    return r;
  };
  const rx = rank(x);
  const ry = rank(y);
  const n = x.length;
  const mx = (n - 1) / 2;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i]! - mx) * (ry[i]! - mx);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - mx) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

interface Row {
  naive: number;
  tool: number;
  truth: number;
  kind: string;
}

function metrics(rows: Row[]) {
  const disagree = rows.filter((r) => Math.sign(r.naive) !== Math.sign(r.tool));
  return {
    n: rows.length,
    spearman: { naive: rho(rows, "naive"), tool: rho(rows, "tool") },
    signAccuracy: { naive: hit(rows, "naive"), tool: hit(rows, "tool") },
    mae: { naive: absErr(rows, "naive"), tool: absErr(rows, "tool") },
    disagreements: { n: disagree.length, toolRight: disagree.filter((r) => Math.sign(r.tool) === Math.sign(r.truth)).length },
  };
}

function bootstrapCI(rows: Row[], f: (r: Row[]) => number, B = 500): [number, number] {
  const rng = mulberry32(4242);
  const xs: number[] = [];
  for (let b = 0; b < B; b++) {
    const s = rows.map(() => rows[Math.floor(rng.u() * rows.length)]!);
    xs.push(f(s));
  }
  xs.sort((a, b) => a - b);
  return [xs[Math.floor(0.025 * (B - 1))]!, xs[Math.floor(0.975 * (B - 1))]!];
}
const r3 = (x: number) => Math.round(x * 1000) / 1000;
function rho(rows: Row[], k: "naive" | "tool"): number {
  return spearman(rows.map((x) => x[k]), rows.map((x) => x.truth));
}
function hit(rows: Row[], k: "naive" | "tool"): number {
  return rows.filter((x) => Math.sign(x[k]) === Math.sign(x.truth)).length / rows.length;
}
function absErr(rows: Row[], k: "naive" | "tool"): number {
  return sum(rows.map((x) => Math.abs(x[k] - x.truth))) / rows.length;
}
/** Paired 95 % bootstrap CIs of tool - naive (the same resampled trades for both). */
function pairedCIs(rows: Row[]) {
  return {
    spearman: bootstrapCI(rows, (r) => rho(r, "tool") - rho(r, "naive")).map(r3),
    signAccuracy: bootstrapCI(rows, (r) => hit(r, "tool") - hit(r, "naive")).map(r3),
    mae: bootstrapCI(rows, (r) => absErr(r, "tool") - absErr(r, "naive")).map((x) => Math.round(x * 10) / 10),
  };
}

function main() {
  const nLeagues = Number(args.leagues);
  const nTrades = Number(args.trades);
  // ---- fit the bench shares on the first season's trades: the grid point whose predictions rank the real outcomes best
  const fitRows = seasonTrades(FIT_SEASON, nLeagues, nTrades, GRID);
  const fitScores = GRID.map((g) => ({
    bench: g[0],
    goalieBench: g[1],
    spearman: r3(spearman(fitRows.map((r) => r.tool[key(g)]!), fitRows.map((r) => r.truth))),
  }));
  const best = [...fitScores].sort((x, y) => y.spearman - x.spearman)[0]!;
  console.log(`bench shares fitted on ${FIT_SEASON}: ${best.bench} / ${best.goalieBench} (committed: ${TRADE_BENCH.benchShare} / ${TRADE_BENCH.goalieBenchShare})`);
  const committed = [TRADE_BENCH.benchShare, TRADE_BENCH.goalieBenchShare] as const;

  const all: Row[] = [];
  const bySeason: Record<string, ReturnType<typeof metrics>> = {};
  for (const season of SEASONS.slice(1)) {
    const rows: Row[] = seasonTrades(season, nLeagues, nTrades, [committed]).map((r) => ({
      naive: r.naive,
      tool: r.tool[key(committed)]!,
      truth: r.truth,
      kind: r.kind,
    }));
    bySeason[String(season)] = metrics(rows);
    console.log(season, JSON.stringify(bySeason[String(season)]));
    all.push(...rows);
  }
  const m = metrics(all);
  const byKind: Record<string, ReturnType<typeof metrics> & { toolMinusNaiveCI: ReturnType<typeof pairedCIs> }> = {};
  for (const k of ["1x1", "2x1", "1x2", "2x2"]) {
    const rk = all.filter((r) => r.kind === k);
    byKind[k] = { ...metrics(rk), toolMinusNaiveCI: pairedCIs(rk) };
  }
  const summary = {
    builtAt: new Date().toISOString(),
    script: "scripts/backtest-trade.ts",
    league: "Slapshot-shaped: 32 teams, C4 LW4 RW4 D6 G2 + 3 reserves, Slapshot scoring",
    fitSeason: FIT_SEASON,
    testSeasons: SEASONS.slice(1),
    fit: { grid: fitScores, best: { bench: best.bench, goalieBench: best.goalieBench } },
    benchShareFitted: best.bench,
    goalieBenchShareFitted: best.goalieBench,
    benchShare: TRADE_BENCH.benchShare,
    goalieBenchShare: TRADE_BENCH.goalieBenchShare,
    overall: {
      ...m,
      spearmanCI: {
        naive: bootstrapCI(all, (r) => rho(r, "naive")).map(r3),
        tool: bootstrapCI(all, (r) => rho(r, "tool")).map(r3),
      },
      signCI: {
        naive: bootstrapCI(all, (r) => hit(r, "naive")).map(r3),
        tool: bootstrapCI(all, (r) => hit(r, "tool")).map(r3),
      },
      toolMinusNaiveCI: pairedCIs(all),
    },
    bySeason,
    byKind,
  };
  console.log(JSON.stringify(summary, null, 2));
  mkdirSync(join(args.out!, ".."), { recursive: true });
  writeFileSync(args.out!, JSON.stringify(summary, null, 2) + "\n");
  console.log(`wrote ${args.out}`);
}

main();
