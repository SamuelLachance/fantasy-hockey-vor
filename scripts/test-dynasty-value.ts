/**
 * Value-level checks on synthetic players (2,000 paths): monotonicity in
 * talent and age, the aging guard, keeper cost and eligibility, release,
 * prospects, exact modes, goalie slots, captain premium, the market layer
 * and the French explanation.
 * Run: npx tsx scripts/test-dynasty-value.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { makeLevel } from "../src/lib/dynasty/aging";
import { explainFr, growthClauseFr, modelTrend, nearShare, PHASE_FR, rosterHintFr } from "../src/lib/dynasty/explain";
import { buildDynasty, type DynastyInput } from "../src/lib/dynasty/index";
import { applyMarket, blend, type MarketMember } from "../src/lib/dynasty/market";
import { parseParams, type DynastyParams } from "../src/lib/dynasty/params";
import { makeRetention } from "../src/lib/dynasty/retention";
import { replacement } from "../src/lib/dynasty/scale";
import { simulatePlayer, type SimContext, type SimPlayer } from "../src/lib/dynasty/simulate";
import { MODES, type DynastyRecord, type Mode } from "../src/lib/dynasty/types";
import { discount, modeWeights, summarize } from "../src/lib/dynasty/value";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const params: DynastyParams = parseParams(
  JSON.parse(readFileSync(join(process.cwd(), "src", "data", "dynasty", "params.json"), "utf8")),
);
const level = makeLevel(params);
const ret = makeRetention(params);
const repl = replacement(params);
const modes = modeWeights(params);
const N = 2000;
const K = 41.6;
const ctx = (over: Partial<SimContext> = {}): SimContext => ({
  p: params,
  level,
  ret,
  repl,
  K,
  N,
  keepGate: true,
  seedKey: "|dyn|v1",
  ...over,
});
const skater = (over: Partial<SimPlayer> = {}): SimPlayer => ({
  id: "s",
  g: "F",
  age0: 27,
  birthDate: null,
  gp0: 400,
  eligNow: false,
  path: "nhl",
  theta0: 3.2,
  share0: 0.9,
  sigma0: 0.1,
  elite: false,
  ...over,
});
const value = (pl: SimPlayer, over: Partial<SimContext> = {}) => summarize(simulatePlayer(pl, ctx(over)), modes);
/** Games a share of the season gives (projections are shares of 82 games, the season has 84). */
const gamesOf = (projGp: number) => (params.games.seasonGames * projGp) / params.games.projectionBasis;

// ---- 1. DV rises with θ0 (same seed)
{
  const lo = value(skater({ theta0: 2.8 }));
  const hi = value(skater({ theta0: 3.4 }));
  for (const m of MODES) assert(hi.dv[m] > lo.dv[m], `DV ${m} rises with θ0 (${lo.dv[m].toFixed(1)} → ${hi.dv[m].toFixed(1)})`);
}

// ---- 2. age at equal θ0 and GP
{
  const lt = (age: number) => value(skater({ age0: age, theta0: 3.3 })).dv.longTerm;
  const a27 = lt(27);
  const a31 = lt(31);
  const a35 = lt(35);
  assert(a27 > a31 && a31 > a35, `DV long-term 27 > 31 > 35 (${a27.toFixed(0)}, ${a31.toFixed(0)}, ${a35.toFixed(0)})`);
}

// ---- 3. aging guard (the market-design inflation must never come back)
{
  for (const age of [27, 29, 32, 35]) {
    for (const th of [2.8, 3.5, 4.5]) {
      const v = value(skater({ id: `g${age}-${th}`, age0: age, theta0: th, elite: th >= params.eliteTheta.value }));
      assert(v.eG[3]! <= 1.03 * v.eG[1]! + 1, `age ${age} θ ${th}: eG3 ${v.eG[3]!.toFixed(1)} ≤ 1.03 eG1 ${v.eG[1]!.toFixed(1)} + 1`);
      for (let t = 2; t < 12; t++) {
        assert(v.eG[t]! <= v.eG[t - 1]! * 1.05 + 2, `age ${age} θ ${th}: eG non-increasing after t=1 (t=${t})`);
      }
    }
  }
}

// ---- 4. keeper cost
{
  const withK = value(skater({ theta0: 3.0 }));
  const noK = value(skater({ theta0: 3.0 }), { K: 0 });
  for (const m of MODES) assert(noK.dv[m] >= withK.dv[m], `DV with K = 0 ≥ DV with K (${m})`);
}

// ---- 5. eligible next year ≥ not eligible
{
  const young = { age0: 21, birthDate: "2005-06-01", theta0: 2.9, share0: 0.8, sigma0: 0.14 };
  const elig = value(skater({ ...young, gp0: 20, eligNow: true }));
  const nonElig = value(skater({ ...young, gp0: 150, eligNow: false }));
  assert(elig.pElig[1]! > 0.5 && nonElig.pElig[1] === 0, "eligibility set-up");
  for (const m of MODES) assert(elig.dv[m] >= nonElig.dv[m], `eligible-next-year ≥ non-eligible (${m})`);
}

// ---- 6. release is forever
{
  const big = simulatePlayer(skater({ theta0: 3.0 }), ctx({ N: 50, K: 1e9 }));
  let ok = true;
  for (let t = 1; t < 12; t++) {
    // vorPre is recorded before the gate: the release season still shows it
    for (let n = 0; n < 50; n++) if (big.gain[t]![n] !== 0 || (t >= 2 && big.vorPre[t]![n] !== 0)) ok = false;
  }
  assert(ok, "a player nobody keeps is worth 0 after the first cutdown");
  const r = simulatePlayer(skater({ theta0: 2.7, age0: 31 }), ctx({ N: 200 }));
  let bad = 0;
  for (let n = 0; n < 200; n++) {
    let released = false;
    for (let t = 1; t < 12; t++) {
      if (released && (r.gain[t]![n] !== 0 || r.vorPre[t]![n] !== 0)) bad++;
      if (!released && r.vorPre[t]![n] > 0 && r.gain[t]![n] === 0) released = true;
    }
  }
  assert(bad === 0, `after release every later G_t is 0 (${bad} violations)`);
}

// ---- 7. prospects
{
  const pros = (pMake: number, mu: number) =>
    value({
      id: "p",
      g: "F",
      age0: 18.5,
      birthDate: "2008-04-01",
      gp0: 0,
      eligNow: true,
      path: "prospect",
      pm: { pMake, pi: { mu, sd: 0.6 }, eta: 2027 },
    });
  const base = pros(0.5, 3.0);
  assert(pros(0.9, 3.0).dv.longTerm > base.dv.longTerm, "prospect DV rises with pMake");
  assert(pros(0.5, 3.6).dv.longTerm > base.dv.longTerm, "prospect DV rises with the prime level");
  assert(near(base.pMade, 0.5, 0.04), `pMake is honoured (${base.pMade})`);
  assert(base.eG[0]! < 1, "no value before arrival (eta 2027 ± jitter)");
}

// ---- 8. modes are exact from eG
{
  const v = value(skater({ age0: 24, theta0: 3.5 }));
  for (const m of MODES) {
    assert(near(discount(v.eG, modes[m]), v.dv[m], 1e-6), `Σ w δ^t eG = dv[${m}]`);
  }
  const band = v.band.balanced;
  assert(band[0] <= band[1] && band[1] <= band[2], "bands ordered");
}

// ---- 9. goalie season-slot replacement
{
  const goalie = (starts: number, gE: number) =>
    value(
      { id: "g", g: "G", age0: 29, birthDate: null, gp0: 300, eligNow: false, path: "nhl", theta0: gE, share0: starts / 82, sigma0: 0.1 },
      { fixedYear0: true },
    );
  assert(goalie(20, 4.8).eG[0] === 0, "20-start backup at 4.8: below the 128 slot line → 0");
  const starter = goalie(60, 4.3).eG[0]!;
  assert(near(starter, 4.3 * 60 - 128, 5), `60-start goalie at 4.3 ≈ 130 (${starter.toFixed(1)})`);
}

// ---- 10. captain premium (forwards only)
{
  const games = gamesOf(75);
  const f = value(skater({ theta0: 5.0, share0: 75 / 82 }), { fixedYear0: true }).eG[0]!;
  const cap = 0.5 * (5.0 - repl.offRef) * games;
  assert(near(f, (5.0 - repl.F) * games + cap, 1), `F θ 5.0, 75 projected GP: VOR + CAP ${((5.0 - repl.F) * games + cap).toFixed(1)} (got ${f.toFixed(1)})`);
  const d = value(skater({ g: "D", theta0: 5.0, share0: 75 / 82 }), { fixedYear0: true }).eG[0]!;
  assert(near(d, (5.0 - repl.D) * games, 1e-6), "a D is never captain");
}

// ---- 14. an 84-game season: games = 84 × the projected share of 82
{
  const r = simulatePlayer(skater({ theta0: 3.2, share0: 70 / 82 }), ctx({ fixedYear0: true, keepGate: false }));
  assert(near(r.games[0]!, gamesOf(70), 1e-9), `70 projected GP → ${gamesOf(70).toFixed(1)} games in 2026-27 (got ${r.games[0]!.toFixed(2)})`);
}

// ---- 15. no games cliff after year 0: a durable full-timer keeps his share (less role risk)
{
  for (const age of [20, 23, 27]) {
    const r = simulatePlayer(skater({ id: `dur${age}`, age0: age, theta0: 3.2, share0: 77 / 82 }), ctx({ keepGate: false, N: 4000 }));
    const drop = r.games[1]! / r.games[0]!;
    assert(drop >= 0.94, `77 projected GP at ${age}: E[games] ${r.games[0]!.toFixed(1)} → ${r.games[1]!.toFixed(1)} (≥ 94%, ~92.8% before the carry)`);
  }
}

// ---- 16. a current injury / suspension trims season 0 only
{
  const g = (avail0: number) =>
    value({ id: "hel", g: "G", age0: 33.4, birthDate: null, gp0: 600, eligNow: false, path: "nhl", theta0: 4.35, share0: 58 / 82, sigma0: 0.1, avail0 });
  const healthy = g(1);
  for (const a of [0.95, 0.88, 0.75]) {
    const hurt = g(a);
    assert(hurt.dv.balanced >= 0.8 * healthy.dv.balanced, `58-GP goalie with status ${a}: ${hurt.dv.balanced.toFixed(0)} ≥ 80% of healthy ${healthy.dv.balanced.toFixed(0)}`);
    assert(near(hurt.eG[1]!, healthy.eG[1]!, 1e-9), `status ${a}: 2027-28 untouched`);
  }
}

// ---- 17. mid-season: GP already played + the rest of the season = the full-season case
{
  const share0 = 60 / 82;
  const base = skater({ id: "mid", age0: 20.5, birthDate: "2006-03-01", gp0: 45, eligNow: true, theta0: 2.8, share0, sigma0: 0.14 });
  const full = simulatePlayer(base, ctx({ fixedYear0: true }));
  const half = simulatePlayer({ ...base, gp0: 45 + 0.5 * gamesOf(60), remainingShare: 0.5 }, ctx({ fixedYear0: true }));
  assert(half.eligAt[1] === full.eligAt[1] && full.eligAt[1] === 0, `P(eligible 2027) unchanged mid-season (${half.eligAt[1]} vs ${full.eligAt[1]})`);
  const vFull = summarize(full, modes);
  const vHalf = summarize(half, modes);
  assert(vFull.trend != null && vHalf.trend === vFull.trend, `the quoted trend ignores the season left (${vHalf.trend} vs ${vFull.trend})`);
}

// ---- 18. the quoted trend follows the level curve, not games
{
  const tr = (age: number, share0: number) => value(skater({ id: `tr${age}`, age0: age, theta0: 3.2, share0 })).trend!;
  assert(tr(20, 77 / 82) > 0 && tr(22.5, 77 / 82) > 0, "rising / entering-prime players quote a positive trend even when projected for 77 GP");
  assert(Math.abs(tr(24.5, 77 / 82)) < 0.015, "prime players quote about 0");
  assert(tr(31, 60 / 82) < 0 && tr(35, 60 / 82) < tr(31, 60 / 82), "decline deepens with age");
  assert(near(tr(22, 77 / 82), tr(22, 55 / 82), 1e-12), "the trend does not depend on projected games");
}

// ---- 13. year-0 identity (test mode) and option value with noise on
{
  const gp = gamesOf(70);
  for (const th of [2.6, 3.2, 4.4]) {
    const pl = skater({ id: `y0-${th}`, theta0: th, share0: 70 / 82 });
    const exact = Math.max(0, (th - repl.F) * gp + 0.5 * Math.max(0, th - repl.offRef) * gp);
    const fixed = value(pl, { fixedYear0: true }).eG[0]!;
    assert(near(fixed, exact, 1e-9), `year-0 identity θ ${th}: ${fixed.toFixed(3)} = ${exact.toFixed(3)}`);
    const noisy = value(pl).eG[0]!;
    assert(noisy >= 0.97 * exact, `noise adds option value, not less (θ ${th}: ${noisy.toFixed(1)} vs ${exact.toFixed(1)})`);
    if (th - repl.F >= 0.3) assert(noisy <= 1.3 * exact, `option value bounded (θ ${th}: ${noisy.toFixed(1)} ≤ 1.3 × ${exact.toFixed(1)})`);
  }
}

// ---- 11. market layer (level-neutral, one ladder per segment)
{
  const dv = (x: number): Record<Mode, number> => ({ winNow: x, balanced: x, longTerm: x });
  const mem: MarketMember[] = [
    { id: "a", pool: "P", seg: "prospect", ros: 90, dvModel: dv(100) },
    { id: "b", pool: "P", seg: "prospect", ros: 60, dvModel: dv(50) },
    { id: "b2", pool: "P", seg: "prospect", ros: 95, dvModel: dv(20) },
    { id: "c", pool: "P", seg: "prospect_slot", ros: 95, dvModel: dv(10) },
    { id: "c2", pool: "P", seg: "prospect_slot", ros: 50, dvModel: dv(30) },
    // NHL-path minors-eligible youngster: Ros% loves him, but he never anchors prospects
    { id: "y", pool: "P", seg: "young_nhl", ros: 99, dvModel: dv(5) },
    { id: "d", pool: "P", seg: "fringe", ros: 70, dvModel: dv(0) },
    { id: "e", pool: "P", seg: "fringe", dvModel: dv(0) },
    { id: "f", pool: "S", seg: "young_nhl", adp: 20, dvModel: dv(80) },
    { id: "g", pool: "S", seg: "established", adp: 10, dvModel: dv(30) },
    { id: "h1", pool: "G", seg: "G_est", g: "G", adp: 50, dvModel: dv(200) },
    { id: "h2", pool: "G", seg: "G_est", g: "G", adp: 30, dvModel: dv(100) },
  ];
  const zero: DynastyParams = { ...params, market: { ...params.market, weights: Object.fromEntries(Object.keys(params.market.weights).map((k) => [k, 0])) } };
  const off = applyMarket(zero, mem);
  assert(mem.every((m) => off.get(m.id)!.dv.balanced === m.dvModel.balanced), "w = 0 → the model exactly");
  const one: DynastyParams = { ...params, market: { ...params.market, weights: { ...params.market.weights, prospect: 1 } } };
  const full = applyMarket(one, mem);
  // prospect ladder: Ros order b2(95) a(90) b(60); model order 100, 50, 20 → a sits 2nd → 50
  assert(near(full.get("a")!.dv.balanced, 50, 1e-9), `w = 1 → the anchored quantile of his own segment (${full.get("a")!.dv.balanced})`);
  assert(near(full.get("b2")!.dv.balanced, 100, 1e-9) && near(full.get("b")!.dv.balanced, 20, 1e-9), "the NHL-path youngster (Ros 99) takes no prospect anchor");
  const on = applyMarket(params, mem);
  // level-neutral: the mean log-shift of a segment is 0 (uncapped moves)
  const shift = (ids: string[]) =>
    ids.reduce((s, id) => s + Math.log(on.get(id)!.dv.balanced + 10) - Math.log(mem.find((m) => m.id === id)!.dvModel.balanced + 10), 0) / ids.length;
  assert(Math.abs(shift(["a", "b", "b2"])) < 1e-9, `prospect segment level unchanged (mean log shift ${shift(["a", "b", "b2"]).toExponential(2)})`);
  assert(Math.abs(shift(["c", "c2"])) < 1e-9, "draft-slot segment level unchanged");
  assert(Math.abs(shift(["h1", "h2"])) < 1e-9, "goalie segment level unchanged");
  const c = on.get("c")!;
  assert(c.dv.balanced > 10 && c.dv.balanced < 30, `draft-slot prospect pulled toward his segment price (${c.dv.balanced.toFixed(1)})`);
  const a = on.get("a")!;
  assert(a.dv.balanced <= 100 && (a.dv.balanced + 10) / (100 + 10) >= 1 / 2.5 - 1e-9, "cap ×/÷2.5 when w < 0.5");
  assert(on.get("y")!.dv.balanced === 5 && on.get("y")!.w === 0, "NHL-path eligible players are never blended");
  assert(on.get("e")!.dv.balanced === 0, "fringe without a signal → 0");
  // fringe d (Ros 70) sits after b2, c (95) and a (90) on the skater prospect ladder 100, 50, 30, 20, 10 → 20
  assert(near(on.get("d")!.dv.balanced, 20, 1e-9), `fringe with a Ros% signal → the prospect ladder value (${on.get("d")!.dv.balanced})`);
  assert(on.get("f")!.dv.balanced === 80 && on.get("g")!.dv.balanced === 30, "NHL skaters are never blended");
  const disabled = applyMarket(params, mem, false);
  assert(mem.every((m) => disabled.get(m.id)!.dv.balanced === m.dvModel.balanced), "market disabled → the model");
  assert(near(blend(params, 40, 4000, 0.45), (40 + 10) * 2.5 - 10, 1e-9), "cap binds on a large gap");
  assert(near(blend(params, 40, 4000, 1), 4000, 1e-9), "no cap at w = 1");
  // pool-wide gap (information): P by Ros y 99, b2 / c 95, a 90 → a is 4th; model rank 1st
  assert(on.get("a")!.rank === 4 && on.get("a")!.gap === 3, `gap = pool market rank − pool model rank (${on.get("a")!.rank}, ${on.get("a")!.gap})`);
  // one posterior factor for every mode
  const tilted: MarketMember[] = [
    { id: "p1", pool: "P", seg: "prospect", ros: 99, dvModel: { winNow: 6, balanced: 10, longTerm: 20 } },
    { id: "p2", pool: "P", seg: "prospect", ros: 50, dvModel: { winNow: 40, balanced: 60, longTerm: 90 } },
  ];
  const t = applyMarket(params, tilted).get("p1")!;
  const k = t.dv.balanced / 10;
  assert(k > 1 && near(t.dv.winNow, 6 * k, 1e-9) && near(t.dv.longTerm, 20 * k, 1e-9), "every mode moves by the balanced factor");
}

// ---- end to end on a small league + 12. explanation
{
  const vet = (id: string, age: number, off: number, gp = 78): DynastyInput => ({
    id,
    n: `Vet ${id}`,
    e: "C,F,Skt",
    team: "BOS",
    birthDate: `${2026 - age}-03-01`,
    careerGp: 600,
    proj: { src: "proj", gp, off, dx: 0, method: "ml" },
    eligNow: false,
    ros: 90,
    adp: 50,
    rostered: true,
  });
  const players: DynastyInput[] = [
    ...Array.from({ length: 200 }, (_, i) => vet(`v${i}`, 24 + (i % 14), 3.0 + (i % 17) * 0.12)),
    {
      id: "kid",
      n: "Kid Prospect",
      e: "C,F,Skt",
      team: null,
      birthDate: "2008-01-15",
      careerGp: 0,
      prospect: {
        n: "Kid Prospect",
        pos: "F",
        nhlGP: 0,
        pMake: 0.9,
        pSource: "test",
        fpgIfMake: { mu: 3.6, sd: 0.6 },
        eta: 2026,
        comp: { fpDraft: 3.4 },
      },
      draft: { year: 2026, pick: 1 },
      eligNow: true,
      ros: 97,
      rostered: false,
    },
    // more prospects so the market layer moves some (their own segment ladder)
    ...Array.from({ length: 8 }, (_, i): DynastyInput => ({
      id: `pr${i}`,
      n: `Prospect ${i}`,
      e: i % 3 === 0 ? "D,Skt" : "C,F,Skt",
      team: null,
      birthDate: "2007-06-01",
      careerGp: 0,
      prospect: {
        n: `Prospect ${i}`,
        pos: i % 3 === 0 ? "D" : "F",
        nhlGP: 0,
        pMake: 0.2 + 0.08 * i,
        pSource: "test",
        fpgIfMake: { mu: 2.6 + 0.1 * i, sd: 0.6 },
        eta: 2027 + (i % 3),
        comp: { fpDraft: 3 },
      },
      eligNow: true,
      ros: 90 - 9 * ((i * 5) % 8),
      rostered: false,
    })),
    // a young NHL regular, a 2024 #10 pick (rising: his growth driver is quoted even at 78 GP)
    { ...vet("young", 20, 3.4), birthDate: "2006-05-01", careerGp: 160, draft: { year: 2024, pick: 10 }, draftSource: "profile" },
  ];
  const res = buildDynasty(
    { players, meta: { valuesFetchedAt: "2026-09-25T00:00:00Z", stateFetchedAt: "2026-09-25T00:00:00Z", projectionsAt: "2026-08-11T00:00:00Z", prospectsBuiltAt: "2026-09-25T00:00:00Z" } },
    params,
    { paths: 300 },
  );
  const again = buildDynasty(
    { players, meta: { valuesFetchedAt: "2026-09-25T00:00:00Z", stateFetchedAt: "2026-09-25T00:00:00Z", projectionsAt: "2026-08-11T00:00:00Z", prospectsBuiltAt: "2026-09-25T00:00:00Z" } },
    params,
    { paths: 300 },
  );
  assert(JSON.stringify(res.snapshot) === JSON.stringify(again.snapshot), "the build is deterministic");
  assert(!res.K.fallback && res.K.pool === 201, `K from the 160th of 201 non-eligible players (pool ${res.K.pool})`);
  const recs = Object.values(res.snapshot.players);
  assert(recs.length > 150, "players written");
  const ranks = recs.map((r) => r.rank.balanced).sort((x, y) => x - y);
  assert(ranks.every((r, i) => r === i + 1), "ranks are 1..n");
  const kid = res.snapshot.players.kid!;
  assert(kid.phase === "prospect" && kid.path === "prospect" && kid.keeper.status === "free", "prospect record → prospect / free");
  // a regular from 2026-27 passes 100 GP during 2027-28: free through 2027-28 only
  assert(kid.elig.freeThrough === 2027 && kid.elig.binding === "gp", `free through ${kid.elig.freeThrough} (${kid.elig.binding})`);
  for (const r of [...recs.slice(0, 40), kid] as DynastyRecord[]) {
    const s = explainFr(r);
    assert(s.length > 0 && s.length <= 220, `explanation length ${s.length}: ${s}`);
    assert(!/snake|boisvert/i.test(s), "the explanation never quotes the scouting source");
    const trend = modelTrend(r);
    const prospectForm = r.phase === "prospect" && r.path !== "nhl";
    const growth = growthClauseFr(r);
    if (growth) {
      // a young skater: the growth driver is quoted instead of the yearly trend
      assert(s.includes(growth), `the growth driver is in the sentence (${s})`);
      assert(!s.includes("%/an"), `no yearly trend next to the growth driver (${s})`);
    } else if (!prospectForm && trend != null && Math.abs(trend) >= 0.01) {
      assert(s.includes(trend > 0 ? "(+" : "(−"), `quoted trend has the sign of the level trend (${s})`);
    }
    if (r.phase === "rising" || r.phase === "entering_prime") {
      // a young skater's phase follows his growth path (G_3 ≥ 1.05), others their trend
      if (r.growth) assert(r.growth.m[2]! >= 1.05, `rising / entering prime → growth G_3 ≥ 1.05 (${r.n} ${r.growth.m[2]})`);
      else assert((trend ?? 0) > 0, `rising / entering prime → positive trend (${r.n} ${trend})`);
    }
    if (r.growth && r.phase === "prime") assert(r.growth.m[2]! > 0.95 && r.growth.m[2]! < 1.05, `a young skater "in his prime" holds his level (${r.n})`);
    if (r.phase === "declining" || r.phase === "late_career") assert((trend ?? 0) < 0, `declining → negative trend (${r.n} ${trend})`);
    assert(rosterHintFr(r).length > 0, "a roster hint for everyone");
    assert(nearShare(r) >= 0 && nearShare(r) <= 1.0001, "near share in [0, 1]");
  }
  assert(explainFr(kid).startsWith("Espoir de 18 ans (1er choix LNH 2026)"), `prospect sentence: ${explainFr(kid)}`);
  const young = res.snapshot.players.young!;
  assert(young.phase === "rising" && /progression attendue .*\(\+\d+/.test(explainFr(young)), `a 20-year-old at 78 GP reads as rising with his growth driver: ${explainFr(young)}`);
  // after the market layer every mode is still exact from the exported eG, and the bands hold dv
  const moved = Object.values(res.all).filter((r) => r.dvModel);
  assert(moved.length >= 3, `the market moved some prospects (${moved.length})`);
  for (const r of moved) {
    for (const m of MODES) {
      const sum = discount(r.eG, modes[m]);
      assert(Math.abs(sum - r.dv[m]) <= 0.01 * r.dv[m] + 0.6, `${r.n}: Σ w δ^t eG ${sum.toFixed(1)} = dv.${m} ${r.dv[m]} after the market layer`);
    }
    const inBand = (b: number[], x: number) => x >= b[0]! - 1 && x <= b[2]! + 1;
    const model = r.dvModel!;
    const modelIn = res.internals.get(Object.keys(res.all).find((id) => res.all[id] === r)!)!.value!;
    if (inBand(modelIn.band.balanced, model.balanced)) assert(inBand(r.band.balanced, r.dv.balanced), `${r.n}: the posterior stays inside its scaled band`);
  }
  // level-neutral per segment: the mean log-shift of the anchored prospects is about 0
  const pros = Object.values(res.all).filter((r) => r.seg === "prospect" && r.market.w > 0);
  const meanShift = pros.reduce((s, r) => s + Math.log(r.dv.balanced + 10) - Math.log((r.dvModel ?? r.dv).balanced + 10), 0) / pros.length;
  assert(Math.abs(meanShift) < 0.02, `prospect segment mean log shift ${meanShift.toFixed(4)} ≈ 0`);
  assert(PHASE_FR.entering_prime === "entre dans son prime", "French phase labels");
}

if (failed > 0) {
  console.error(`test-dynasty-value: ${failed} failure(s)`);
  process.exit(1);
}
console.log("OK: dynasty values (monotonicity, aging guard, keeper gate, prospects, modes, goalies, captain, market, explanation)");
