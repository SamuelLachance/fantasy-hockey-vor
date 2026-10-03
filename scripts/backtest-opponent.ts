/**
 * Does tonight's opponent move a player's fantasy points beyond his own
 * rate? Off CI, on the NHL box scores of `mgmt-sim.ts`. For every skater
 * game (and goalie start) of 2021-22..2025-26, the engine's expectation that
 * morning (`Knowledge.view`: his shrunk rate to date) times
 * opponentIndex ^ beta, where the index is what the opponent has allowed to
 * date (Captains points of the skaters facing it per game; for goalies, the
 * goalie points it has conceded per start), shrunk toward the league with
 * `--k` games, over the league's to-date mean; and a home factor. beta and
 * the home factor are fit on 2021-24 and scored on 2024-26: mean squared
 * error against beta = 0, paired by game day (95 % CI over days).
 *
 * Run: npx tsx scripts/backtest-opponent.ts --cache=<dir> [--k=10] [--source=fp|ga]
 */
import { readFileSync } from "fs";
import { join } from "path";
import { Knowledge, loadSeason, meanCi } from "./mgmt-sim";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const CACHE = arg("cache") ?? process.env.MGMT_CACHE;
if (!CACHE) {
  console.error("--cache=<dir> is required (see mgmt-sim.ts)");
  process.exit(1);
}
const K = Number(arg("k") ?? 10);
/** --source=ga: the skaters' index from the opponent's goals against per game (what the standings give live). */
const SOURCE = arg("source") ?? "fp";
const TRAIN = ["20212022", "20222023", "20232024"];
const TEST = ["20242025", "20252026"];
/* eslint-disable @typescript-eslint/no-explicit-any */
const raw = (f: string): any[] => {
  const j = JSON.parse(readFileSync(join(CACHE!, f), "utf8"));
  return Array.isArray(j) ? j : j.data;
};

interface Row {
  season: string;
  day: number;
  g: boolean;
  base: number;
  idx: number;
  home: boolean;
  y: number;
}

function rowsOf(sid: string): Row[] {
  const s = loadSeason(CACHE!, sid);
  const k = new Knowledge(s);
  const dayOf = new Map(s.dates.map((d, i) => [d, i]));
  const opp = new Map<string, { opp: string; home: boolean }>();
  for (const r of raw(`nhlstats-skater-summary-${sid}-game.json`)) opp.set(`${r.playerId}|${dayOf.get(r.gameDate)}`, { opp: r.opponentTeamAbbrev, home: r.homeRoad === "H" });
  for (const r of raw(`nhlstats-goalie-summary-${sid}-game.json`)) opp.set(`${r.playerId}|${dayOf.get(r.gameDate)}`, { opp: r.opponentTeamAbbrev, home: r.homeRoad === "H" });
  // Per day: points allowed by each club (skaters facing it) and conceded to goalies by it.
  const skAllowed = new Map<string, number>(); // `${team}|${day}` -> sum of opposing skaters' points
  const glAgainst = new Map<string, number>(); // `${team}|${day}` -> goalie points of the goalies facing it (starts)
  for (const [id, games] of s.sk)
    for (const g of games) {
      const o = opp.get(`${id}|${g.day}`);
      if (!o) continue;
      const key = `${o.opp}|${g.day}`;
      skAllowed.set(key, (skAllowed.get(key) ?? 0) + g.off + g.dx);
    }
  for (const [id, games] of s.gl)
    for (const g of games) {
      if (g.gs < 1) continue;
      const o = opp.get(`${id}|${g.day}`);
      if (!o) continue;
      glAgainst.set(`${o.opp}|${g.day}`, (glAgainst.get(`${o.opp}|${g.day}`) ?? 0) + g.fp);
    }
  // To-date running totals per club, by day.
  const teams = [...s.teamDays.keys()];
  const cum = (m: Map<string, number>) => {
    const out = new Map<string, number[]>(); // team -> [sum before day d] (index by day)
    const games = new Map<string, number[]>();
    for (const t of teams) {
      const sums: number[] = [];
      const ns: number[] = [];
      let sum = 0;
      let n = 0;
      for (let d = 0; d < s.dates.length; d++) {
        sums.push(sum);
        ns.push(n);
        const v = m.get(`${t}|${d}`);
        if (v !== undefined) {
          sum += v;
          n++;
        }
      }
      out.set(t, sums);
      games.set(t, ns);
    }
    return { out, games };
  };
  const sk = cum(SOURCE === "ga" ? s.goalsAgainst : skAllowed);
  const gl = cum(glAgainst);
  const index = (c: ReturnType<typeof cum>, team: string, d: number) => {
    let ls = 0;
    let ln = 0;
    for (const t of teams) {
      ls += c.out.get(t)![d]!;
      ln += c.games.get(t)![d]!;
    }
    if (ln < teams.length * 3) return 1;
    const avg = ls / ln;
    const own = (c.out.get(team)![d]! + K * avg) / (c.games.get(team)![d]! + K);
    return own / avg;
  };
  const rows: Row[] = [];
  for (const [id, games] of s.sk)
    for (const g of games) {
      const o = opp.get(`${id}|${g.day}`);
      if (!o) continue;
      const v = k.view(id, g.day);
      if (!v.team) continue;
      rows.push({ season: sid, day: g.day, g: false, base: v.off + v.dx, idx: index(sk, o.opp, g.day), home: o.home, y: g.off + g.dx });
    }
  for (const [id, games] of s.gl)
    for (const g of games) {
      if (g.gs < 1) continue;
      const o = opp.get(`${id}|${g.day}`);
      if (!o) continue;
      const v = k.view(id, g.day);
      rows.push({ season: sid, day: g.day, g: true, base: v.off, idx: index(gl, o.opp, g.day), home: o.home, y: g.fp });
    }
  return rows;
}

const all: Row[] = [];
for (const sid of [...TRAIN, ...TEST]) {
  const r = rowsOf(sid);
  all.push(...r);
  console.log(`${sid}: ${r.length} rows`);
}
const pred = (r: Row, beta: number, home: number) => r.base * Math.pow(r.idx, beta) * (r.home ? 1 + home : 1 - home);
for (const goalie of [false, true]) {
  const train = all.filter((r) => r.g === goalie && TRAIN.includes(r.season));
  const test = all.filter((r) => r.g === goalie && TEST.includes(r.season));
  let best = { beta: 0, home: 0, mse: Number.POSITIVE_INFINITY };
  for (let beta = -0.5; beta <= 2.0001; beta += 0.1)
    for (let home = -0.05; home <= 0.0801; home += 0.01) {
      let se = 0;
      for (const r of train) se += (r.y - pred(r, beta, home)) ** 2;
      if (se / train.length < best.mse) best = { beta, home, mse: se / train.length };
    }
  // Paired by game day on the test seasons.
  const byDay = new Map<string, number[]>();
  for (const r of test) {
    const d = (r.y - pred(r, best.beta, best.home)) ** 2 - (r.y - pred(r, 0, 0)) ** 2;
    const key = `${r.season}|${r.day}`;
    (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(d);
  }
  const perDay = [...byDay.values()].map((xs) => xs.reduce((a, b) => a + b, 0) / xs.length);
  const c = meanCi(perDay);
  const base = test.reduce((a, r) => a + (r.y - pred(r, 0, 0)) ** 2, 0) / test.length;
  // The spread the index gives between the easiest and the hardest opponents.
  const idx = test.map((r) => r.idx).sort((a, b) => a - b);
  const q = (p: number) => idx[Math.floor(p * (idx.length - 1))]!;
  console.log(
    `${goalie ? "goalies" : "skaters"}: fit on 2021-24 beta ${best.beta.toFixed(1)}, home ±${(best.home * 100).toFixed(0)} %; 2024-26 MSE ${base.toFixed(3)} -> change ${c.mean.toFixed(4)} [${c.lo.toFixed(4)}, ${c.hi.toFixed(4)}] per row (days n=${c.n}); ` +
      `index p10 ${q(0.1).toFixed(3)} p90 ${q(0.9).toFixed(3)} -> factor ${(q(0.1) ** best.beta).toFixed(3)} .. ${(q(0.9) ** best.beta).toFixed(3)}`,
  );
}
