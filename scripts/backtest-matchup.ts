/**
 * Walk-forward backtest of the weekly categories simulator (src/lib/matchup)
 * on real NHL weeks, in a Light the Lamp-shaped league: 12 teams, Yahoo
 * weekly H2H on G A PPP SOG HIT BLK / W GAA SV% SHO, C2 LW2 RW2 F1 D4 Util1
 * G2 BN4, daily lineups, 4 goalie appearances minimum.
 *
 *   --fit     fit the distribution parameters on the FIT seasons' box scores
 *             (prints a MatchupParams to paste in src/lib/matchup/params.ts)
 *   --calibrate  fit the rate-uncertainty shapes (kRateOffense,
 *             kRatePeripheral, kRateGoalie) on the FIT seasons' weeks: the
 *             same walk-forward weeks as the test, each shape of --grid
 *             scored by the category Brier of its own categories (G A PPP;
 *             SOG HIT BLK; W GAA SV% SHO), the best of each group printed
 *             (the largest shape within the Monte Carlo noise of the best)
 *   default   score the simulator on the TEST seasons, never seen by the fit:
 *             synthetic leagues drafted from Marcel projections (prior three
 *             seasons, 5/4/3), each week predicted with only what was known
 *             the Monday before (Marcel blended with the season to date),
 *             against the week's real box scores under the same lineup rules.
 *
 * Baselines: a coin (0.5); « force sans calendrier » (expected totals of the
 * starting lineup at 3.5 games each, Poisson variance, normal comparison —
 * comparing team strengths the way a human does); « projection ponctuelle »
 * (the simulator's own expected totals with the real schedule, but a hard
 * pick, P = 1 or 0); « Poisson indépendant » (the same simulator without
 * over-dispersion, back-to-backs or the wins-goals coupling: an ablation).
 * Error bars: 95 % bootstrap over weeks (1,000 resamples of whole weeks).
 *
 * Decisions: streaming (add one free agent for the week in place of the
 * cheapest skater) — the simulator's pick vs « meilleur autonome » (best
 * value) vs « le plus de matchs » (most games among the 10 best values); and
 * the goalie plan (stop at 4/5/6 appearances vs always start). Scored on the
 * REAL categories won, against standing pat.
 *
 * Writes src/data/matchup/backtest-summary.json (committed; the CI guard
 * scripts/test-matchup.ts checks it against params.ts).
 *
 * Usage: npx tsx scripts/backtest-matchup.ts [--fit] [--cache <dir>] [--leagues 4] [--sims 1000] [--quick]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { parseArgs } from "util";
import { mulberry32, hashStr } from "../src/lib/dynasty/rng";
import { fillSlots, type SlotSpec } from "../src/lib/leagues/slot-fill";
import { MATCHUP_PARAMS, type MatchupParams } from "../src/lib/matchup/params";
import {
  CATS,
  LTL_LEAGUE,
  LOWER_BETTER,
  T_LEN,
  catOutcomes,
  simulateWeek,
  type SimDay,
  type SimGoalie,
  type SimSkater,
  type SimTeam,
} from "../src/lib/matchup/simulate";
import { goaliePlans, recommendGoaliePlan, scoreCandidate } from "../src/lib/matchup/stream";

const { values: args } = parseArgs({
  options: {
    fit: { type: "boolean", default: false },
    calibrate: { type: "boolean", default: false },
    grid: { type: "string", default: "inf,120,60,40,15,12,10,8,6,5" },
    cache: { type: "string" },
    leagues: { type: "string", default: "4" },
    sims: { type: "string", default: "1000" },
    quick: { type: "boolean", default: false },
    out: { type: "string", default: join(process.cwd(), "src", "data", "matchup", "backtest-summary.json") },
  },
});
const CACHE = args.cache ?? process.env.NHL_STATS_CACHE ?? join(process.cwd(), ".cache", "nhl-stats");
const FIT_SEASONS = [20222023, 20232024];
const TEST_SEASONS = [20242025, 20252026];
const N_LEAGUES = Number(args.leagues);
const SIMS = Number(args.sims);

type SkG = [number, string, string, string, string, number, number, number, number, number, number, number];
type GkG = [number, string, string, string, number, number, number, number, number, number];
type SkS = [number, string, number, number, number, number, number, number, number, number];
type GkS = [number, number, number, number, number, number, number, number];
interface GamesFile {
  season: number;
  skaters: SkG[];
  goalies: GkG[];
  names: Record<string, string>;
}
interface TotalsFile {
  season: number;
  skaters: SkS[];
  goalies: GkS[];
  names: Record<string, string>;
}

function load<T>(f: string): T {
  const p = join(CACHE, f);
  if (!existsSync(p)) throw new Error(`missing ${p}: run scripts/fetch-nhl-game-logs.ts first`);
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

const POS: Record<string, string> = { C: "C", L: "LW", R: "RW", D: "D" };
const prevSeason = (s: number) => {
  const y = Math.floor(s / 10000);
  return (y - 1) * 10000 + y;
};
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

// =============================================================== fit
function fitParams(): MatchupParams {
  const k = { sog: [0, 0], hit: [0, 0], blk: [0, 0], off: [0, 0], sa: [0, 0], q: [0, 0] };
  let wGA: Array<[number, number]> = [];
  let b2bStarts = 0;
  let b2bGames = 0;
  let allStarts = 0;
  let allGames = 0;
  let playNum = 0;
  let playDen = 0;
  for (const season of FIT_SEASONS) {
    const g = load<GamesFile>(`games-${season}.json`);
    // ---- skaters
    const by = new Map<number, SkG[]>();
    for (const r of g.skaters) (by.get(r[0]) ?? by.set(r[0], []).get(r[0])!).push(r);
    for (const rows of by.values()) {
      if (rows.length < 40) continue;
      const n = rows.length;
      const col = (i: number) => rows.map((r) => r[i] as number);
      const mv = (xs: number[]) => {
        const m = sum(xs) / n;
        return [m, sum(xs.map((x) => (x - m) ** 2)) / (n - 1)] as const;
      };
      for (const [key, i] of [["sog", 8], ["hit", 9], ["blk", 10]] as const) {
        const [m, v] = mv(col(i));
        k[key][0] += m * m;
        k[key][1] += v - m;
      }
      const G = col(5);
      const A = col(6);
      const [mg, vg] = mv(G);
      const [ma, va] = mv(A);
      const cov = sum(G.map((x, j) => (x - mg) * (A[j]! - ma))) / (n - 1);
      k.off[0] += mg * ma + mg * mg + ma * ma;
      k.off[1] += cov + (vg - mg) + (va - ma);
    }
    // ---- goalies (full starts)
    const gby = new Map<number, GkG[]>();
    for (const r of g.goalies) if (r[4] === 1 && r[9] >= 3300) (gby.get(r[0]) ?? gby.set(r[0], []).get(r[0])!).push(r);
    for (const rows of gby.values()) {
      if (rows.length < 20) continue;
      const n = rows.length;
      const sa = rows.map((r) => r[7]);
      const m = sum(sa) / n;
      const v = sum(sa.map((x) => (x - m) ** 2)) / (n - 1);
      k.sa[0] += m * m;
      k.sa[1] += v - m;
      const q = sum(rows.map((r) => r[6])) / Math.max(1, sum(sa));
      for (const r of rows) {
        const e = r[7] * q;
        k.q[0] += e * e;
        k.q[1] += (r[6] - e) ** 2 - e;
      }
      wGA = wGA.concat(rows.map((r) => [r[6], r[5]] as [number, number]));
    }
    // ---- back-to-backs: starters' share on second nights
    const clubDates = new Map<string, Set<string>>();
    for (const r of g.goalies) (clubDates.get(r[2]) ?? clubDates.set(r[2], new Set()).get(r[2])!).add(r[1]);
    const startsBy = new Map<number, GkG[]>();
    for (const r of g.goalies) if (r[4] === 1) (startsBy.get(r[0]) ?? startsBy.set(r[0], []).get(r[0])!).push(r);
    for (const rows of startsBy.values()) {
      const club = rows[rows.length - 1]![2];
      const dates = clubDates.get(club)!;
      const teamGames = [...dates].length;
      const share = rows.filter((r) => r[2] === club).length / teamGames;
      if (share <= 0.5) continue;
      const mine = new Set(rows.filter((r) => r[2] === club).map((r) => r[1]));
      for (const d of dates) {
        const prev = new Date(`${d}T12:00:00Z`);
        prev.setUTCDate(prev.getUTCDate() - 1);
        const isB2b = dates.has(prev.toISOString().slice(0, 10));
        allGames++;
        if (mine.has(d)) allStarts++;
        if (isB2b) {
          b2bGames++;
          if (mine.has(d)) b2bStarts++;
        }
      }
    }
    // ---- skaters dressing, given they played the week before
    const clubByDate = new Map<string, Set<string>>();
    for (const r of g.skaters) (clubByDate.get(r[1]) ?? clubByDate.set(r[1], new Set()).get(r[1])!).add(r[2]);
    const weekOf = (d: string) => {
      const x = new Date(`${d}T12:00:00Z`);
      x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
      return x.toISOString().slice(0, 10);
    };
    const played = new Map<string, number>(); // id|week -> games
    const clubOf = new Map<string, string>();
    // regulars only (14+ minutes a night over the season): the fantasy-relevant skaters
    const toi = new Map<number, [number, number]>();
    for (const r of g.skaters) {
      const x = toi.get(r[0]) ?? [0, 0];
      x[0] += r[11];
      x[1]++;
      toi.set(r[0], x);
    }
    for (const r of g.skaters) {
      const x = toi.get(r[0])!;
      if (x[0] / x[1] < 14 * 60 || x[1] < 30) continue;
      const key = `${r[0]}|${weekOf(r[1])}`;
      played.set(key, (played.get(key) ?? 0) + 1);
      clubOf.set(key, r[2]);
    }
    const clubWeekGames = new Map<string, number>();
    for (const [d, clubs] of clubByDate) for (const c of clubs) clubWeekGames.set(`${c}|${weekOf(d)}`, (clubWeekGames.get(`${c}|${weekOf(d)}`) ?? 0) + 1);
    for (const [key, n] of played) {
      const [id, wk] = key.split("|");
      const prev = new Date(`${wk}T12:00:00Z`);
      prev.setUTCDate(prev.getUTCDate() - 7);
      const pk = `${id}|${prev.toISOString().slice(0, 10)}`;
      if (!played.has(pk)) continue;
      const club = clubOf.get(key)!;
      const tg = clubWeekGames.get(`${club}|${wk}`) ?? 0;
      if (!tg) continue;
      playNum += Math.min(n, tg);
      playDen += tg;
    }
    // weeks where a skater played the week before and NOT this week are missed in `played`:
    // count them as zero games of their former club's week
    for (const [key] of played) {
      const [id, wk] = key.split("|");
      const next = new Date(`${wk}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 7);
      const nk = `${id}|${next.toISOString().slice(0, 10)}`;
      if (played.has(nk)) continue;
      const tg = clubWeekGames.get(`${clubOf.get(key)}|${next.toISOString().slice(0, 10)}`) ?? 0;
      playDen += tg;
    }
  }
  // logistic W ~ a + b·GA (IRLS)
  let a = 0;
  let b = 0;
  for (let it = 0; it < 30; it++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (const [x, y] of wGA) {
      const p = 1 / (1 + Math.exp(-(a + b * x)));
      const w = p * (1 - p);
      g0 += y - p;
      g1 += (y - p) * x;
      h00 += w;
      h01 += w * x;
      h11 += w * x * x;
    }
    const det = h00 * h11 - h01 * h01;
    a += (h11 * g0 - h01 * g1) / det;
    b += (-h01 * g0 + h00 * g1) / det;
  }
  const shape = ([num, den]: number[]) => (den > 0 ? Math.round((num! / den!) * 100) / 100 : Infinity);
  const r2 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    kOffense: shape(k.off),
    kShots: shape(k.sog),
    kHits: shape(k.hit),
    kBlocks: shape(k.blk),
    kShotsAgainst: shape(k.sa),
    kSavePct: shape(k.q),
    winSlope: r2(b),
    backToBackStart: r2(b2bStarts / Math.max(1, b2bGames) / (allStarts / Math.max(1, allGames))),
    skaterPlays: r2(playNum / Math.max(1, playDen)),
    // fitted by --calibrate, on these same seasons' weeks
    kRateOffense: MATCHUP_PARAMS.kRateOffense,
    kRatePeripheral: MATCHUP_PARAMS.kRatePeripheral,
    kRateGoalie: MATCHUP_PARAMS.kRateGoalie,
  };
}

// =============================================================== projections
interface SkProj {
  id: number;
  name: string;
  pos: string;
  rate: number[]; // per game G A PPP SOG HIT BLK
  gp: number;
}
interface GkProj {
  id: number;
  name: string;
  share: number;
  w: number;
  ga: number;
  sa: number;
}

/** Marcel 5/4/3 from season totals, regressed toward the position mean (15 games / 10 starts / 1,500 shots). */
function marcel(season: number): { sk: Map<number, SkProj>; gk: Map<number, GkProj> } {
  const prior = [prevSeason(season), prevSeason(prevSeason(season)), prevSeason(prevSeason(prevSeason(season)))];
  const W = [5, 4, 3];
  const files = prior.map((s) => load<TotalsFile>(`totals-${s}.json`));
  const names: Record<string, string> = Object.assign({}, ...files.slice().reverse().map((f) => f.names));
  const acc = new Map<number, { pos: string; gp: number; x: number[]; gpw: number; n: number }>();
  files.forEach((f, i) => {
    for (const r of f.skaters) {
      const a = acc.get(r[0]) ?? { pos: r[1], gp: 0, x: [0, 0, 0, 0, 0, 0], gpw: 0, n: 0 };
      if (i === 0 || !acc.has(r[0])) a.pos = a.pos || r[1];
      a.gp += W[i]! * r[2];
      a.gpw += W[i]!;
      for (let c = 0; c < 6; c++) a.x[c]! += W[i]! * (r[3 + c] as number);
      acc.set(r[0], a);
    }
  });
  // position means per game
  const mean: Record<string, number[]> = {};
  for (const p of ["F", "D"]) {
    const rows = [...acc.values()].filter((a) => (a.pos === "D") === (p === "D") && a.gp > 0);
    const g = sum(rows.map((a) => a.gp));
    mean[p] = [0, 1, 2, 3, 4, 5].map((c) => sum(rows.map((a) => a.x[c]!)) / g);
  }
  const sk = new Map<number, SkProj>();
  for (const [id, a] of acc) {
    if (!POS[a.pos]) continue;
    const m = mean[a.pos === "D" ? "D" : "F"]!;
    const K = 15 * 4; // 15 games at weight 4
    sk.set(id, {
      id,
      name: names[String(id)] ?? String(id),
      pos: POS[a.pos]!,
      rate: [0, 1, 2, 3, 4, 5].map((c) => (a.x[c]! + K * m[c]!) / (a.gp + K)),
      gp: Math.min(82, a.gp / Math.max(1, a.gpw) / 0.95),
    });
  }
  const gacc = new Map<number, { gs: number; w: number; ga: number; sa: number; share: number; sw: number }>();
  files.forEach((f, i) => {
    for (const r of f.goalies) {
      const a = gacc.get(r[0]) ?? { gs: 0, w: 0, ga: 0, sa: 0, share: 0, sw: 0 };
      a.gs += W[i]! * r[2];
      a.w += W[i]! * r[3];
      a.ga += W[i]! * r[4];
      a.sa += W[i]! * r[5];
      a.share += W[i]! * (r[2] / 82);
      a.sw += W[i]!;
      gacc.set(r[0], a);
    }
  });
  const tot = [...gacc.values()];
  const lgW = sum(tot.map((a) => a.w)) / sum(tot.map((a) => a.gs));
  const lgSA = sum(tot.map((a) => a.sa)) / sum(tot.map((a) => a.gs));
  const lgQ = sum(tot.map((a) => a.ga)) / sum(tot.map((a) => a.sa));
  const gk = new Map<number, GkProj>();
  for (const [id, a] of gacc) {
    const K = 10 * 4;
    const sa = (a.sa + K * lgSA) / (a.gs + K);
    const q = (a.ga + 1500 * 4 * lgQ) / (a.sa + 1500 * 4);
    gk.set(id, { id, name: names[String(id)] ?? String(id), share: Math.min(0.9, a.share / a.sw), w: (a.w + K * lgW) / (a.gs + K), ga: sa * q, sa });
  }
  return { sk, gk };
}

// =============================================================== league
interface LeagueTeam {
  skaters: number[];
  goalies: number[];
}

function zScales(sk: Map<number, SkProj>): { m: number[]; s: number[] } {
  const top = [...sk.values()].filter((p) => p.gp >= 40).sort((a, b) => b.rate[0]! + b.rate[1]! - (a.rate[0]! + a.rate[1]!)).slice(0, 300);
  const m = [0, 1, 2, 3, 4, 5].map((c) => sum(top.map((p) => p.rate[c]!)) / top.length);
  const s = [0, 1, 2, 3, 4, 5].map((c) => Math.sqrt(sum(top.map((p) => (p.rate[c]! - m[c]!) ** 2)) / top.length));
  return { m, s };
}
const skValue = (rate: readonly number[], z: { m: number[]; s: number[] }) => sum(rate.map((r, c) => (r - z.m[c]!) / z.s[c]!));
const gkValue = (g: GkProj) => g.share * (2.5 * g.w + 1.2 * (1 - g.ga / g.sa) * 10 - 0.25 * g.ga);

function draftLeague(proj: ReturnType<typeof marcel>, seed: string): LeagueTeam[] {
  const rng = mulberry32(hashStr(seed));
  const z = zScales(proj.sk);
  type Item = { id: number; kind: "S" | "G"; pos: string; v: number };
  const items: Item[] = [];
  for (const p of proj.sk.values()) if (p.gp >= 30) items.push({ id: p.id, kind: "S", pos: p.pos, v: skValue(p.rate, z) * (p.gp / 82) + 0.6 * rng.n() });
  const gvs = [...proj.gk.values()].filter((g) => g.share > 0.2).map((g) => ({ g, v: gkValue(g) }));
  const gm = sum(gvs.map((x) => x.v)) / gvs.length;
  const gs = Math.sqrt(sum(gvs.map((x) => (x.v - gm) ** 2)) / gvs.length);
  // goalies valued like a good skater at the top (ranked ~30-60th overall for the best)
  for (const { g, v } of gvs) items.push({ id: g.id, kind: "G", pos: "G", v: 3 + 2.2 * ((v - gm) / gs) + 0.6 * rng.n() });
  items.sort((a, b) => b.v - a.v);
  const teams: LeagueTeam[] = Array.from({ length: 12 }, () => ({ skaters: [], goalies: [] }));
  const need = (t: LeagueTeam): Record<string, number> => {
    const c: Record<string, number> = { C: 2, LW: 2, RW: 2, D: 4, G: 2 };
    for (const id of t.skaters) {
      const p = proj.sk.get(id)!.pos;
      if (c[p]! > 0) c[p]!--;
    }
    c.G = Math.max(0, 2 - t.goalies.length);
    return c;
  };
  const taken = new Set<number>();
  for (let round = 0; round < 18; round++) {
    for (let k = 0; k < 12; k++) {
      const ti = round % 2 === 0 ? k : 11 - k;
      const t = teams[ti]!;
      const left = 18 - round;
      const nd = need(t);
      const unmet = sum(Object.values(nd));
      const pick = items.find((it) => {
        if (taken.has(it.id)) return false;
        if (it.kind === "G" && t.goalies.length >= 3) return false;
        if (unmet >= left) return (nd[it.pos] ?? 0) > 0;
        return true;
      });
      if (!pick) continue;
      taken.add(pick.id);
      if (pick.kind === "G") t.goalies.push(pick.id);
      else t.skaters.push(pick.id);
    }
  }
  return teams;
}

/** Round-robin pairings for week k (circle method). */
function pairings(k: number, n = 12): Array<[number, number]> {
  const ids = Array.from({ length: n }, (_, i) => i);
  const rot = [ids[0]!, ...ids.slice(1).map((_, i) => ids[1 + ((i + k) % (n - 1))]!)];
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n / 2; i++) out.push([rot[i]!, rot[n - 1 - i]!]);
  return out;
}

// =============================================================== season data
interface SeasonData {
  season: number;
  weeks: string[]; // Mondays with games
  days: Map<string, Set<string>>; // date -> clubs
  skDay: Map<string, Map<number, SkG>>; // date -> id -> row
  gkDay: Map<string, Map<number, GkG>>;
  names: Record<string, string>;
}

function seasonData(season: number): SeasonData {
  const g = load<GamesFile>(`games-${season}.json`);
  const days = new Map<string, Set<string>>();
  const skDay = new Map<string, Map<number, SkG>>();
  const gkDay = new Map<string, Map<number, GkG>>();
  for (const r of g.skaters) {
    (days.get(r[1]) ?? days.set(r[1], new Set()).get(r[1])!).add(r[2]);
    (skDay.get(r[1]) ?? skDay.set(r[1], new Map()).get(r[1])!).set(r[0], r);
  }
  for (const r of g.goalies) (gkDay.get(r[1]) ?? gkDay.set(r[1], new Map()).get(r[1])!).set(r[0], r);
  const mondays = new Set<string>();
  for (const d of days.keys()) {
    const x = new Date(`${d}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    mondays.add(x.toISOString().slice(0, 10));
  }
  return { season, weeks: [...mondays].sort(), days, skDay, gkDay, names: g.names };
}

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** What was known the Monday before: Marcel blended with the season to date. */
class InSeason {
  sk = new Map<number, { gp: number; x: number[]; club: string | null }>();
  gk = new Map<number, { gs: number; w: number; ga: number; sa: number; club: string | null }>();
  clubGames = new Map<string, number>();
  gkClubStarts = new Map<string, number>(); // id|club -> starts
  constructor(private data: SeasonData) {}
  absorb(from: string, to: string) {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      for (const c of this.data.days.get(d) ?? []) this.clubGames.set(c, (this.clubGames.get(c) ?? 0) + 1);
      for (const r of this.data.skDay.get(d)?.values() ?? []) {
        const a = this.sk.get(r[0]) ?? { gp: 0, x: [0, 0, 0, 0, 0, 0], club: null };
        a.gp++;
        for (let c = 0; c < 6; c++) a.x[c]! += r[5 + c] as number;
        a.club = r[2];
        this.sk.set(r[0], a);
      }
      for (const r of this.data.gkDay.get(d)?.values() ?? []) {
        const a = this.gk.get(r[0]) ?? { gs: 0, w: 0, ga: 0, sa: 0, club: null };
        a.club = r[2];
        if (r[4] === 1) {
          a.gs++;
          a.w += r[5];
          a.ga += r[6];
          a.sa += r[7];
          const k = `${r[0]}|${r[2]}`;
          this.gkClubStarts.set(k, (this.gkClubStarts.get(k) ?? 0) + 1);
        }
        this.gk.set(r[0], a);
      }
    }
  }
}

function clubForWeek(data: SeasonData, inS: InSeason, id: number, goalie: boolean, monday: string): string | null {
  const known = goalie ? inS.gk.get(id)?.club : inS.sk.get(id)?.club;
  if (known) return known;
  for (let d = monday; d <= addDays(monday, 6); d = addDays(d, 1)) {
    const r = goalie ? data.gkDay.get(d)?.get(id) : data.skDay.get(d)?.get(id);
    if (r) return r[2];
  }
  return null;
}

// =============================================================== realized week
const SLOTS: SlotSpec<string>[] = Object.entries(LTL_LEAGUE.slots).map(([slot, n]) => ({ slot, capacity: n, accepts: LTL_LEAGUE.eligibility[slot]! }));

function realized(data: SeasonData, team: SimTeam, monday: string, out: Float64Array, o: number): void {
  const cap = team.goalieCap ?? Infinity;
  let apps = 0;
  const sk = [...team.skaters].sort((a, b) => b.prio - a.prio || a.id - b.id);
  const gk = [...team.goalies].sort((a, b) => b.prio - a.prio || a.id - b.id);
  for (let d = monday; d <= addDays(monday, 6); d = addDays(d, 1)) {
    const rows = data.skDay.get(d);
    if (rows) {
      const dressed = sk.filter((p) => rows.has(p.id));
      const fill = fillSlots<number, { id: number; positions: readonly string[] }, string>(dressed.map((p) => ({ id: p.id, positions: p.pos })), SLOTS);
      for (const id of fill.slotOf.keys()) {
        const r = rows.get(id)!;
        for (let c = 0; c < 6; c++) out[o + c] += r[5 + c] as number;
      }
    }
    const grows = data.gkDay.get(d);
    if (grows) {
      const st = gk.filter((g) => grows.get(g.id)?.[4] === 1);
      for (let i = 0; i < Math.min(2, st.length); i++) {
        if (apps >= cap) break;
        const r = grows.get(st[i]!.id)!;
        apps++;
        out[o + 6] += r[5];
        out[o + 7] += r[6];
        out[o + 8] += r[7];
        out[o + 9] += r[8];
        out[o + 10] += 1;
      }
    }
  }
}

// =============================================================== baselines
const normCdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

/** « Force sans calendrier »: starting lineup × 3.5 games, Poisson variance, normal comparison. */
function naiveOdds(a: SimTeam, b: SimTeam, params: MatchupParams): number[] {
  const tot = (t: SimTeam) => {
    const sk = [...t.skaters].sort((x, y) => y.prio - x.prio);
    const fill = fillSlots<number, { id: number; positions: readonly string[] }, string>(sk.map((p) => ({ id: p.id, positions: p.pos })), SLOTS);
    const m = [0, 0, 0, 0, 0, 0];
    for (const p of sk) if (fill.slotOf.has(p.id)) for (let c = 0; c < 6; c++) m[c]! += 3.5 * params.skaterPlays * p.rate[c]!;
    const g = [...t.goalies].sort((x, y) => y.prio - x.prio).slice(0, 2);
    const apps = sum(g.map((x) => 3.5 * x.start));
    const w = sum(g.map((x) => 3.5 * x.start * x.w));
    const ga = sum(g.map((x) => 3.5 * x.start * x.ga));
    const sa = sum(g.map((x) => 3.5 * x.start * x.sa));
    const sho = sum(g.map((x) => 3.5 * x.start * Math.exp(-x.ga)));
    return { m, apps, w, ga, sa, sho };
  };
  const A = tot(a);
  const B = tot(b);
  const cmp = (ma: number, va: number, mb: number, vb: number) => normCdf((ma - mb) / Math.sqrt(Math.max(1e-9, va + vb)));
  const out = A.m.map((x, c) => cmp(x, x, B.m[c]!, B.m[c]!));
  out.push(cmp(A.w, A.w, B.w, B.w));
  // GAA lower better: P(A's GAA < B's)
  const gaa = (T: typeof A) => [T.ga / Math.max(0.1, T.apps), T.ga / Math.max(0.1, T.apps) ** 2] as const;
  const [ga, gva] = gaa(A);
  const [gb, gvb] = gaa(B);
  out.push(cmp(gb, gvb, ga, gva));
  const sv = (T: typeof A) => [1 - T.ga / Math.max(1, T.sa), T.ga / Math.max(1, T.sa) ** 2] as const;
  const [sa_, sva] = sv(A);
  const [sb, svb] = sv(B);
  out.push(cmp(sa_, sva, sb, svb));
  out.push(cmp(A.sho, A.sho, B.sho, B.sho));
  return out;
}

const POISSON_PARAMS = (p: MatchupParams): MatchupParams => ({
  ...p,
  kOffense: Infinity,
  kShots: Infinity,
  kHits: Infinity,
  kBlocks: Infinity,
  kShotsAgainst: Infinity,
  kSavePct: Infinity,
  winSlope: 0,
  backToBackStart: 1,
  kRateOffense: Infinity,
  kRatePeripheral: Infinity,
  kRateGoalie: Infinity,
});

// =============================================================== bootstrap
interface Obs {
  week: string; // season|monday
  model: string;
  se: number; // squared error
  hit: number; // 1 right side, 0 wrong, NaN tie / undecided
}
function bootstrap(obs: Obs[], models: string[], ref: string, B = 1000) {
  const weeks = [...new Set(obs.map((o) => o.week))];
  const per = new Map<string, Map<string, { se: number; n: number; hit: number; nh: number }>>();
  for (const o of obs) {
    const m = per.get(o.week) ?? per.set(o.week, new Map()).get(o.week)!;
    const x = m.get(o.model) ?? { se: 0, n: 0, hit: 0, nh: 0 };
    x.se += o.se;
    x.n++;
    if (!Number.isNaN(o.hit)) {
      x.hit += o.hit;
      x.nh++;
    }
    m.set(o.model, x);
  }
  const rng = mulberry32(12345);
  const stat = (ws: string[], model: string) => {
    let se = 0, n = 0, hit = 0, nh = 0;
    for (const w of ws) {
      const x = per.get(w)?.get(model);
      if (!x) continue;
      se += x.se;
      n += x.n;
      hit += x.hit;
      nh += x.nh;
    }
    return { brier: se / n, acc: hit / nh };
  };
  const res: Record<string, { brier: number; acc: number; brierCI: [number, number]; dRef: number; dRefCI: [number, number] }> = {};
  const draws: Record<string, number[]> = {};
  const dd: Record<string, number[]> = {};
  for (const m of models) {
    draws[m] = [];
    dd[m] = [];
  }
  for (let b = 0; b < B; b++) {
    const ws = weeks.map(() => weeks[Math.floor(rng.u() * weeks.length)]!);
    const r = stat(ws, ref).brier;
    for (const m of models) {
      const x = stat(ws, m).brier;
      draws[m]!.push(x);
      dd[m]!.push(x - r);
    }
  }
  const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))]!;
  for (const m of models) {
    const s = stat(weeks, m);
    res[m] = {
      brier: r4(s.brier),
      acc: r4(s.acc),
      brierCI: [r4(q(draws[m]!, 0.025)), r4(q(draws[m]!, 0.975))],
      dRef: r4(s.brier - stat(weeks, ref).brier),
      dRefCI: [r4(q(dd[m]!, 0.025)), r4(q(dd[m]!, 0.975))],
    };
  }
  return res;
}
const r4 = (x: number) => Math.round(x * 10000) / 10000;

function meanCI(xs: number[], B = 1000): { mean: number; ci: [number, number]; n: number } {
  const rng = mulberry32(777);
  const m = sum(xs) / Math.max(1, xs.length);
  const bs: number[] = [];
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rng.u() * xs.length)]!;
    bs.push(s / xs.length);
  }
  bs.sort((a, b) => a - b);
  return { mean: r4(m), ci: [r4(bs[Math.floor(0.025 * (B - 1))]!), r4(bs[Math.floor(0.975 * (B - 1))]!)], n: xs.length };
}

// =============================================================== the weeks
interface MatchupCtx {
  season: number;
  monday: string;
  li: number;
  ai: number;
  A: SimTeam;
  B: SimTeam;
  days: SimDay[];
  data: SeasonData;
  proj: ReturnType<typeof marcel>;
  inS: InSeason;
  skRate: (id: number) => SimSkater | null;
  rostered: Set<number>;
}

/** Every matchup of every week of `seasons`, each predicted with what was known the Monday before. */
function* matchups(seasons: readonly number[]): Generator<MatchupCtx> {
  const t0 = Date.now();
  let n = 0;
  for (const season of seasons) {
    const data = seasonData(season);
    const proj = marcel(season);
    const z = zScales(proj.sk);
    const leagues = Array.from({ length: N_LEAGUES }, (_, li) => draftLeague(proj, `ltl|${season}|${li}`));
    const inS = new InSeason(data);
    let prevMonday: string | null = null;
    const weeks = args.quick ? data.weeks.slice(4, 10) : data.weeks;
    if (args.quick) inS.absorb(data.weeks[0]!, addDays(weeks[0]!, -1));
    for (const [wi, monday] of weeks.entries()) {
      if (prevMonday) inS.absorb(prevMonday, addDays(monday, -1));
      prevMonday = monday;
      // the week's days
      const days: SimDay[] = [];
      for (let d = monday; d <= addDays(monday, 6); d = addDays(d, 1)) {
        const teams = data.days.get(d) ?? new Set<string>();
        const prev = data.days.get(addDays(d, -1));
        days.push({ date: d, teams, b2b: new Set([...teams].filter((t) => prev?.has(t))) });
      }
      if (sum(days.map((d) => d.teams.size)) < 10) continue;
      // Monday-before rates
      const skRate = (id: number): SimSkater | null => {
        const p = proj.sk.get(id);
        if (!p) return null;
        const club = clubForWeek(data, inS, id, false, monday);
        if (!club) return null;
        const s = inS.sk.get(id);
        const K = 20;
        const rate = p.rate.map((r, c) => (r * K + (s?.x[c] ?? 0)) / (K + (s?.gp ?? 0))) as unknown as SimSkater["rate"];
        return { id, name: p.name, team: club, pos: [p.pos], rate, prio: skValue(rate, z) };
      };
      const gkRate = (id: number): SimGoalie | null => {
        const p = proj.gk.get(id);
        if (!p) return null;
        const club = clubForWeek(data, inS, id, true, monday);
        if (!club) return null;
        const s = inS.gk.get(id);
        const K = 10;
        const gs = s?.gs ?? 0;
        const w = (p.w * K + (s?.w ?? 0)) / (K + gs);
        const sa = (p.sa * K + (s?.sa ?? 0)) / (K + gs);
        const q = (p.ga / p.sa) * 1000 + (s?.ga ?? 0);
        const qq = q / (1000 + (s?.sa ?? 0));
        const tg = inS.clubGames.get(club) ?? 0;
        const share = Math.min(0.92, (p.share * 10 + (inS.gkClubStarts.get(`${id}|${club}`) ?? 0)) / (10 + tg));
        return { id, name: p.name, team: club, start: share, w, ga: sa * qq, sa, prio: share * 10 + w };
      };
      for (const [li, league] of leagues.entries()) {
        const teams: SimTeam[] = league.map((t) => ({
          skaters: t.skaters.map(skRate).filter((x): x is SimSkater => x != null),
          goalies: t.goalies.map(gkRate).filter((x): x is SimGoalie => x != null),
        }));
        // goalie shares of one club over both fantasy sides must not exceed 1
        const rostered = new Set(league.flatMap((t) => [...t.skaters, ...t.goalies]));
        for (const [ai, bi] of pairings(wi)) {
          n++;
          yield { season, monday, li, ai, A: teams[ai]!, B: teams[bi]!, days, data, proj, inS, skRate, rostered };
        }
      }
      console.log(`${season} ${monday}: ${n} matchups so far (${Math.round((Date.now() - t0) / 1000)} s)`);
    }
  }
}

// =============================================================== calibrate
function calibrate() {
  const grid = args.grid!.split(",").map((x) => (x.trim() === "inf" ? Infinity : Number(x)));
  const se = grid.map(() => new Array<number>(CATS.length).fill(0));
  let n = 0;
  for (const { season, monday, li, ai, A, B, days, data } of matchups(FIT_SEASONS)) {
    const real = new Float64Array(2 * T_LEN);
    realized(data, A, monday, real, 0);
    realized(data, B, monday, real, T_LEN);
    const out = catOutcomes(real, 0, LTL_LEAGUE);
    const seed = `${season}|${monday}|${li}|${ai}`;
    grid.forEach((k, gi) => {
      const params = { ...MATCHUP_PARAMS, kRateOffense: k, kRatePeripheral: k, kRateGoalie: k };
      const sim = simulateWeek(A, B, days, { sims: SIMS, seed, params });
      sim.cats.forEach((c, i) => (se[gi]![i]! += (c.win + 0.5 * c.tie - out[i]!) ** 2));
    });
    n++;
  }
  const groups: Record<string, number[]> = { kRateOffense: [0, 1, 2], kRatePeripheral: [3, 4, 5], kRateGoalie: [6, 7, 8, 9] };
  const res: Record<string, unknown> = { matchups: n, grid: grid.map(String) };
  // The least uncertainty (largest k) within the Monte Carlo noise of the best
  // Brier (~0.0003 at 1,000 draws): no extra noise without evidence for it.
  const TOL = 0.0003;
  for (const [name, idx] of Object.entries(groups)) {
    const brier = grid.map((_, gi) => sum(idx.map((i) => se[gi]![i]!)) / (n * idx.length));
    const min = Math.min(...brier);
    const best = grid.filter((_, gi) => brier[gi]! <= min + TOL).sort((x, y) => y - x)[0]!;
    res[name] = { brier: brier.map(r4), best: String(best) };
  }
  console.log(JSON.stringify(res, null, 2));
}

// =============================================================== main
function main() {
  if (args.fit) {
    const p = fitParams();
    console.log(JSON.stringify(p, null, 2));
    return;
  }
  if (args.calibrate) {
    calibrate();
    return;
  }
  const params = MATCHUP_PARAMS;
  const pois = POISSON_PARAMS(params);
  const obsCat: Obs[] = [];
  const obsWeek: Obs[] = [];
  const perCat: Record<string, { se: Record<string, number>; n: number }> = {};
  const streamGain: Record<string, number[]> = { outil: [], meilleurAutonome: [], plusDeMatchs: [] };
  const goalieGain: number[] = [];
  const goalieChosen: Record<string, number> = {};
  // the same plan with no noise margin (stop early whenever the simulation says so)
  const goalieGain0: number[] = [];
  const goalieChosen0: Record<string, number> = {};
  // reliability: predicted P(win category) by tenth, and how often it happened
  const calib: Record<string, Array<{ p: number; y: number; n: number }>> = {};
  for (const { season, monday, li, ai, A, B, days, data, proj, inS, skRate, rostered } of matchups(TEST_SEASONS)) {
    const seed = `${season}|${monday}|${li}|${ai}`;
    const sim = simulateWeek(A, B, days, { sims: SIMS, seed, params });
    const simP = simulateWeek(A, B, days, { sims: SIMS, seed, params: pois });
    const naive = naiveOdds(A, B, params);
    const real = new Float64Array(2 * T_LEN);
    realized(data, A, monday, real, 0);
    realized(data, B, monday, real, T_LEN);
    const out = catOutcomes(real, 0, LTL_LEAGUE);
    const wk = `${season}|${monday}`;
    const preds: Record<string, number[]> = {
      simulateur: sim.cats.map((c) => c.win + 0.5 * c.tie),
      poissonIndependant: simP.cats.map((c) => c.win + 0.5 * c.tie),
      forceSansCalendrier: naive,
      projectionPonctuelle: sim.cats.map((c) => {
        const d = LOWER_BETTER.has(c.cat) ? c.theirs - c.mine : c.mine - c.theirs;
        return Number.isNaN(d) ? 0.5 : Math.abs(d) < 1e-9 ? 0.5 : d > 0 ? 1 : 0;
      }),
      pileOuFace: CATS.map(() => 0.5),
    };
    for (const [m, p] of Object.entries(preds)) {
      p.forEach((x, i) => {
        const y = out[i]!;
        obsCat.push({ week: wk, model: m, se: (x - y) ** 2, hit: y === 0.5 || x === 0.5 ? NaN : Number(x > 0.5 === y > 0.5) });
        const bins = (calib[m] ??= Array.from({ length: 10 }, () => ({ p: 0, y: 0, n: 0 })));
        const bin = bins[Math.min(9, Math.floor(x * 10))]!;
        bin.p += x;
        bin.y += y;
        bin.n++;
        const pc = (perCat[CATS[i]!] ??= { se: {}, n: 0 });
        pc.se[m] = (pc.se[m] ?? 0) + (x - y) ** 2;
      });
    }
    CATS.forEach((c) => perCat[c]!.n++);
    // the week: win = more categories won than lost
    const won = out.filter((x) => x === 1).length;
    const lost = out.filter((x) => x === 0).length;
    const yW = won > lost ? 1 : won === lost ? 0.5 : 0;
    const weekPreds: Record<string, number> = {
      simulateur: sim.win + 0.5 * sim.tie,
      poissonIndependant: simP.win + 0.5 * simP.tie,
      forceSansCalendrier: (() => {
        // independent categories from the naive odds: P(more wins) by convolution
        let dist = [1];
        for (const p of naive) {
          const next = new Array(dist.length + 1).fill(0);
          dist.forEach((q, k) => {
            next[k] += q * (1 - p);
            next[k + 1] += q * p;
          });
          dist = next;
        }
        return sum(dist.slice(6)) + 0.5 * dist[5]!;
      })(),
      projectionPonctuelle: (() => {
        const x = preds.projectionPonctuelle!;
        const w2 = x.filter((v) => v === 1).length;
        const l2 = x.filter((v) => v === 0).length;
        return w2 > l2 ? 1 : w2 === l2 ? 0.5 : 0;
      })(),
      pileOuFace: 0.5,
    };
    for (const [m, x] of Object.entries(weekPreds)) obsWeek.push({ week: wk, model: m, se: (x - yW) ** 2, hit: yW === 0.5 || x === 0.5 ? NaN : Number(x > 0.5 === yW > 0.5) });

    // ---- decisions (first league only: they cost a simulation per candidate)
    if (li !== 0) continue;
    const realCats = (team: SimTeam) => {
      const r = new Float64Array(2 * T_LEN);
      realized(data, team, monday, r, 0);
      realized(data, B, monday, r, T_LEN);
      return sum(catOutcomes(r, 0, LTL_LEAGUE));
    };
    const baseCats = sum(out);
    // streaming: free agents = not rostered in this league, a club this week
    const fas: SimSkater[] = [];
    for (const p of proj.sk.values()) {
      if (rostered.has(p.id)) continue;
      const s = skRate(p.id);
      if (s && inS.sk.get(p.id)?.gp) fas.push(s);
    }
    fas.sort((x, y) => y.prio - x.prio);
    const cands = fas.slice(0, args.quick ? 8 : 15);
    if (cands.length && A.skaters.length) {
      const drop = [...A.skaters].sort((x, y) => x.prio - y.prio)[0]!.id;
      const bsim = simulateWeek(A, B, days, { sims: 400, seed, params });
      let best: { id: number; d: number } | null = null;
      for (const c of cands) {
        const r = scoreCandidate(A, B, days, { kind: "skater", p: c }, bsim, { sims: 400, seed, params, fixedDrop: drop });
        if (r && (!best || r.dExpCats > best.d)) best = { id: c.id, d: r.dExpCats };
      }
      const games = (p: SimSkater) => days.filter((d) => d.teams.has(p.team)).length;
      const byGames = [...cands.slice(0, 10)].sort((x, y) => games(y) - games(x) || y.prio - x.prio)[0]!;
      const swapCats = (add: SimSkater) => realCats({ ...A, skaters: [...A.skaters.filter((p) => p.id !== drop), add] }) - baseCats;
      streamGain.outil!.push(best ? swapCats(cands.find((c) => c.id === best!.id)!) : 0);
      streamGain.meilleurAutonome!.push(swapCats(cands[0]!));
      streamGain.plusDeMatchs!.push(swapCats(byGames));
    }
    // goalie plan
    if (A.goalies.length) {
      const plans = goaliePlans(A, B, days, { sims: 400, seed, params });
      const rec = recommendGoaliePlan(plans);
      goalieChosen[String(rec.cap)] = (goalieChosen[String(rec.cap)] ?? 0) + 1;
      goalieGain.push(rec.cap === Infinity ? 0 : realCats({ ...A, goalieCap: rec.cap }) - baseCats);
      const rec0 = recommendGoaliePlan(plans, 0);
      goalieChosen0[String(rec0.cap)] = (goalieChosen0[String(rec0.cap)] ?? 0) + 1;
      goalieGain0.push(rec0.cap === Infinity ? 0 : realCats({ ...A, goalieCap: rec0.cap }) - baseCats);
    }
  }
  const models = ["simulateur", "poissonIndependant", "forceSansCalendrier", "projectionPonctuelle", "pileOuFace"];
  const cat = bootstrap(obsCat, models, "simulateur");
  const week = bootstrap(obsWeek, models, "simulateur");
  const byCat = Object.fromEntries(
    Object.entries(perCat).map(([c, v]) => [c, Object.fromEntries(Object.entries(v.se).map(([m, se]) => [m, r4(se / v.n)]))]),
  );
  const summary = {
    builtAt: new Date().toISOString(),
    script: "scripts/backtest-matchup.ts",
    fitSeasons: FIT_SEASONS,
    testSeasons: TEST_SEASONS,
    leagues: N_LEAGUES,
    sims: SIMS,
    quick: !!args.quick,
    params,
    matchups: obsWeek.length / models.length,
    categoryBrier: cat,
    weekBrier: week,
    byCategory: byCat,
    streaming: Object.fromEntries(Object.entries(streamGain).map(([k, v]) => [k, meanCI(v)])),
    streamingToolMinusBest: meanCI(streamGain.outil!.map((x, i) => x - streamGain.meilleurAutonome![i]!)),
    streamingToolMinusGames: meanCI(streamGain.outil!.map((x, i) => x - streamGain.plusDeMatchs![i]!)),
    goaliePlan: {
      gainVsAlwaysStart: meanCI(goalieGain),
      chosen: goalieChosen,
      noMargin: { gainVsAlwaysStart: meanCI(goalieGain0), chosen: goalieChosen0 },
    },
    calibration: Object.fromEntries(
      Object.entries(calib)
        .filter(([m]) => m === "simulateur" || m === "forceSansCalendrier")
        .map(([m, bins]) => [m, bins.filter((b) => b.n).map((b) => ({ predicted: r4(b.p / b.n), observed: r4(b.y / b.n), n: b.n }))]),
    ),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!args.quick) {
    mkdirSync(join(args.out!, ".."), { recursive: true });
    writeFileSync(args.out!, JSON.stringify(summary, null, 2) + "\n");
    console.log(`wrote ${args.out}`);
  }
}

main();
