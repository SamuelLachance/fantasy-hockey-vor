/**
 * Slapshot league profile (src/lib/dynasty/slapshot.ts): salary projection
 * (known seasons, extensions that start later, entry-level deals, projected
 * next AAV), the salary-model fit, replacement from the seat fill, the cap
 * shadow price λ, the owner's options each season (play / minors / drop),
 * the French sentence, and the league-1 simulation unchanged (golden values;
 * the full league-1 dynasty.json was also rebuilt byte-identical).
 * Also validates public/fantrax/slapshot/dynasty.json when present.
 * Run: npx tsx scripts/test-dynasty-slapshot.ts [--golden]
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { makeLevel } from "../src/lib/dynasty/aging";
import { parseParams, type DynastyParams } from "../src/lib/dynasty/params";
import { makeRetention } from "../src/lib/dynasty/retention";
import { mean } from "../src/lib/dynasty/rng";
import { replacement } from "../src/lib/dynasty/scale";
import { simulatePlayer, type SimContext, type SimLeague, type SimPlayer } from "../src/lib/dynasty/simulate";
import {
  capLambda,
  capSeries,
  contractPath,
  explainSlapshotFr,
  fitSalaryModel,
  goalieFpg,
  lambdaBySeason,
  lambdaPath,
  nhlCapOf,
  parseSlapshotProfile,
  playerReplacement,
  predictCapPct,
  replacementLevels,
  rosterSpotCost,
  skaterFpg,
  type KnownContract,
  type SalaryRow,
  type SeatPlayer,
  type SlapshotProfile,
  type SlapshotRecord,
} from "../src/lib/dynasty/slapshot";
import { knownContract, parseSigned } from "./dynasty-slapshot";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const root = process.cwd();
const params: DynastyParams = parseParams(JSON.parse(readFileSync(join(root, "src", "data", "dynasty", "params.json"), "utf8")));
const prof: SlapshotProfile = parseSlapshotProfile(
  JSON.parse(readFileSync(join(root, "src", "data", "dynasty", "slapshot", "league.json"), "utf8")),
);
const level = makeLevel(params);
const ret = makeRetention(params);
const repl = replacement(params);
const Y0 = params.firstSeasonYear;
const T = params.T;

// ---------------------------------------------------------------- scoring
{
  // 40 G, 50 A, 30 PPP, 250 SOG in 80 GP; SHG = 0.0283 x goals
  const f = skaterFpg(prof, "F", { gp: 80, goals: 40, assists: 50, shots: 250, ppp: 30 });
  const expect = (3.5 * 40 + 2.5 * 50 + 0.5 * 30 + 0.0283 * 40 + 0.25 * 250) / 80;
  assert(near(f, expect, 1e-9), `skater FP/G ${f} = ${expect} (hits and blocks score 0)`);
  // 30 W, 3 SO, 1500 SV at .910 in 55 GP: GA = 1500 x .09 / .91
  const g = goalieFpg(prof, { gp: 55, wins: 30, shutouts: 3, saves: 1500, savePct: 0.91 });
  const ga = (1500 * 0.09) / 0.91;
  assert(near(g, (3 * 30 + 0.25 * 1500 - ga + 5 * 3) / 55 + 3 * 0.0185, 1e-9), `goalie FP/G ${g} derives GA from saves and sv%`);
}

// ---------------------------------------------------------------- cap series
{
  const cs = capSeries(prof, Y0, T);
  assert(cs.league[0] === 105, `league cap 2026-27 = 105 (got ${cs.league[0]})`);
  assert(near(cs.league[1]!, (105 * 113.5) / 104, 1e-3), `2027-28 follows the NHL 113.5 (got ${cs.league[1]})`);
  assert(near(cs.league[2]! / cs.league[1]!, 1 + prof.cap.growthAfter, 1e-4), "then grows by growthAfter");
  assert(cs.min[0] === prof.cap.minSalary && cs.min[3]! > cs.min[0]!, "league minimum grows with the cap");
  assert(near(nhlCapOf(prof, 2029), 113.5 * (1 + prof.cap.growthAfter) ** 2, 1e-9), "NHL cap extrapolated after 2027-28");
  // the training contracts' own first-season caps (2023-24 83.5, 2024-25 88.0), never the earliest listed one
  assert(nhlCapOf(prof, 2023) === 83.5 && nhlCapOf(prof, 2024) === 88, "real 2023-24 and 2024-25 NHL caps");
  let threw = false;
  try {
    nhlCapOf(prof, 2022);
  } catch {
    threw = true;
  }
  assert(threw, "a year before the cap table throws instead of borrowing the earliest cap");
  const lam = lambdaPath(2, cs);
  assert(near(lam[0]!, 2, 1e-12) && near(lam[5]! * cs.league[5]!, 2 * 105, 1e-9), "λ held per share of the cap");
}

// ---------------------------------------------------------------- known contracts
{
  // capwages rows: an extension that starts in 2027-28 after the ELC (Celebrini-like)
  const cw = {
    n: "X",
    slug: "x",
    segs: [
      { type: "Standard Contract (Extension)", exp: "UFA", signed: "Jul. 29, 2026", seasons: [[2027, 18.8e6], [2028, 18.8e6], [2029, 18.8e6]] as Array<[number, number]> },
      { type: "Entry-Level Contract", exp: "RFA", signed: "Jul. 6, 2024", seasons: [[2024, 975e3], [2025, 975e3], [2026, 975e3]] as Array<[number, number]> },
    ],
  };
  const k = knownContract(cw, Y0);
  assert(k.source === "capwages" && k.elc, "capwages rows, current ELC flagged");
  assert(k.seasons["2026"] === 0.975 && k.seasons["2027"] === 18.8 && k.seasons["2029"] === 18.8, "2026-27 is the ELC, the extension from 2027-28");
  assert(k.exp === "UFA", "status at the end of the last signed season");
  // a newer contract ends an older one: a bought-out deal's later seasons do not count
  const bo = knownContract(
    {
      n: "Y",
      slug: "y",
      segs: [
        { type: "Standard Contract", exp: "UFA", signed: "Jul. 1, 2025", seasons: [[2025, 3e6]] },
        { type: "Standard Contract", exp: "UFA", signed: "Jul. 1, 2019", seasons: [[2019, 9e6], [2025, 9e6], [2026, 9e6]] },
      ],
    },
    Y0,
  );
  assert(bo.seasons["2026"] == null, "a bought-out contract's 2026-27 row is ignored");
  // no capwages row: nothing signed (the profiles' `contract` field shows an
  // extension as the current cap hit, so it never sets a season)
  const none = knownContract(undefined, Y0);
  assert(none.source === "none" && !Object.keys(none.seasons).length, "no capwages row: nothing signed");
  assert(parseSigned("Sept. 1, 2024") === Date.UTC(2024, 8, 1) && parseSigned("Jul. 29, 2026") === Date.UTC(2026, 6, 29), "signing dates parse");
}

// ---------------------------------------------------------------- salary model and paths
const rows: SalaryRow[] = [];
{
  // synthetic market: ln pct = -4.6 + 1.7 ln θ − 0.08 max(0, 26 − age) + 0.5 ln share (+ noise), goalies apart
  let s = 7;
  const u = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 600; i++) {
    const theta = 1 + 4 * u();
    const age = 20 + 16 * u();
    const share = 0.4 + 0.6 * u();
    const g = u() < 0.3 ? ("D" as const) : ("F" as const);
    const ln = -4.6 + 1.7 * Math.log(theta) - 0.08 * Math.max(0, 26 - age) + 0.5 * Math.log(share) + 0.05 * (u() - 0.5);
    rows.push({ g, pct: Math.exp(ln), age, theta, share, rfa: age < 25 });
  }
  for (let i = 0; i < 120; i++) {
    const theta = 3.5 + 1.5 * u();
    const share = 0.2 + 0.6 * u();
    const age = 22 + 14 * u();
    rows.push({ g: "G", pct: Math.exp(-3.8 + 0.55 * Math.log(theta * share) + 0.03 * (u() - 0.5)), age, theta, share, rfa: false });
  }
}
const model = fitSalaryModel(rows);
{
  assert(model.skater.r2 > 0.95 && model.goalie.r2 > 0.9, `fit recovers a synthetic market (R² ${model.skater.r2.toFixed(3)} / ${model.goalie.r2.toFixed(3)})`);
  const lt = model.skater.features.indexOf("ln theta");
  assert(near(model.skater.beta[lt]!, 1.7, 0.15), `ln θ elasticity ≈ 1.7 (got ${model.skater.beta[lt]!.toFixed(3)})`);
  const p1 = predictCapPct(prof, model, { g: "F", age: 28, theta: 4, share: 0.9, rfa: false });
  const p2 = predictCapPct(prof, model, { g: "F", age: 28, theta: 2, share: 0.9, rfa: false });
  assert(p1 > p2 && p1 <= prof.contracts.maxPct && p2 >= prof.contracts.minPct, "AAV share rises with the level, inside the bounds");
  assert(predictCapPct(prof, model, { g: "F", age: 28, theta: 40, share: 1, rfa: false }) === prof.contracts.maxPct, "clamped at maxPct");
  assert(predictCapPct(prof, model, { g: "F", age: 34, theta: 40, share: 1, rfa: false }) === prof.contracts.oldMaxPct, "lower ceiling when signing at 30+");

  // PPML: exp(x·β) is the mean share, so the fitted shares add up to the actual ones
  const sumPct = rows.reduce((s, r) => s + r.pct, 0);
  const sumPred = rows.reduce((s, r) => s + predictCapPct(prof, model, r), 0);
  assert(near(sumPred / sumPct, 1, 0.02), `PPML predictions sum to the actual shares (${(sumPred / sumPct).toFixed(4)})`);

  const theta = new Array<number>(T).fill(4);
  const signed: KnownContract = { seasons: { "2026": 12.5, "2027": 12.5 }, exp: "UFA", elc: false, source: "capwages" };
  const c = contractPath(prof, model, Y0, T, { g: "F", age0: 29.5, known: signed, theta, share: 0.9, arrival: Y0 });
  assert(c.cap[0] === 12.5 && c.cap[1] === 12.5 && c.known === 2 && c.expiry === 2028, "signed seasons kept, expiry = first unsigned season");
  const pct = predictCapPct(prof, model, { g: "F", age: 29.5 + 2 - 0.25, theta: 4, share: 0.9, rfa: false });
  assert(near(c.cap[2]!, Math.round(pct * nhlCapOf(prof, 2028) * 1000) / 1000, 1e-9), "next AAV = predicted share × that season's NHL cap");
  assert(c.nextAav === c.cap[2] && c.status === "UFA", "next AAV and status reported");
  const term = c.cap.slice(2).filter((x) => x === c.cap[2]).length;
  assert(term >= 1 && term <= 5, `projected term by age (${term} seasons)`);
  // an unsigned prospect arriving in 2028-29: ELC for 3 seasons from arrival
  const pr = contractPath(prof, model, Y0, T, {
    g: "F",
    age0: 18.5,
    known: { seasons: {}, exp: null, elc: false, source: "none" },
    theta: theta.map((x, t) => (t >= 2 ? 3 : 0)),
    share: 0.87,
    arrival: 2028,
    rookie: true,
  });
  assert(pr.cap.slice(2, 5).every((x) => x === prof.cap.elcCapHit) && pr.expiry === 2031 && pr.status === "RFA", "prospect: ELC from arrival, then RFA");
  assert(pr.cap[0] === 0 && pr.cap[1] === 0 && !pr.elc, "no cap hit before his arrival (no NHL contract yet)");
  const rk = contractPath(prof, model, Y0, T, { g: "F", age0: 18.8, known: { seasons: {}, exp: null, elc: false, source: "none" }, theta, share: 0.87, arrival: Y0, rookie: true });
  assert(rk.cap[0] === prof.cap.elcCapHit && rk.elc, "a 2026 draftee in the NHL now plays on an ELC");
}

// ---------------------------------------------------------------- replacement and λ
const mini: SlapshotProfile = {
  ...prof,
  league: { ...prof.league, teams: 4 },
  roster: { ...prof.roster, active: { C: 1, LW: 1, RW: 1, D: 2, G: 1 }, reserve: 1 },
  replacement: { ...prof.replacement, unseatedAvg: 1, goalieUnseatedAvg: 1 },
};
function league(capOf: (i: number) => number): SeatPlayer[] {
  const out: SeatPlayer[] = [];
  const pos: Array<SeatPlayer["pos"]> = [["C"], ["LW"], ["RW"], ["D"], ["D"], ["G"], ["C", "LW"]];
  for (let i = 0; i < 70; i++) out.push({ id: `p${String(i).padStart(2, "0")}`, pos: pos[i % pos.length]!, fp: 300 - 4 * i, cap: capOf(i) });
  return out;
}
{
  const pool = league(() => 1);
  const rep = replacementLevels(mini, pool, 70);
  // 4 teams × C1: C-eligible players in value order are p00 (C), p06 (C/LW) …; the fill seats the best 4 C and 4 LW
  assert(rep.season.C > 0 && rep.season.D > 0 && rep.G > 0, "replacement at every position");
  assert(near(rep.perGame.C, rep.season.C / 70, 1e-12), "per game = season ÷ a regular's games");
  assert(playerReplacement(rep, "F", ["C", "LW"]) === Math.min(rep.perGame.C, rep.perGame.LW), "multi-eligible: the lowest replacement");
  assert(playerReplacement(rep, "G", ["G"]) === rep.G, "goalies per slot");

  const loose = capLambda(mini, pool, 100, 0.85);
  assert(loose.aggregate === 0 && loose.snake.mean === 0, "a loose cap costs nothing (λ = 0)");
  // stars cost 12 M$, depth 1 M$: a team of 7 counting players under 30 M$ must shed stars
  const star = (i: number) => (i < 16 ? 12 : 1);
  const tight = capLambda(mini, league(star), 30, 0.85);
  const tighter = capLambda(mini, league(star), 24, 0.85);
  assert(tight.aggregate > 0 && tight.snake.mean > 0, `a binding cap has a positive price (aggregate ${tight.aggregate.toFixed(2)}, snake ${tight.snake.mean.toFixed(2)})`);
  assert(tighter.aggregate >= tight.aggregate && tighter.snake.mean >= tight.snake.mean, "λ rises as the cap tightens");
  assert(tight.capUsedAt0 > tight.budget, "the points-optimal set overshoots a binding budget");
  const cs = capSeries(prof, Y0, T);
  const bySeason = lambdaBySeason({ ...mini, lambda: { ...mini.lambda, solvedSeasons: 1 } }, cs, [league(star), league(() => 1)]);
  assert(near(bySeason.lambda[0]!, bySeason.diag[0]!.snake.mean, 1e-12), "season 0 solved");
  assert(near(bySeason.lambda[1]!, (bySeason.lambda[0]! * cs.league[0]!) / cs.league[1]!, 1e-12), "after the solved seasons λ is held per share of the cap");
  assert(near(rosterSpotCost([100, 50, 20, 10], 3, 0.75), 5, 1e-12), "roster-spot rent = marginal asset × (1 − δ)");
}

// ---------------------------------------------------------------- the owner's options each season
const ctx = (over: Partial<SimContext> = {}): SimContext => ({ p: params, level, ret, repl, K: 0, N: 400, keepGate: false, seedKey: "|slap|t", ...over });
const vet = (lg: SimLeague | undefined, over: Partial<SimPlayer> = {}): SimPlayer => ({
  id: "v",
  g: "F",
  age0: 28,
  birthDate: null,
  gp0: 500,
  eligNow: false,
  path: "nhl",
  theta0: 3,
  share0: 0.9,
  sigma0: 0.1,
  trajShift: 0,
  ...(lg ? { lg } : {}),
  ...over,
});
const lgOf = (capCost: number[], over: Partial<SimLeague> = {}): SimLeague => ({ k: 0.7, r: 0.6, rG: 30, capCost, ...over });
{
  const games = params.games.seasonGames * 0.9;
  const value0 = (0.7 * 3 - 0.6) * games;
  // test mode: σ0 = 0, share fixed → season 0 exactly
  const noCap = simulatePlayer(vet(lgOf(new Array(T).fill(0))), ctx({ fixedYear0: true }));
  assert(near(mean(noCap.gain[0]!), value0, 1e-6), `season 0 = (k θ − r) × games (${mean(noCap.gain[0]!).toFixed(2)} vs ${value0.toFixed(2)})`);
  const charge = 40;
  const withCap = simulatePlayer(vet(lgOf(new Array(T).fill(charge))), ctx({ fixedYear0: true }));
  assert(near(mean(withCap.gain[0]!), value0 - charge, 1e-6), "a cap charge below the value is paid in full");
  // a contract bigger than his value: stashed in the minors (0), never negative
  const bad = simulatePlayer(vet(lgOf(new Array(T).fill(value0 * 3))), ctx());
  assert(bad.gain.every((a) => a.every((x) => x === 0)), "value below the cap charge → minors: 0 points, 0 cap, never negative");
  // the roster-spot rent with the keep / drop gate: at worst −m a season, and dropped when nothing is left
  const m = 3;
  const gated = simulatePlayer(vet(lgOf(new Array(T).fill(value0 * 3), { noEligibility: true })), ctx({ keepGate: true, K: m, Kgate: m }));
  assert(gated.gain.every((a) => a.every((x) => x >= -m - 1e-9)), "a bad contract costs at most the roster spot");
  assert(gated.gain.slice(1).every((a) => mean(a) === 0) && gated.keptAt[1] === 0, "worthless every season → dropped at the first September");
  const good = simulatePlayer(vet(lgOf(new Array(T).fill(0), { noEligibility: true }), { age0: 25 }), ctx({ keepGate: true, K: m, Kgate: m }));
  assert(good.keptAt[1]! > 0.95 && near(mean(good.gain[1]!), mean(good.vorPre[1]!) - m * good.keptAt[1]!, 1e-6), "a useful player is kept and pays the rent");
  // a skater's charge follows his active share (IR / minors when he does not play)
  const cheap = simulatePlayer(vet(lgOf(new Array(T).fill(charge)), { share0: 0.45 }), ctx({ fixedYear0: true }));
  const v45 = (0.7 * 3 - 0.6) * params.games.seasonGames * 0.45;
  assert(near(mean(cheap.gain[0]!), Math.max(0, v45 - charge * (0.45 / params.games.regShareMean)), 1e-6), "partial season: charge × share / regular share");
  // goalies: per season slot, charge for the whole season
  const g = simulatePlayer(
    vet(lgOf(new Array(T).fill(10), { k: 1.2 }), { g: "G", theta0: 4.5, share0: 0.6, sigma0: 0.1 }),
    ctx({ fixedYear0: true }),
  );
  assert(near(mean(g.gain[0]!), 1.2 * 4.5 * params.games.seasonGames * 0.6 - 30 - 10, 1e-6), "goalie: k θ starts − slot replacement − charge");
}

// ---------------------------------------------------------------- league 1 unchanged (golden)
{
  const players: SimPlayer[] = [
    vet(undefined, { id: "g1", age0: 24, theta0: 3.4, gRel: [1, 1.04, 1.06], spYoung: 0.1, sigma0: 0.14 }),
    vet(undefined, { id: "g2", g: "D", age0: 31, theta0: 2.9, gp0: 700 }),
    vet(undefined, { id: "g3", g: "G", age0: 29, theta0: 4.2, share0: 0.62, gp0: 300 }),
    vet(undefined, { id: "g4", age0: 20, gp0: 30, eligNow: true, theta0: 2.6, share0: 0.7 }),
  ];
  const got = players.map((pl) => {
    const r = simulatePlayer(pl, { ...ctx(), K: 41.6, Kgate: 33.5, keepGate: true, N: 300, seedKey: "|dyn|v1" });
    return r.gain.map((a) => mean(a).toFixed(6)).join(",");
  });
  if (process.argv.includes("--golden")) console.log(JSON.stringify(got, null, 1));
  const golden = JSON.parse(readFileSync(join(root, "scripts", "fixtures", "dynasty-league1-golden.json"), "utf8")) as string[];
  got.forEach((x, i) => assert(x === golden[i], `league-1 simulation unchanged for golden player ${i + 1}`));
}

// ---------------------------------------------------------------- sentence
{
  const rec = {
    n: "X",
    g: "F",
    pos: ["C"],
    age: 20.3,
    path: "nhl",
    phase: "prime",
    effAge: 20,
    gp: 150,
    dv: { winNow: 380, balanced: 950, longTerm: 1800 },
    rank: { winNow: 2, balanced: 1, longTerm: 1 },
    band: { balanced: [700, 950, 1200], longTerm: [1200, 1800, 2400] },
    eG: [250, 245, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240],
    p50G: new Array(12).fill(240),
    eFP: new Array(12).fill(300),
    fp0: 305,
    trend: 0.01,
    pNhl: 1,
    eta: null,
    contract: {
      cap: [0.98, 18.8, 18.8, 18.8, 18.8, 18.8, 25, 25, 25, 25, 25, 25],
      signed: 6,
      expiry: 2032,
      status: "UFA",
      nextAav: 25,
      elc: true,
      capShare: 0.009,
      capFP: [0, 16, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7],
      source: "capwages",
    },
    market: { w: 0 },
    explanation: "",
  } as unknown as SlapshotRecord;
  const s = explainSlapshotFr(rec);
  assert(s.length > 0 && s.length <= 240, `sentence length ${s.length}`);
  assert(/0,98 M\$ en 2026-27, puis 18,8 M\$ signés jusqu’en 2031-32/.test(s), `extension starting later is spelled out: ${s}`);
  assert(!/Snake|Boisvert/i.test(s), "no scout names");
}

// ---------------------------------------------------------------- the published snapshot
{
  const f = join(root, "public", "fantrax", "slapshot", "dynasty.json");
  if (existsSync(f)) {
    const s = JSON.parse(readFileSync(f, "utf8")) as {
      params: { lambda: number[]; rosterSpot: { cost: number }; T: number };
      players: Record<string, SlapshotRecord>;
    };
    const P = Object.values(s.players);
    assert(P.length > 800, `snapshot has ${P.length} players`);
    assert(s.params.lambda.length === s.params.T && s.params.lambda.every((x) => Number.isFinite(x) && x >= 0), "λ per season, finite, ≥ 0");
    const floor = -s.params.rosterSpot.cost - 0.051;
    const bad = P.filter(
      (r) =>
        r.eG.length !== s.params.T ||
        r.contract.cap.length !== s.params.T ||
        ![...Object.values(r.dv), ...r.eG, ...r.contract.cap].every(Number.isFinite) ||
        r.eG.some((x) => x < floor) ||
        !r.explanation,
    );
    assert(bad.length === 0, `${bad.length} malformed records (${bad.slice(0, 3).map((r) => r.n).join(", ")})`);
    for (const m of ["winNow", "balanced", "longTerm"] as const) {
      const ranks = P.map((r) => r.rank[m]).sort((a, b) => a - b);
      assert(new Set(ranks).size === ranks.length, `unique ${m} ranks`);
    }
  }
}

if (failed) process.exit(1);
console.log("OK: dynasty Slapshot profile (scoring, cap, salary model, λ, minors / drop options, league-1 golden, sentence, snapshot)");
