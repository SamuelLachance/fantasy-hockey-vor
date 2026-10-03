/**
 * The weekly categories simulator (src/lib/matchup): its arithmetic, its
 * invariants, and the guard on its backtest (scripts/backtest-matchup.ts):
 * the committed parameters are the ones the committed backtest scored, and
 * that backtest still beats its baselines, and the committed sample of its
 * matchups (scripts/fixtures/matchup-backtest-sample.json) re-simulated with
 * the CURRENT engine gives the backtest's score. Re-run the backtest after
 * any change to the simulator or its parameters, or this fails.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { slotPickIds, toSimGoalie, toSimSkater } from "../src/lib/matchup/board-adapter";
import { MATCHUP_PARAMS } from "../src/lib/matchup/params";
import { addDays, clubsByDate, mondayOf, weekDays } from "../src/lib/matchup/schedule";
import {
  baseTotals,
  CATS,
  negBin,
  poisson,
  simulateWeek,
  winIntercept,
  type SimDay,
  type SimGoalie,
  type SimSkater,
  type SimTeam,
} from "../src/lib/matchup/simulate";
import { goaliePlans, recommendGoaliePlan, scoreCandidate, withSwap } from "../src/lib/matchup/stream";
import { mulberry32 } from "../src/lib/dynasty/rng";
import type { DraftBoard } from "../src/lib/draft/board-types";
import { scoreMatchupFixture, type MatchupFixture } from "./backtest-fixtures";

let failures = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    failures++;
    console.error(`FAIL ${msg}`);
  }
}
const near = (a: number, b: number, tol: number, msg: string) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

// ---- variates
{
  const rng = mulberry32(1);
  let s = 0;
  let s2 = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) {
    const x = poisson(rng, 3);
    s += x;
    s2 += x * x;
  }
  near(s / n, 3, 0.06, "Poisson mean");
  near(s2 / n - (s / n) ** 2, 3, 0.15, "Poisson variance");
  let t = 0;
  let t2 = 0;
  for (let i = 0; i < n; i++) {
    const x = negBin(rng, 3, 4);
    t += x;
    t2 += x * x;
  }
  near(t / n, 3, 0.08, "negative binomial mean");
  near(t2 / n - (t / n) ** 2, 3 + 9 / 4, 0.35, "negative binomial variance μ + μ²/k");
}

// ---- a week
const sk = (id: number, team: string, pos: string, rate: number, prio = 1): SimSkater => ({
  id,
  name: `S${id}`,
  team,
  pos: [pos],
  rate: [0.3 * rate, 0.45 * rate, 0.2 * rate, 2.6 * rate, 1.5 * rate, 1.0 * rate],
  prio,
});
const gk = (id: number, team: string, start = 0.6): SimGoalie => ({ id, name: `G${id}`, team, start, w: 0.52, ga: 2.8, sa: 28, prio: start });
const CLUBS = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH"];
function team(offset: number, rate = 1): SimTeam {
  const pos = ["C", "C", "LW", "LW", "RW", "RW", "C", "D", "D", "D", "D", "D", "LW", "RW"];
  return {
    skaters: pos.map((p, i) => sk(offset + i, CLUBS[(i + offset) % CLUBS.length]!, p, rate, 10 - i * 0.1)),
    goalies: [gk(offset + 50, CLUBS[offset % 8]!), gk(offset + 51, CLUBS[(offset + 3) % 8]!)],
  };
}
const week: SimDay[] = Array.from({ length: 7 }, (_, d) => ({
  date: `2026-10-${String(12 + d).padStart(2, "0")}`,
  teams: new Set(CLUBS.filter((_, i) => (i + d) % 2 === 0)),
}));
{
  const a = team(0);
  const b = team(100);
  // the same players under other ids (same clubs, same rates): a fair coin
  const mirror: SimTeam = {
    skaters: a.skaters.map((p) => ({ ...p, id: p.id + 1000 })),
    goalies: a.goalies.map((g, i) => ({ ...g, id: g.id + 1000, team: CLUBS[(i + 5) % 8]! })),
  };
  const r = simulateWeek(a, mirror, week, { sims: 3000, seed: "t" });
  near(r.win + r.tie / 2, 0.5, 0.06, "mirror teams: a coin flip");
  near(r.expCats, 5, 0.35, "mirror teams: 5 categories");
  const again = simulateWeek(a, mirror, week, { sims: 3000, seed: "t" });
  assert(again.win === r.win && again.expCats === r.expCats, "seeded: the same answer twice");
  // a stronger team wins more
  const strong = simulateWeek(team(0, 1.4), b, week, { sims: 2000, seed: "s" });
  const weak = simulateWeek(team(0, 0.7), b, week, { sims: 2000, seed: "s" });
  assert(strong.win > 0.6 && weak.win < 0.4, `strength moves the odds (${strong.win}, ${weak.win})`);
  for (const c of strong.cats.slice(0, 6)) assert(c.mine > c.theirs, `stronger team has more ${c.cat}`);
  // no goalie: loses GAA and SV% (below the minimum), cannot win W or SHO
  const noG = simulateWeek({ ...a, goalies: [] }, b, week, { sims: 1000, seed: "g" });
  for (const cat of ["GAA", "SVP", "W", "SHO"]) {
    const c = noG.cats.find((x) => x.cat === cat)!;
    assert(c.win === 0, `no goalie: ${cat} never won`);
  }
  assert(noG.apps.mine === 0 && noG.apps.pMinMine === 0, "no goalie: no appearance");
  // common random numbers: changing side A leaves side B's draws alone
  const swapped = withSwap(a, { kind: "skater", p: sk(999, "AAA", "C", 1.2, 20) }, a.skaters[13]!.id);
  const r1 = simulateWeek(a, b, week, { sims: 500, seed: "crn" });
  const r2 = simulateWeek(swapped, b, week, { sims: 500, seed: "crn" });
  for (let i = 0; i < CATS.length; i++) {
    const x = r1.cats[i]!.theirs;
    const y = r2.cats[i]!.theirs;
    assert(Object.is(x, y) || Math.abs(x - y) < 1e-12, `CRN: the opponent's ${CATS[i]} unchanged`);
  }
  // the week so far adds to the totals
  const base = baseTotals({ G: 5, A: 8, PPP: 3, SOG: 40, HIT: 20, BLK: 15, W: 2, SHO: 1, apps: 3, gaa: 2, svp: 0.92 });
  near(base[7]!, 6, 1e-9, "base: GA = GAA × appearances");
  near(base[8]!, 75, 1e-6, "base: SA = GA ÷ (1 − SV%)");
  const withBase = simulateWeek({ ...a, base }, b, week, { sims: 1000, seed: "b" });
  const noBase = simulateWeek(a, b, week, { sims: 1000, seed: "b" });
  near(withBase.cats[0]!.mine - noBase.cats[0]!.mine, 5, 1e-9, "base goals added");
  assert(withBase.apps.mine > noBase.apps.mine + 2.9, "base appearances added");
  // decisions
  const plans = goaliePlans(a, b, week, { sims: 400, seed: "p" });
  assert(plans.length === 4 && plans.some((p) => p.cap === Infinity), "goalie plans: the four caps");
  assert(recommendGoaliePlan(plans).expCats >= plans.find((p) => p.cap === Infinity)!.expCats - 1e-9, "goalie plan: never worse than always start");
  const busy = sk(777, "AAA", "C", 1.6, 30);
  const sc = scoreCandidate(a, b, week, { kind: "skater", p: busy }, noBase, { sims: 1000, seed: "b" });
  assert(sc != null && sc.dExpCats > 0, "streaming: a better skater helps");
}

// ---- win intercept
{
  const a = winIntercept(0.55, 2.7);
  // E[W] by simulation of one start through simulateWeek: a lone goalie every day
  const g: SimGoalie = { id: 1, name: "g", team: "AAA", start: 1, w: 0.55, ga: 2.7, sa: 28, prio: 1 };
  const days: SimDay[] = Array.from({ length: 7 }, (_, d) => ({ date: `d${d}`, teams: new Set(["AAA"]) }));
  const r = simulateWeek({ skaters: [], goalies: [g] }, { skaters: [], goalies: [] }, days, { sims: 4000, seed: "w" });
  near(r.cats.find((c) => c.cat === "W")!.mine / 7, 0.55, 0.02, `win rate calibrated (a=${a.toFixed(2)})`);
  near(r.cats.find((c) => c.cat === "GAA")!.mine, 2.7, 0.08, "GAA = goals against per start");
}

// ---- schedule
{
  const games: Array<[string, string, string]> = [
    ["2026-10-13T23:00:00Z", "MTL", "TOR"], // Tue evening Eastern
    ["2026-10-14T02:30:00Z", "VAN", "EDM"], // Tue night Eastern (Wed UTC)
    ["2026-10-14T23:00:00Z", "TOR", "BOS"],
  ];
  const by = clubsByDate(games);
  assert(by.get("2026-10-13")?.has("EDM") && by.get("2026-10-13")?.size === 4, "league date: a late game counts on its Eastern day");
  const days = weekDays(by, "2026-10-12", "2026-10-18");
  assert(days.length === 7 && days[2]!.b2b!.has("TOR"), "back-to-back flagged on the second night");
  assert(mondayOf("2026-10-18") === "2026-10-12" && mondayOf("2026-10-12") === "2026-10-12" && addDays("2026-10-31", 1) === "2026-11-01", "week arithmetic");
}

// ---- the published board converts
{
  const board = JSON.parse(readFileSync(join(process.cwd(), "public", "leagues", "light-the-lamp", "board.json"), "utf8")) as DraftBoard;
  const sks = board.players.map(toSimSkater).filter((x) => x != null);
  const gks = board.players.map(toSimGoalie).filter((x) => x != null);
  assert(sks.length > 200 && gks.length > 30, "board: skaters and goalies convert");
  for (const s of sks) assert(s!.rate.every((x) => x >= 0 && x < 8) && s!.pos.length > 0, `board skater ${s!.name}: sane rates`);
  for (const g of gks) {
    assert(g!.start > 0 && g!.start <= 0.92, `goalie ${g!.name}: start share`);
    assert(g!.ga > 1 && g!.ga < 5 && g!.sa > 18 && g!.sa < 40 && g!.w > 0 && g!.w < 0.8, `goalie ${g!.name}: per-start rates`);
  }
  const state = { v: 1 as const, slot: 3, picks: Array.from({ length: 30 }, (_, i) => ({ id: 1000 + i, mine: false })) };
  // slot 3 of 12: picks 3, 22 (round 2 reversed), 27 (round 3)
  const ids = slotPickIds(state, 3, 12);
  assert(JSON.stringify(ids) === JSON.stringify([1002, 1021, 1026]), `draft slot picks: ${ids}`);
}

// ---- the backtest guard
{
  const summary = JSON.parse(readFileSync(join(process.cwd(), "src", "data", "matchup", "backtest-summary.json"), "utf8"));
  const norm = (o: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null || v === Infinity ? "inf" : v])));
  assert(norm(summary.params) === norm(MATCHUP_PARAMS as unknown as Record<string, unknown>), "params.ts = the parameters the committed backtest scored (re-run scripts/backtest-matchup.ts)");
  assert(!summary.quick && summary.matchups >= 1000, "a full backtest is committed");
  const cat = summary.categoryBrier;
  for (const base of ["forceSansCalendrier", "pileOuFace", "projectionPonctuelle"]) {
    assert(cat[base].dRefCI[0] > 0, `category Brier: the simulator beats ${base} (95 % CI above 0)`);
    assert(summary.weekBrier[base].dRefCI[0] > 0, `week Brier: the simulator beats ${base}`);
  }
  // the rate uncertainty (params.kRate*) pays: the full simulator beats its Poisson ablation on categories
  assert(cat.poissonIndependant.dRefCI[0] > 0, "category Brier: the simulator beats its Poisson ablation (95 % CI)");
  assert(summary.weekBrier.poissonIndependant.dRef > 0, "week Brier: the simulator beats its Poisson ablation");
  // reliability: every tenth with 250+ categories within 6 points of what happened
  for (const b of summary.calibration.simulateur as Array<{ predicted: number; observed: number; n: number }>) {
    if (b.n >= 250) assert(Math.abs(b.predicted - b.observed) <= 0.06, `calibration: predicted ${b.predicted}, observed ${b.observed} (n ${b.n})`);
  }
  // the tab quotes the committed backtest
  const tab = readFileSync(join(process.cwd(), "src", "components", "matchup", "DuelTab.tsx"), "utf8").replace(/\s+/g, " ");
  const fr2 = (x: number) => x.toFixed(2).replace(".", ",");
  const nfr = (n: number) => n.toLocaleString("fr-CA").replace(/\s/g, " ");
  assert(tab.includes(`${fr2(summary.streamingToolMinusBest.mean)} catégorie de plus par semaine`), "DuelTab quotes the streaming gain of the committed backtest");
  assert(tab.includes(`sur ${nfr(summary.matchups)} duels rejoués`), "DuelTab quotes the number of backtested duels");
  const near75 = (summary.calibration.simulateur as Array<{ predicted: number; observed: number }>).find((b) => b.predicted >= 0.7 && b.predicted < 0.8)!;
  const near25 = (summary.calibration.simulateur as Array<{ predicted: number; observed: number }>).find((b) => b.predicted >= 0.2 && b.predicted < 0.3)!;
  assert(tab.includes(`autour de 75 % ont été gagnées ${Math.round(near75.observed * 100)} %`) && tab.includes(`autour de 25 %, ${Math.round(near25.observed * 100)} %`), "DuelTab quotes the calibration of the committed backtest");
  assert(summary.streamingToolMinusBest.ci[0] > 0, "streaming: the simulator's pick beats the best-value free agent (95 % CI)");
  assert(summary.streaming.outil.mean > summary.streaming.plusDeMatchs.mean, "streaming: the simulator's pick beats « most games » on average");
  // the tab states the comparison with « most games » too, significant or not, and what the test leagues were
  const g = summary.streamingToolMinusGames as { mean: number; ci: [number, number] };
  const signedFr = (x: number) => `${x >= 0 ? "+" : "−"}${fr2(Math.abs(x))}`;
  const gamesQuote =
    g.ci[0] > 0
      ? `et ${fr2(g.mean)} catégorie de plus que l’autonome qui a le plus de matchs`
      : `mais pas mieux, de façon significative, que de prendre l’autonome qui a le plus de matchs parmi les 10 meilleurs (${signedFr(g.mean)} catégorie, intervalle de ${signedFr(g.ci[0])} à ${signedFr(g.ci[1])})`;
  assert(tab.includes(gamesQuote), `DuelTab quotes the streaming gain against « most games »: « ${gamesQuote} »`);
  assert(tab.includes("ligues fictives") && tab.includes("Marcel") && tab.includes("pas les données de Light the Lamp"), "DuelTab says the backtest leagues were synthetic, drafted from Marcel");
  // the goalie plan: the backtest never validated stopping early; the tab says so
  const gp = summary.goaliePlan as { gainVsAlwaysStart: { ci: [number, number]; n: number }; noMargin: { gainVsAlwaysStart: { mean: number; ci: [number, number] } } };
  if (gp.gainVsAlwaysStart.ci[0] <= 0 && gp.noMargin.gainVsAlwaysStart.ci[0] <= 0) {
    const q = `sur ${nfr(gp.gainVsAlwaysStart.n)} semaines rejouées, arrêter plus tôt n’a pas battu « toujours aligner » de façon significative`;
    assert(tab.includes(q), `DuelTab says the stop-early advice is not validated: « ${q} »`);
  }

  // the committed sample, re-simulated with the current engine and parameters
  const fx = JSON.parse(readFileSync(join(process.cwd(), "scripts", "fixtures", "matchup-backtest-sample.json"), "utf8")) as MatchupFixture;
  assert(fx.builtAt === summary.builtAt, "the matchup sample comes from the committed backtest run (re-run scripts/backtest-matchup.ts)");
  const now = scoreMatchupFixture(fx.matchups, MATCHUP_PARAMS, fx.score.sims);
  assert(now.n === fx.score.n && now.n >= 120, `the matchup sample holds the backtest's matchups (${now.n})`);
  near(now.brier.simulateur, fx.score.brier.simulateur, 1e-7, "matchup sample re-simulated with the current engine: category Brier (engine changed? re-run scripts/backtest-matchup.ts)");
  near(now.brier.forceSansCalendrier, fx.score.brier.forceSansCalendrier, 1e-7, "matchup sample: the baseline's Brier");
  assert(now.brier.simulateur < now.brier.forceSansCalendrier && now.brier.simulateur < now.brier.pileOuFace, `matchup sample: the simulator beats « force sans calendrier » and the coin (${JSON.stringify(now.brier)})`);
}

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log("OK: matchup simulator");
