/**
 * Day-by-day backtest of the goalie part of the daily in-season update
 * (src/lib/inseason/goalie.ts against src/lib/in-season.ts as published at
 * bd259b2), 2021-22 → 2025-26.
 *
 * Each goalie-season with a prior (Marcel: 3/2/1 over the last three
 * seasons, save % regressed 3,000 shots to the league, wins / shutouts /
 * shots against per game 40 games, games share from the last two seasons)
 * is projected after his team's T-th game (T = 5 … 70) from what was known
 * that day: his games, and his team's games another goalie played. Scored
 * against the rest of his season: games, wins, shutouts, saves, goals
 * against, Slapshot points (W 3, GA −1, SV 0.25, SO 5) and Captains points
 * (W 3, GA −1.5, SV 0.27, SO 3); each rate also at the games he actually
 * played. Methods `pre`, `pace`, `cur`, `new` as in
 * scripts/backtest-in-season.ts; error bars by bootstrap over goalie-seasons;
 * `--tune` re-chooses the constants with leave-one-season-out scores.
 * `--write` stores src/data/ml/in-season-goalie-backtest.json (checked by
 * scripts/test-in-season.ts): `published` the rules the daily update uses,
 * `rules` the ones scored as `new` (with `--tune`, those tuned on every
 * season), `loso` the tuned rules scored on each season left out.
 *
 * Run: npx tsx scripts/backtest-in-season-goalies.ts --cache=<dir> [--tune] [--write]
 */
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { GOALIE_K, GOALIE_SHARE_K, shrinkRate, updatedGameShare } from "../src/lib/in-season";
import { GOALIE_RULES, goalieRestRates, goalieShareNow, type GoalieRules } from "../src/lib/inseason/goalie";
import { DEFAULT_CACHE } from "./fetch-in-season-history";
import { loadGoalieAggregates, loadSeasonGames, prevSeason, seasonTeamGames } from "./in-season-history";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const DIR = arg("cache") ?? process.env.IN_SEASON_CACHE ?? DEFAULT_CACHE;
const TUNE = process.argv.includes("--tune");
const WRITE = process.argv.includes("--write");
const SEASONS = ["20212022", "20222023", "20232024", "20242025", "20252026"];
const CHECKPOINTS = [5, 10, 15, 20, 30, 40, 50, 60, 70];
const BOOT = Number(arg("boot") ?? 400);

interface Prior {
  w: number;
  so: number;
  sa: number;
  sv: number;
  share: number;
}
interface Ck {
  season: string;
  key: string;
  T: number;
  left: number;
  prior: Prior;
  played: boolean[];
  gp: number;
  w: number;
  so: number;
  sv: number;
  sa: number;
  oGames: number;
  oW: number;
  oSo: number;
  oSa: number;
  rest: { gp: number; w: number; so: number; sv: number; sa: number; ga: number };
}

function priors(s: string): Map<number, Prior> {
  const yrs = [1, 2, 3].map((k) => ({ a: loadGoalieAggregates(DIR, prevSeason(s, k)), sched: seasonTeamGames(prevSeason(s, k)), w: [3, 2, 1][k - 1]! }));
  let lsv = 0, lsa = 0, lw = 0, lso = 0, lgp = 0;
  for (const x of yrs[0]!.a.values()) { lsv += x.sv; lsa += x.sa; lw += x.w; lso += x.so; lgp += x.gp; }
  const lg = { sv: lsv / lsa, w: lw / lgp, so: lso / lgp, sa: lsa / lgp };
  const ids = new Set<number>();
  for (const { a } of yrs) for (const id of a.keys()) ids.add(id);
  const out = new Map<number, Prior>();
  for (const id of ids) {
    let sv = 0, sa = 0, w = 0, so = 0, gp = 0;
    for (const { a, w: k } of yrs) {
      const x = a.get(id);
      if (!x) continue;
      sv += k * x.sv; sa += k * x.sa; w += k * x.w; so += k * x.so; gp += k * x.gp;
    }
    const r1 = yrs[0]!.a.get(id), r2 = yrs[1]!.a.get(id);
    const sh1 = r1 ? r1.gp / yrs[0]!.sched : 0, sh2 = r2 ? r2.gp / yrs[1]!.sched : 0;
    out.set(id, {
      sv: (sv + 3000 * lg.sv) / (sa + 3000),
      w: (w + 40 * lg.w) / (gp + 40),
      so: (so + 40 * lg.so) / (gp + 40),
      sa: (sa + 40 * lg.sa) / (gp + 40),
      share: Math.min(0.85, 0.07 + 0.55 * sh1 + 0.2 * sh2),
    });
  }
  return out;
}

function checkpoints(): Ck[] {
  const out: Ck[] = [];
  for (const s of SEASONS) {
    const h = loadSeasonGames(DIR, s);
    const pr = priors(s);
    for (const [id, g] of h.goalies) {
      const prior = pr.get(id);
      if (!prior) continue;
      const team = g.lines[0]!.team;
      const tg = h.teamGames.get(team);
      if (!tg) continue;
      // every goalie line of the team, by game
      const teamLines = new Map<number, Array<{ id: number; w: number; so: number; sa: number }>>();
      for (const [oid, og] of h.goalies) for (const l of og.lines) if (l.team === team) {
        const list = teamLines.get(l.gid) ?? [];
        list.push({ id: oid, w: l.w, so: l.so, sa: l.sa });
        teamLines.set(l.gid, list);
      }
      for (const T of CHECKPOINTS) {
        if (tg.length < T + 5) continue;
        const dT = tg[T - 1]!.date;
        const to = g.lines.filter((l) => l.date <= dT);
        const after = g.lines.filter((l) => l.date > dT);
        const mine = new Set(to.filter((l) => l.team === team).map((l) => l.gid));
        const played = tg.slice(0, T).map((x) => mine.has(x.gid));
        let oGames = 0, oW = 0, oSo = 0, oSa = 0;
        for (const x of tg.slice(0, T)) {
          if (mine.has(x.gid)) continue;
          const ls = teamLines.get(x.gid) ?? [];
          if (!ls.length) continue;
          oGames++;
          for (const l of ls) { oW += l.w; oSo += l.so; oSa += l.sa; }
        }
        const sum = (ls: typeof to, k: "w" | "so" | "sv" | "sa" | "ga") => ls.reduce((t, l) => t + l[k], 0);
        out.push({
          season: s, key: `${s}:${id}`, T, left: tg.length - T, prior, played,
          gp: to.length, w: sum(to, "w"), so: sum(to, "so"), sv: sum(to, "sv"), sa: sum(to, "sa"), oGames, oW, oSo, oSa,
          rest: { gp: after.length, w: sum(after, "w"), so: sum(after, "so"), sv: sum(after, "sv"), sa: sum(after, "sa"), ga: sum(after, "ga") },
        });
      }
    }
  }
  return out;
}

interface Pred { games: number; w: number; so: number; sa: number; sv: number }
type Method = (c: Ck) => Pred;
const methods = (r: GoalieRules): Record<string, Method> => ({
  pre: (c) => ({ games: c.prior.share * c.left, w: c.prior.w, so: c.prior.so, sa: c.prior.sa, sv: c.prior.sv }),
  pace: (c) => (c.gp > 0
    ? { games: (c.gp / c.T) * c.left, w: c.w / c.gp, so: c.so / c.gp, sa: c.sa / c.gp, sv: c.sa > 0 ? c.sv / c.sa : c.prior.sv }
    : { games: 0, w: c.prior.w, so: c.prior.so, sa: c.prior.sa, sv: c.prior.sv }),
  cur: (c) => ({
    games: updatedGameShare(c.prior.share, c.gp, c.T, GOALIE_SHARE_K) * c.left,
    w: shrinkRate(c.prior.w, GOALIE_K.wins, c.w, c.gp),
    so: shrinkRate(c.prior.so, GOALIE_K.shutouts, c.so, c.gp),
    sa: shrinkRate(c.prior.sa, GOALIE_K.shotsAgainstPerGame, c.sa, c.gp),
    sv: shrinkRate(c.prior.sv, GOALIE_K.savePctShots, c.sv, c.sa),
  }),
  new: (c) => {
    const x = goalieRestRates(
      { winsPerGame: c.prior.w, shutoutsPerGame: c.prior.so, shotsAgainstPerGame: c.prior.sa, savePct: c.prior.sv },
      { gp: c.gp, wins: c.w, shutouts: c.so, saves: c.sv, shotsAgainst: c.sa, otherGames: c.oGames, otherWins: c.oW, otherShutouts: c.oSo, otherShotsAgainst: c.oSa },
      r,
    );
    return { games: goalieShareNow(c.prior.share, c.played, r) * c.left, w: x.winsPerGame, so: x.shutoutsPerGame, sa: x.shotsAgainstPerGame, sv: x.savePct };
  },
});

const METRICS = ["slapshot", "captains", "gp", "wins", "shutouts", "saves", "goalsAgainst", "rate:wins", "rate:shutouts", "rate:saves", "rate:goalsAgainst", "slapshotRateOnly"] as const;
type Metric = (typeof METRICS)[number];
function sqErrors(c: Ck, p: Pred): Record<Metric, number> {
  const tot = (g: number) => ({ w: p.w * g, so: p.so * g, sv: p.sa * p.sv * g, ga: p.sa * (1 - p.sv) * g });
  const t = tot(p.games), o = tot(c.rest.gp), a = c.rest;
  const slap = (x: { w: number; so: number; sv: number; ga: number }) => 3 * x.w - x.ga + 0.25 * x.sv + 5 * x.so;
  const capt = (x: { w: number; so: number; sv: number; ga: number }) => 3 * x.w - 1.5 * x.ga + 0.27 * x.sv + 3 * x.so;
  const act = { w: a.w, so: a.so, sv: a.sv, ga: a.ga };
  return {
    slapshot: (slap(t) - slap(act)) ** 2,
    captains: (capt(t) - capt(act)) ** 2,
    gp: (p.games - a.gp) ** 2,
    wins: (t.w - a.w) ** 2,
    shutouts: (t.so - a.so) ** 2,
    saves: (t.sv - a.sv) ** 2,
    goalsAgainst: (t.ga - a.ga) ** 2,
    "rate:wins": (o.w - a.w) ** 2,
    "rate:shutouts": (o.so - a.so) ** 2,
    "rate:saves": (o.sv - a.sv) ** 2,
    "rate:goalsAgainst": (o.ga - a.ga) ** 2,
    slapshotRateOnly: (slap(o) - slap(act)) ** 2,
  };
}

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tune(cks: Ck[], seasons: Set<string>): GoalieRules {
  const idx = cks.map((_, i) => i).filter((i) => seasons.has(cks[i]!.season));
  const rIdx = idx.filter((i) => cks[i]!.rest.gp > 0);
  const best = { ...GOALIE_RULES } as GoalieRules;
  const score = (r: GoalieRules, m: Metric, ix: number[]) => ix.reduce((t, i) => t + sqErrors(cks[i]!, methods(r).new!(cks[i]!))[m], 0);
  const pick = <T,>(cands: T[], f: (x: T) => GoalieRules, m: Metric, ix: number[]) => {
    let b: [number, T] = [Infinity, cands[0]!];
    for (const x of cands) { const e = score(f(x), m, ix); if (e < b[0]) b = [e, x]; }
    return b[1];
  };
  const grid = (ks: number[], ts: number[]) => ks.flatMap((k) => ts.map((team) => ({ k, team })));
  // Every rule re-chosen (the rates on the Slapshot points they score
  // together at the games he played, coordinate by coordinate, two passes;
  // then the games share): its leave-one-season-out score is what decided
  // that none of it ships (GOALIE_RULES).
  for (let pass = 0; pass < 2; pass++) {
    best.wins = pick(grid([10, 20, 30, 45, 60], [0, 0.1, 0.25, 0.5, 0.75, 1]), (w) => ({ ...best, wins: w }), "slapshotRateOnly", rIdx);
    best.shotsAgainst = pick(grid([5, 10, 15, 25, 40], [0, 0.1, 0.25, 0.5, 0.75, 1]), (w) => ({ ...best, shotsAgainst: w }), "slapshotRateOnly", rIdx);
    best.shutouts = pick(grid([50, 100, 200, 400], [0, 0.1, 0.25, 0.5, 1]), (w) => ({ ...best, shutouts: w }), "slapshotRateOnly", rIdx);
    best.savePctShots = pick([750, 1000, 1500, 2000, 3000, 5000], (v) => ({ ...best, savePctShots: v }), "slapshotRateOnly", rIdx);
  }
  const sh = pick([8, 12, 15, 18, 25, 35].flatMap((k) => [0, 5, 10, 15, 20, 30].map((h) => [k, h] as const)), ([k, h]) => ({ ...best, shareK: k, shareHalfLife: h }), "gp", idx);
  best.shareK = sh[0];
  best.shareHalfLife = sh[1];
  return best;
}

/** Fixed variants against the current rules, season by season (what was tried). */
const CUR_RULES: GoalieRules = { wins: { k: GOALIE_K.wins, team: 0 }, shotsAgainst: { k: GOALIE_K.shotsAgainstPerGame, team: 0 }, shutouts: { k: GOALIE_K.shutouts, team: 0 }, savePctShots: GOALIE_K.savePctShots, shareK: GOALIE_SHARE_K, shareHalfLife: 0 };
const VARIANTS: Record<string, GoalieRules> = {
  "wins: team games ×0.75": { ...CUR_RULES, wins: { k: 30, team: 0.75 } },
  "shots against: team games ×0.5": { ...CUR_RULES, shotsAgainst: { k: 15, team: 0.5 } },
  "shutouts: team games ×0.5": { ...CUR_RULES, shutouts: { k: 100, team: 0.5 } },
  "save %: K 1000": { ...CUR_RULES, savePctShots: 1000 },
  "share: K 12, half-life 15": { ...CUR_RULES, shareK: 12, shareHalfLife: 15 },
  "wins + share": { ...CUR_RULES, wins: { k: 30, team: 0.75 }, shareK: 12, shareHalfLife: 15 },
};
function variants(cks: Ck[]) {
  console.log("\n== variants vs current (Slapshot / Captains goalie ROS RMSE, % per season 2021-22 … 2025-26)");
  for (const [name, r] of Object.entries(VARIANTS)) {
    const m = methods(r);
    const per = SEASONS.map((s) => {
      const ix = cks.filter((c) => c.season === s);
      const e = (k: "cur" | "new", f: "slapshot" | "captains") => Math.sqrt(ix.reduce((t, c) => t + sqErrors(c, m[k]!(c))[f], 0) / ix.length);
      return [100 * (e("new", "slapshot") / e("cur", "slapshot") - 1), 100 * (e("new", "captains") / e("cur", "captains") - 1)];
    });
    const won = per.filter((x) => x[0]! < 0).length;
    console.log(`${name.padEnd(34)} slapshot ${per.map((x) => x[0]!.toFixed(2)).join(" ")} | captains ${per.map((x) => x[1]!.toFixed(2)).join(" ")} | won ${won}/5`);
  }
}

function main() {
  const cks = checkpoints();
  console.log(`${cks.length} goalie checkpoints (${new Set(cks.map((c) => c.key)).size} goalie-seasons)`);
  if (process.argv.includes("--variants")) variants(cks);
  let rules: GoalieRules = { ...GOALIE_RULES };
  const loso: Record<string, { cur: number; new: number; rules: GoalieRules }> = {};
  if (TUNE) {
    rules = tune(cks, new Set(SEASONS));
    console.log("tuned on all seasons:", JSON.stringify(rules));
    for (const h of SEASONS) {
      const r = tune(cks, new Set(SEASONS.filter((s) => s !== h)));
      const ix = cks.filter((c) => c.season === h);
      const m = methods(r);
      const e = (k: "cur" | "new") => Math.sqrt(ix.reduce((t, c) => t + sqErrors(c, m[k]!(c)).slapshot, 0) / ix.length);
      loso[h] = { cur: e("cur"), new: e("new"), rules: r };
      console.log(`LOSO ${h}: Slapshot goalie ROS RMSE cur ${loso[h]!.cur.toFixed(2)} → new ${loso[h]!.new.toFixed(2)} (${(100 * (loso[h]!.new / loso[h]!.cur - 1)).toFixed(2)} %) ${JSON.stringify(r)}`);
    }
  }
  const M = methods(rules);
  const names = ["pre", "pace", "cur", "new"] as const;
  const E = Object.fromEntries(names.map((n) => [n, cks.map((c) => sqErrors(c, M[n]!(c)))])) as Record<(typeof names)[number], Array<Record<Metric, number>>>;
  type Cell = { n: number; pre: number; pace: number; cur: number; new: number; vsCur: number; ci: [number, number]; seasonsWon: number };
  const cell = (m: Metric, idx0: number[]): Cell => {
    const idx = m.startsWith("rate") || m === "slapshotRateOnly" ? idx0.filter((i) => cks[i]!.rest.gp > 0) : idx0;
    const r = (n: (typeof names)[number], ix: number[]) => Math.sqrt(ix.reduce((t, i) => t + E[n][i]![m], 0) / Math.max(1, ix.length));
    let won = 0;
    for (const s of SEASONS) { const si = idx.filter((i) => cks[i]!.season === s); if (r("new", si) < r("cur", si)) won++; }
    const groups = new Map<string, number[]>();
    for (const i of idx) { const g = groups.get(cks[i]!.key) ?? []; g.push(i); groups.set(cks[i]!.key, g); }
    const gl = [...groups.values()];
    const sa = gl.map((g) => g.reduce((t, i) => t + E.new[i]![m], 0)), sb = gl.map((g) => g.reduce((t, i) => t + E.cur[i]![m], 0));
    const rand = rng(777);
    const bs: number[] = [];
    for (let k = 0; k < BOOT; k++) { let x = 0, y = 0; for (let j = 0; j < gl.length; j++) { const q = Math.floor(rand() * gl.length); x += sa[q]!; y += sb[q]!; } bs.push(Math.sqrt(x / y) - 1); }
    bs.sort((p, q) => p - q);
    const f = (x: number) => Math.round(x * 1000) / 1000;
    const v = Object.fromEntries(names.map((n) => [n, r(n, idx)])) as Record<(typeof names)[number], number>;
    return { n: idx.length, pre: f(v.pre), pace: f(v.pace), cur: f(v.cur), new: f(v.new), vsCur: f(100 * (v.new / v.cur - 1)), ci: [f(100 * bs[Math.floor(0.025 * BOOT)]!), f(100 * bs[Math.floor(0.975 * BOOT)]!)], seasonsWon: won };
  };
  const all = cks.map((_, i) => i);
  const summary: Record<string, Record<string, Cell>> = {};
  for (const m of METRICS) {
    summary[m] = { all: cell(m, all) };
    for (const T of CHECKPOINTS) summary[m]![`T${T}`] = cell(m, all.filter((i) => cks[i]!.T === T));
  }
  const line = (label: string, c: Cell) =>
    `${label.padEnd(22)} n=${String(c.n).padStart(5)}  pre ${c.pre.toFixed(2).padStart(7)}  pace ${c.pace.toFixed(2).padStart(7)}  cur ${c.cur.toFixed(2).padStart(7)}  new ${c.new.toFixed(2).padStart(7)}  new/cur ${c.vsCur >= 0 ? "+" : ""}${c.vsCur.toFixed(2)} % [${c.ci[0].toFixed(2)}, ${c.ci[1].toFixed(2)}]  seasons ${c.seasonsWon}/5`;
  for (const m of METRICS) {
    console.log(`\n== goalies ${m} (rest-of-season RMSE)`);
    console.log(line("all checkpoints", summary[m]!.all!));
    for (const T of CHECKPOINTS) console.log(line(`after team game ${T}`, summary[m]![`T${T}`]!));
  }
  if (WRITE) {
    const path = join(process.cwd(), "src", "data", "ml", "in-season-goalie-backtest.json");
    writeFileAtomic(path, `${JSON.stringify({ generatedAt: new Date().toISOString(), generatedBy: "scripts/backtest-in-season-goalies.ts", seasons: SEASONS, checkpoints: CHECKPOINTS, goalieSeasons: new Set(cks.map((c) => c.key)).size, published: GOALIE_RULES, rules, current: { goalieK: GOALIE_K, shareK: GOALIE_SHARE_K }, summary, loso }, null, 1)}\n`);
    console.log(`wrote ${path}`);
  }
}

main();
