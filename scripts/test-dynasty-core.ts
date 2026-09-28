/**
 * Unit checks for the dynasty model's building blocks: RNG, scale, aging,
 * eligibility, routing, the draft-slot prior and the young-skater growth
 * path in the simulator (the growth model itself: test-dynasty-growth.ts).
 * Run: npx tsx scripts/test-dynasty-core.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { ageShift, curveLevel, drift, makeLevel, makeRawLevel, phaseByAge, trajectoryShift } from "../src/lib/dynasty/aging";
import { birthdayInWindow, cutdownAge, cutdownMs, isEligible } from "../src/lib/dynasty/eligibility";
import { parseParams, type DynastyParams } from "../src/lib/dynasty/params";
import { slotPMakeRaw, slotProspect } from "../src/lib/dynasty/prospect";
import { makeRetention } from "../src/lib/dynasty/retention";
import { hashStr, mulberry32 } from "../src/lib/dynasty/rng";
import { groupOf, realized, replacement, year0Cal } from "../src/lib/dynasty/scale";
import { blendGames, depthChartShares, routePlayer, statusAvailability } from "../src/lib/dynasty/segment";
import { mixSimResults, simulatePlayer, type SimContext, type SimPlayer } from "../src/lib/dynasty/simulate";
import { blendSides, buildDynasty, linkYear0 } from "../src/lib/dynasty/index";
import { makeGrowth } from "../src/lib/dynasty/growth";
import { modeWeights } from "../src/lib/dynasty/value";
import { normalCdf } from "../src/lib/fantrax/draft";
import type { DynastyInput, ProspectRecord, SeasonLine } from "../src/lib/dynasty/types";

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
const raw = makeRawLevel(params);
const ret = makeRetention(params);
const repl = replacement(params);
const ctx = (over: Partial<SimContext> = {}): SimContext => ({
  p: params,
  level,
  ret,
  repl,
  K: 40,
  N: 400,
  keepGate: true,
  seedKey: "|test",
  ...over,
});

// ---- 1. RNG determinism
{
  const a = mulberry32(hashStr("x"));
  const b = mulberry32(hashStr("x"));
  const xs = Array.from({ length: 5 }, () => a.u());
  const ys = Array.from({ length: 5 }, () => b.u());
  assert(xs.every((x, i) => x === ys[i]), "same seed → same uniform stream");
  assert(xs.every((x) => x >= 0 && x < 1), "uniforms in [0, 1)");
  const pl: SimPlayer = {
    id: "det",
    g: "F",
    age0: 26.2,
    birthDate: "2000-07-20",
    gp0: 400,
    eligNow: false,
    path: "nhl",
    theta0: 3.2,
    share0: 0.9,
    sigma0: 0.1,
    elite: false,
  };
  const r1 = simulatePlayer(pl, ctx());
  const r2 = simulatePlayer(pl, ctx());
  const r3 = simulatePlayer(pl, ctx({ seedKey: "|other" }));
  const same = r1.gain.every((row, t) => row.every((x, n) => x === r2.gain[t]![n]));
  assert(same, "same id and seed → identical gains on every path");
  assert(r1.gain[3]!.some((x, n) => x !== r3.gain[3]![n]), "another seed → other paths");
}

// ---- 2. Scale and replacement
{
  assert(realized(params, "F", 3) < realized(params, "F", 3.1), "realized F increasing in x");
  assert(realized(params, "D", 2.5) < realized(params, "D", 2.6), "realized D increasing in x");
  assert(realized(params, "G", 4.1) === 4.1, "goalies: identity");
  // Scale refit on the per-segment recalibrated projections (2026-09-26):
  // −0.127 + 1.061 × 2.18 and −0.383 + 1.175 × 2.28 (2026-09-25 fit: 2.135 /
  // 2.294; the forward waiver line rose once young forwards near it were no
  // longer projected ~20% low).
  assert(near(repl.F, 2.186, 0.001), `R_F = 2.186 (got ${repl.F})`);
  assert(near(repl.D, 2.296, 0.001), `R_D = 2.296 (got ${repl.D})`);
  // −0.127 + 1.061 × 3.933 = 4.0459 (2026-09-25: 4.014)
  assert(near(repl.offRef, 4.046, 0.001), `offRef = 4.046 (got ${repl.offRef})`);
  // 128 per 82-game season-slot, scaled to the 84-game schedule
  assert(near(repl.Gseason, (128 * 84) / 82, 1e-9), `goalie replacement 128 × 84/82 per season-slot (got ${repl.Gseason})`);
  assert(groupOf("D,Skt", false) === "D", "D group");
  assert(groupOf("C,D,Skt", false) === "F", "C/D dual → F");
  assert(groupOf("G", true) === "G", "goalie group");
  assert(groupOf("", false, "D") === "D", "hint when no Fantrax positions");
  assert(year0Cal(params, "F", 20) === 1.05 && year0Cal(params, "F", 31) === 0.965, "year-0 age calibration bands (F)");
  assert(year0Cal(params, "D", 20) === 1, "D ≤ 21 cell (n < 15) is 1");
}

// ---- 3. Aging
{
  for (const a of [19, 22.5, 25, 26]) {
    assert(near(level("F", a), raw("F", a), 1e-12), `c~ = c at ${a}`);
  }
  assert(level("F", 34) > raw("F", 34), "λ < 1 softens the decline at 34");
  assert(level("D", 36) > raw("D", 36), "λ < 1 softens the D decline at 36");
  assert(level("G", 36) === raw("G", 36), "goalie curve is not λ-scaled");
  assert(near(curveLevel(params.curves.F, 20.5), (0.824 + 0.892) / 2, 1e-9), "linear interpolation");
  assert(curveLevel(params.curves.F, 43) < curveLevel(params.curves.F, 41), "geometric extrapolation past 41");
  const eliteShift = ageShift(params, "F", 31, true, 0);
  assert(eliteShift === -1, "elite F at 31 ages a year slower");
  assert(near(drift(level, "F", 31, eliteShift), level("F", 30) / level("F", 29), 1e-12), "elite F at 31 drifts like a 30-year-old");
  assert(ageShift(params, "F", 30, true, 0) === 0, "elite shift starts at 31");
  assert(ageShift(params, "D", 33, true, 0) === 0, "elite shift is forwards only");
  assert(ageShift(params, "F", 33, true, -1) === -1, "shifts are bounded to ±1");
  assert(phaseByAge(params, "F", 20) === "rising" && phaseByAge(params, "F", 25) === "prime", "F phases");
  assert(phaseByAge(params, "F", 30) === "declining" && phaseByAge(params, "F", 36) === "late_career", "F late phases");
  assert(phaseByAge(params, "D", 27) === "prime" && phaseByAge(params, "G", 30) === "plateau", "D / G phases");
  // trajectory: TOI up 2 min with FP/G flat → −1; TOI down 2 min and FP/G down → +1
  const line = (season: number, toi: number, goals: number): SeasonLine => ({
    season,
    gp: 80,
    toi,
    goals,
    assists: 30,
    shots: 200,
    hits: 50,
    blocks: 20,
    takeaways: 20,
  });
  assert(trajectoryShift(params, level, "F", 26.5, [line(2024, 1000, 20), line(2025, 1120, 20)]).shift === -1, "TOI up → −1");
  assert(trajectoryShift(params, level, "F", 26.5, [line(2024, 1120, 25), line(2025, 1000, 18)]).shift === 1, "TOI down and FP/G down → +1");
  // symmetric: FP/G well below the curve with flat TOI → +1 (mirror of the breakout branch)
  assert(trajectoryShift(params, level, "F", 26.5, [line(2024, 1000, 20), line(2025, 1010, 10)]).shift === 1, "FP/G > 12% below the curve → +1");
  assert(trajectoryShift(params, level, "F", 26.5, [line(2024, 1000, 20), line(2025, 1010, 30)]).shift === -1, "FP/G > 12% above the curve → −1");
  assert(trajectoryShift(params, level, "F", 26.5, [line(2024, 1120, 18), line(2025, 1000, 20)]).shift === 0, "TOI down but FP/G up → 0");
  assert(trajectoryShift(params, level, "F", 26.5, [line(2024, 1000, 20), line(2025, 1120, 18)]).shift === 0, "TOI up but FP/G down (within 12%) → 0");
  assert(trajectoryShift(params, level, "F", 26.5, [line(2024, 1100, 20), line(2025, 1110, 20)]).shift === 0, "flat → 0");
  assert(trajectoryShift(params, level, "F", 22, [line(2024, 1000, 20), line(2025, 1200, 20)]).shift === 0, "under 24: no modifier");
  assert(
    trajectoryShift(params, level, "F", 26.5, [line(2024, 1000, 20), { ...line(2025, 1200, 20), gp: 30 }]).shift === 0,
    "needs 40 GP in both seasons",
  );
}

// ---- 4. Eligibility
{
  assert(isEligible(params, "F", 22, 99), "99 GP eligible");
  assert(!isEligible(params, "F", 22, 100), "exactly 100 GP not eligible (strict Fantrax rule)");
  assert(isEligible(params, "G", 22, 54) && !isEligible(params, "G", 22, 55), "goalie 54 eligible, 55 not");
  // 2027 cutdown = Sep 17 2027: born 2002-09-18 is one day short of 25, born 2002-09-17 turns 25 that day
  const dayBefore = cutdownAge(params, "2002-09-18", 24, 1);
  const onBirthday = cutdownAge(params, "2002-09-17", 24, 1);
  assert(dayBefore < 25 && isEligible(params, "F", dayBefore, 0), `day before the 25th birthday eligible (${dayBefore})`);
  assert(onBirthday >= 25 && !isEligible(params, "F", onBirthday, 0), `25th birthday on the cutdown: not eligible (${onBirthday})`);
  assert(cutdownMs(params, 1) === Date.UTC(2027, 8, 17), "cutdown Sep 17 2027 from params");
  const moved: DynastyParams = { ...params, cutdown: { ...params.cutdown, month: 9, day: 1 } };
  assert(cutdownMs(moved, 1) === Date.UTC(2027, 8, 1), "cutdown date follows params");
  assert(cutdownAge(moved, "2002-09-10", 24, 1) < 25, "an earlier cutdown keeps a September birthday eligible");
  assert(birthdayInWindow(params, "2002-09-01", 2027) && !birthdayInWindow(params, "2002-11-01", 2027), "birthday-in-window flag");
}

// ---- 5. Routing
const rec = (over: Partial<ProspectRecord> = {}): ProspectRecord => ({
  n: "X",
  pos: "F",
  nhlGP: 0,
  pMake: 0.8,
  pSource: "test",
  fpgIfMake: { mu: 3, sd: 0.6 },
  eta: 2027,
  comp: { fpDraft: 3.1 },
  ...over,
});
const input = (over: Partial<DynastyInput>): DynastyInput => ({
  id: "t",
  n: "Test",
  e: "W,F,Skt",
  team: "ANA",
  birthDate: "2008-03-01",
  careerGp: 0,
  eligNow: true,
  rostered: true,
  ...over,
});
{
  const klepov = routePlayer(
    params,
    level,
    input({ id: "klepov", proj: { src: "proj", gp: 62, off: 2.9, dx: 0, method: "contextual" }, prospect: rec({ eta: 2028 }) }),
  );
  assert(klepov.route === "prospect" && klepov.path === "prospect", `contextual projection, 0 GP → prospect path (${klepov.route})`);
  assert(klepov.flags.has("placeholderProjection"), "placeholder projection flagged");
  const danielson = routePlayer(
    params,
    level,
    input({
      id: "danielson",
      birthDate: "2004-09-27",
      careerGp: 28,
      proj: { src: "proj", gp: 31, off: 2.8, dx: 0, method: "ml" },
      prospect: rec({ nhlGP: 28 }),
    }),
  );
  assert(danielson.route === "prospect", `ml 31 GP, 28 career GP, record → prospect (${danielson.route})`);
  assert(danielson.seg === "prospect_nhl", "prospect with NHL games → prospect_nhl segment");
  const martone = routePlayer(
    params,
    level,
    input({
      id: "martone",
      birthDate: "2006-10-26",
      careerGp: 9,
      proj: { src: "proj", gp: 64, off: 3.6, dx: 0, method: "ml" },
      prospect: rec(),
      draft: { year: 2025, pick: 6 },
    }),
  );
  assert(martone.route === "nhl" && martone.sim?.path === "nhl", `ml 64 GP → NHL path (${martone.route})`);
  assert(martone.seg === "young_nhl", "young NHL segment");
  assert(martone.phase === "rising", `eligible regular at 19 is 'rising' (${martone.phase})`);
  // Goalie depth chart: an injured / suspended starter keeps his job, his
  // partner is not promoted for good; minors / unsigned / inactive goalies leave.
  const shares = depthChartShares(params, [
    { id: "wpg1", team: "WPG", gp: 58, icons: ["6"] },
    { id: "wpg2", team: "WPG", gp: 24 },
    { id: "min1", team: "MIN", gp: 52, icons: ["30"] },
    { id: "min2", team: "MIN", gp: 20, icons: ["31"] },
    { id: "cbj1", team: "CBJ", gp: 50 },
    { id: "cbj2", team: "CBJ", gp: 30, icons: ["4"] },
  ]);
  assert(near(shares.get("wpg1")!, 58 / 82, 1e-9) && near(shares.get("wpg2")!, 24 / 82, 1e-9), "suspended starter keeps his depth share");
  assert(near(shares.get("min1")!, 52 / 72, 1e-9) && near(shares.get("min2")!, 20 / 72, 1e-9), "injured starter keeps his depth share");
  assert(shares.get("cbj2") === 0 && shares.get("cbj1") === 0.85, "a goalie in the minors leaves the depth chart (partner capped at 85%)");
  assert(statusAvailability(params, ["6"]) === 0.95 && statusAvailability(params, ["2", "30"]) === 0.75, "status icons trim season 0");
  assert(statusAvailability(params, ["1", "31"]) === 1 && statusAvailability(params, undefined) === 1, "day-to-day / minors-eligible icons do not");
  const goalie = (over: Partial<DynastyInput>) =>
    routePlayer(
      params,
      level,
      input({ e: "G", birthDate: "1993-05-18", careerGp: 500, eligNow: false, fantraxAge: 33, ...over }),
    );
  // Healthy tandem with real depth news: the club added a goalie after the projections
  const tandem = goalie({ id: "tandem", proj: { src: "proj", gp: 52, gE: 4.2, pS: 0.3, method: "ml" } });
  assert(near(tandem.sim!.share0!, 0.3, 1e-9), `depth news: starts = pS × 82 (share ${tandem.sim!.share0})`);
  assert(tandem.flags.has("startShareNews") && !tandem.flags.has("injuredNow"), "start-share news flagged");
  // Injured / suspended starter: full depth share, season 0 trimmed only
  const hurt = goalie({ id: "hurt", status: ["6"], proj: { src: "proj", gp: 58, gE: 4.3, pS: 58 / 82, method: "ml" } });
  assert(near(hurt.sim!.share0!, 58 / 82, 1e-9) && hurt.sim!.avail0 === 0.95, "suspended starter: depth share kept, avail0 0.95");
  assert(hurt.flags.has("injuredNow") && !hurt.flags.has("startShareNews"), "injury flagged, not start-share news");
  const healthy = goalie({ id: "hurt", proj: { src: "proj", gp: 58, gE: 4.3, pS: 58 / 82, method: "ml" } });
  const rh = simulatePlayer(hurt.sim!, ctx({ fixedYear0: true }));
  const rok = simulatePlayer(healthy.sim!, ctx({ fixedYear0: true }));
  const g0 = (4.3 * 84 * (58 / 82) - repl.Gseason) * 0.95;
  assert(rh.gain[0]!.every((x) => near(x, g0, 1e-9)), `year 0 = avail0 × (θ × starts − R_Gs) (${rh.gain[0]![0]} vs ${g0.toFixed(2)})`);
  const m1 = (r: ReturnType<typeof simulatePlayer>) => r.vorPre[1]!.reduce((s, x) => s + x, 0) / r.N;
  assert(near(m1(rh), m1(rok), 1e-9), "the injury never reaches 2027-28 (same starter odds and value)");
  // Career GP = before the season + this season so far
  const midSeason = routePlayer(params, level, input({ id: "mid", careerGp: 45, seasonGp: 30 }));
  assert(midSeason.gp0 === 75, `career GP adds the season-to-date games (${midSeason.gp0})`);
  const slot = routePlayer(params, level, input({ id: "slot", draft: { year: 2026, pick: 10 } }));
  assert(slot.route === "slot" && slot.seg === "prospect_slot", `drafted, eligible, no record → draft-slot path (${slot.route})`);
  const wrongDraft = routePlayer(params, level, input({ id: "old", birthDate: "1995-01-01", draft: { year: 2026, pick: 10 } }));
  assert(wrongDraft.route === "fringe", "draft year − birth year outside 17–21 → no slot model (namesake guard)");
  // no birth date: the Fantrax age stands in (±1); a registry match with no age at all is not trusted
  const noBirth = { birthDate: null, draftSource: "registry" as const };
  const miller = routePlayer(params, level, input({ id: "miller", ...noBirth, fantraxAge: 19, draft: { year: 1999, pick: 138 } }));
  assert(miller.route === "fringe" && miller.draft === null, `a 19-year-old is not the 1999 #138 namesake (${miller.route})`);
  const fresh = routePlayer(params, level, input({ id: "fresh", ...noBirth, fantraxAge: 18, draft: { year: 2026, pick: 40 } }));
  assert(fresh.route === "slot", `an 18-year-old 2026 draftee keeps the slot model (${fresh.route})`);
  const ageless = routePlayer(params, level, input({ id: "ageless", ...noBirth, draft: { year: 2025, pick: 40 } }));
  assert(ageless.route === "fringe", "no birth date and no age: a registry name match is not trusted");
  const agelessProfile = routePlayer(params, level, input({ id: "agelessP", birthDate: null, draftSource: "profile", draft: { year: 2025, pick: 40 } }));
  assert(agelessProfile.route === "slot", "an id-keyed profile draft is trusted without an age");
  const fringe = routePlayer(params, level, input({ id: "fr" }));
  assert(fringe.route === "fringe" && fringe.flags.has("noModel") && fringe.sim === null, "nothing to model → fringe");
  const vet = routePlayer(
    params,
    level,
    input({
      id: "vet",
      birthDate: "1990-01-01",
      careerGp: 900,
      eligNow: false,
      proj: { src: "proj", gp: 75, off: 3.5, dx: 0, method: "ml" },
      fantraxAge: 36,
    }),
  );
  assert(vet.seg === "late" && vet.phase === "late_career", `36-year-old → late / late_career (${vet.seg}, ${vet.phase})`);
  const unknownElig = routePlayer(params, level, input({ id: "u", eligNow: null, birthDate: "1996-01-01", careerGp: 500 }));
  assert(unknownElig.eligNow === false, "unknown flag → rule-based eligibility");
}

// ---- 5b. Blended route: games from the split-season rule (a late signing)
{
  const signing = (gp: number, gpSd?: number) =>
    input({
      id: "signing",
      e: "D,Skt",
      birthDate: "2006-06-28",
      careerGp: 14,
      proj: { src: "proj", gp, off: 2.6, dx: 0.9, method: "ml", ...(gpSd ? { gpSd } : {}) },
      prospect: rec({ pos: "D", nhlGP: 14 }),
      draft: { year: 2024, pick: 43 },
    });
  const hard = routePlayer(params, level, signing(46));
  assert(hard.nhlShare === null && hard.route === "nhl", "without the rule's spread the 40-game cut decides");
  const soft = routePlayer(params, level, signing(46, 22));
  assert(soft.route === "nhl" && near(soft.nhlShare!, normalCdf(6 / 22), 1e-12), `P(40+ games) = Φ((46 − 40) / 22) (${soft.nhlShare})`);
  assert(routePlayer(params, level, signing(39, 22)).route === "prospect", "the likelier side is the route shown");
  const other = routePlayer(params, level, signing(46, 22), 1, undefined, "prospect");
  assert(other.route === "prospect" && other.sim?.path === "prospect", "the other side can be forced");
  const vet = routePlayer(params, level, { ...signing(46, 22), careerGp: 150, prospect: rec({ nhlGP: 150 }) });
  assert(vet.nhlShare === null, "100+ career games: the NHL route, no blend");
  const goalie = routePlayer(params, level, { ...signing(12, 22), e: "G", proj: { src: "proj", gp: 12, gE: 3.9, method: "ml", gpSd: 22 } });
  assert(goalie.nhlShare === null, "goalies keep their cut");

  // The mixture takes the first round(w · N) paths of the NHL side, the rest of the prospect side.
  const cx = ctx({ N: 200 });
  const a = simulatePlayer(soft.sim!, cx);
  const b = simulatePlayer(other.sim!, cx);
  const m = mixSimResults(a, b, 0.25);
  assert(m.gain[0]![49] === a.gain[0]![49] && m.gain[0]![50] === b.gain[0]![50], "per-path gains: 50 NHL paths, then prospect paths");
  assert(near(m.eligAt[1]!, 0.25 * a.eligAt[1]! + 0.75 * b.eligAt[1]!, 1e-12), "path shares mix with the same weight");
  assert(near(m.pMade, 0.25 * a.pMade + 0.75 * b.pMade, 1e-12), "P(made) mixes");
  // the expectations use BOTH sides' N paths (the stratified rows only carry bands and keep indices)
  const avgOf = (x: Float64Array) => x.reduce((s, v) => s + v, 0) / x.length;
  assert(
    m.means!.gain.every((g, t) => near(g, 0.25 * avgOf(a.gain[t]!) + 0.75 * avgOf(b.gain[t]!), 1e-9)),
    "expected gains are the weighted means of both full simulations",
  );
  const split = mixSimResults(a, b, 0.25, 0);
  assert(near(split.means!.gain[0]!, 0.25 * avgOf(a.gain[0]!) + 0.75 * avgOf(b.gain[0]!), 1e-9) && near(split.means!.gain[3]!, avgOf(b.gain[3]!), 1e-9), "season 0 and later seasons can mix differently");

  // No cliff: a game either side of 40 moves the value by a few percent, not 4×.
  const build = (gp: number, gpSd?: number) =>
    buildDynasty(
      { players: [signing(gp, gpSd)], meta: { valuesFetchedAt: "", stateFetchedAt: "", projectionsAt: "", prospectsBuiltAt: "" } },
      params,
      { paths: 2000, K: 40, market: false },
    ).all.signing!.dv.balanced;
  const [c39, c41] = [build(39), build(41)];
  const [b39, b41] = [build(39, 22), build(41, 22)];
  assert(c41 > 1.5 * c39, `hard cut: 39 → 41 games jumps (${c39.toFixed(1)} → ${c41.toFixed(1)})`);
  assert(b41 > b39 && b41 < 1.15 * b39, `blended: 39 → 41 games moves a little (${b39.toFixed(1)} → ${b41.toFixed(1)})`);
  assert(b39 > c39 && b41 < c41, "the blend sits between the two routes");

  // The market layer too: the weight mixes the two sides' by their shares
  // (0.25 × P(prospect) for a skater), on the prospect ladder on both sides
  // of 40 (the shown side's segment flipped the weight 0.25 → 0 at 40 games
  // and the published value jumped while the model barely moved).
  const ladder = (id: string, ros: number, mu: number): DynastyInput =>
    input({ id, e: "D,Skt", birthDate: "2006-01-01", careerGp: 5, ros, prospect: rec({ pos: "D", nhlGP: 5, pMake: 0.9, fpgIfMake: { mu, sd: 0.6 } }) });
  const priced = (gp: number) =>
    buildDynasty(
      {
        // the crowd's last pick of the segment: anchored at the bottom of the prospect ladder
        players: [{ ...signing(gp, 22), ros: 5 }, ladder("l1", 60, 3.6), ladder("l2", 30, 3), ladder("l3", 10, 2.4)],
        meta: { valuesFetchedAt: "", stateFetchedAt: "", projectionsAt: "", prospectsBuiltAt: "" },
      },
      params,
      { paths: 2000, K: 40, market: true },
    ).all.signing!;
  const [m39, m41] = [priced(39), priced(41)];
  const wSeg = params.market.weights.prospect_nhl!;
  for (const r of [m39, m41]) {
    assert(near(r.market.w, wSeg * (1 - r.nhlShare!), 0.001), `market weight = prospect segment × prospect share on the ${r.path} side (${r.market.w})`);
    assert(r.dvModel != null && r.dv.balanced < r.dvModel.balanced, `the market pulls the value down on the ${r.path} side (${r.dvModel?.balanced} → ${r.dv.balanced})`);
  }
  assert(m39.path === "prospect" && m41.path === "nhl", "the shown side flips at 40");
  const factor = (r: typeof m39) => r.dv.balanced / (r.dvModel ?? r.dv).balanced;
  assert(Math.abs(Math.log(factor(m41) / factor(m39))) < 0.03, `market factor continuous across 40 (${factor(m39).toFixed(3)} → ${factor(m41).toFixed(3)})`);
  assert(m41.dv.balanced > m39.dv.balanced && m41.dv.balanced < 1.15 * m39.dv.balanced, `published: 39 → 41 games moves a little (${m39.dv.balanced} → ${m41.dv.balanced})`);
}

// ---- 5c. Blended route: each side plays its half of the games; value monotone in the projected games
{
  // E[GP | GP ≥ 40] and E[GP | GP < 40] of N(gp, sd) recombine to gp
  for (const [gp, sd] of [[20, 22], [41, 22], [66, 22], [30, 10]] as const) {
    const s = blendGames(gp, sd, 82);
    const w = normalCdf((gp - 40) / sd);
    assert(s.above >= 40 && s.below <= 40 && s.below >= 0, `split on either side of 40 (${gp}: ${s.below.toFixed(1)} / ${s.above.toFixed(1)})`);
    assert(near(w * s.above + (1 - w) * s.below, gp, 0.05), `P(40+) · above + (1 − P) · below = ${gp} (${(w * s.above + (1 - w) * s.below).toFixed(2)})`);
  }
  // Real players frozen from the 2026-09-26 Captains snapshot (scripts/fixtures/dynasty-blend-players.json).
  const fx = JSON.parse(readFileSync(join(process.cwd(), "scripts", "fixtures", "dynasty-blend-players.json"), "utf8")) as {
    params: { K: number; Kgate: number };
    players: DynastyInput[];
  };
  const byName = (n: string) => fx.players.find((x) => x.n === n)!;
  // Year-0 NHL games: the blend sums to the projection (was 0.82 of it: the
  // NHL side ran at the unconditional games with its own demotion draw).
  const growth = makeGrowth(params, level);
  const cx = ctx({ N: 2000, K: fx.params.K, Kgate: fx.params.Kgate, growth });
  const modes = modeWeights(params);
  for (const inp of fx.players) {
    const nhl = routePlayer(params, level, inp, 1, growth, "nhl");
    const pro = routePlayer(params, level, inp, 1, growth, "prospect");
    linkYear0(params, nhl, pro);
    assert(pro.sim?.year0 != null && near(pro.sim.year0.share * 82, pro.blendGp!.below, 1e-9), `${inp.n}: the prospect side plays E[GP | GP < 40] in 2026-27`);
    assert(near(nhl.sim!.share0! * 82, nhl.blendGp!.above, 1e-9), `${inp.n}: the NHL side plays E[GP | GP ≥ 40]`);
    const mix = blendSides(simulatePlayer(nhl.sim!, cx), simulatePlayer(pro.sim!, cx), nhl.nhlShare!, modes);
    const projGames = (inp.proj!.gp * params.games.seasonGames) / params.games.projectionBasis;
    assert(near(mix.games[0]! / projGames, 1, 0.03), `${inp.n}: blended 2026-27 games ${mix.games[0]!.toFixed(1)} ≈ projection ${projGames.toFixed(1)}`);
  }
  // Monotone: Sandin Pellikka's NHL route is worth far less than his prospect
  // route (verifier: 9.7 → 3.5 from 5 to 69 projected games); Fisker
  // Molgaard's too (8.1 → 1.0); Helenius's is worth more.
  const sweep = (inp: DynastyInput) =>
    [5, 17, 29, 41, 53, 65, 77].map(
      (gp) =>
        buildDynasty(
          { players: [{ ...inp, proj: { ...inp.proj!, gp } }], meta: { valuesFetchedAt: "", stateFetchedAt: "", projectionsAt: "", prospectsBuiltAt: "" } },
          params,
          { paths: 2000, K: fx.params.K, Kgate: fx.params.Kgate, market: false },
        ).all[inp.id]!.dv.balanced,
    );
  for (const n of ["Axel Sandin Pellikka", "Oscar Fisker Molgaard", "Konsta Helenius"]) {
    const v = sweep(byName(n));
    const worst = Math.min(...v.slice(1).map((x, i) => x - v[i]!));
    assert(worst >= -Math.max(0.3, 0.03 * v[0]!), `${n}: balanced value never falls as projected games rise (${v.map((x) => x.toFixed(1)).join(" → ")})`);
    assert(v[v.length - 1]! >= v[0]! - 0.2, `${n}: 77 projected games worth at least 5 (${v[0]!.toFixed(1)} → ${v[v.length - 1]!.toFixed(1)})`);
  }
}

// ---- 6. Draft-slot prior
{
  const f10 = slotProspect(params, "F", { year: 2026, pick: 10 });
  assert(near(f10.pMake, 0.8, 0.02), `pMake F pick 10, fresh ≈ 0.80 (${f10.pMake.toFixed(3)})`);
  const f10old = slotProspect(params, "F", { year: 2023, pick: 10 });
  assert(f10old.pMake < f10.pMake * 0.5, "no-arrival decay lowers the odds");
  const d6 = slotProspect(params, "D", { year: 2026, pick: 6 });
  assert(near(d6.pMake, 0.84, 0.02), `pMake D pick 6 ≈ 0.84 (${d6.pMake.toFixed(3)})`);
  assert(slotPMakeRaw(params, "G", 20) === 0.44 && slotPMakeRaw(params, "G", 200) === 0.05, "goalie buckets");
  assert(f10.eta === 2027 && slotProspect(params, "F", { year: 2026, pick: 2 }).eta === 2026, "ETA lag by pick band");
  assert(slotProspect(params, "G", { year: 2025, pick: 30 }).eta === 2030, "goalies + 5 years");
  assert(slotProspect(params, "F", { year: 2020, pick: 150 }).eta === 2026, "ETA never before 2026");
  assert(f10.pi.mu > slotProspect(params, "F", { year: 2026, pick: 60 }).pi.mu, "earlier picks have a higher prime");
}

// ---- 7. Young-skater growth path in the simulator
{
  const base: SimPlayer = {
    id: "grow",
    g: "F",
    age0: 20,
    birthDate: "2006-09-01",
    gp0: 30,
    eligNow: true,
    path: "nhl",
    theta0: 3,
    share0: 0.9,
    sigma0: 0.14,
    elite: false,
  };
  const off = simulatePlayer(base, ctx({ fixedYear0: true, N: 600 }));
  const rel = [1, 1.08, 1.15, 1.2, 1.22, 1.23];
  const on = simulatePlayer({ ...base, gRel: rel, spYoung: 0.1 }, ctx({ fixedYear0: true, N: 600 }));
  const mean = (a: Float64Array) => a.reduce((s, x) => s + x, 0) / a.length;
  assert(on.gain[0]!.every((x, n) => x === off.gain[0]![n]), "the growth path never touches year 0");
  assert(rel.every((x, t) => near(on.lvlRel![t]!, x, 1e-12)), "lvlRel follows gRel inside the growth window");
  const drift6 = level("F", base.age0 + 6) / level("F", base.age0 + 5);
  assert(near(on.lvlRel![6]! / on.lvlRel![5]!, drift6, 1e-12), "the curve takes over after the window");
  assert(mean(on.fp[3]!) > mean(off.fp[3]!), "a growth path above the curve raises season 3");
}

if (failed > 0) {
  console.error(`test-dynasty-core: ${failed} failure(s)`);
  process.exit(1);
}
console.log("OK: dynasty core (rng, scale, aging, eligibility, routing, slot prior, growth path)");
