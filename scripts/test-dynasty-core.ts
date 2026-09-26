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
import { depthChartShares, routePlayer, statusAvailability } from "../src/lib/dynasty/segment";
import { simulatePlayer, type SimContext, type SimPlayer } from "../src/lib/dynasty/simulate";
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
