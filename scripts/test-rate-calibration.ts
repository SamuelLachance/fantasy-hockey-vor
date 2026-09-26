/**
 * Unit checks for the post-hoc skater rate calibration (src/lib/rate-calibration.ts)
 * and the raised rate limits, plus invariants of the committed board.
 * Run: npx tsx scripts/test-rate-calibration.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  clampSkaterProjection,
  findProjectionIssues,
  SKATER_RATE_LIMITS,
} from "../src/lib/projection-sanity";
import type { PlayerDetailRecord } from "../src/lib/publish-players";
import { splitPublishedPlayer } from "../src/lib/publish-players";
import type { PlayerProfile } from "../src/lib/profile-types";
import {
  applyRateCalibration,
  bootstrapModelRates,
  calibrateRates,
  calibrationKey,
  edgeSample,
  fitEdgeLines,
  fitLine,
  fitRateCalibration,
  isReliableRebuild,
  legacyCappedCells,
  legacyCappedTotal,
  RATE_CALIBRATION_MIN_GP,
  RATE_KEYS,
  RATE_SEGMENTS,
  rateGroup,
  rateSegment,
  segmentFromReasoning,
  segmentLevelIssues,
  segmentLevels,
  targetEdge,
  totalsFromRates,
  type EdgeLines,
  type ModelSegment,
  type RateCalibratable,
  type RateReference,
  type RateSegment,
} from "../src/lib/rate-calibration";
import type {
  PlayerProjection,
  Position,
  ProjectionsDataset,
  SkaterCategory,
  SkaterProjection,
} from "../src/lib/types";
import { SKATER_CATEGORIES } from "../src/lib/types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

// --- fitLine ---
{
  const f = fitLine([1, 2, 3, 4], [3, 5, 7, 9]);
  assert(near(f.a, 1) && near(f.b, 2), "fitLine recovers y = 1 + 2x");
  const flat = fitLine([2, 2, 2], [1, 2, 3]);
  assert(near(flat.b, 0) && near(flat.a, 2), "fitLine without x spread = mean");
}

// --- segment helpers ---
assert(segmentFromReasoning("v2 stacked ensemble (GBDT+ridge, 2 NHL seasons, young segment). Trained 2026-07-22.") === "young", "reasoning: young segment");
assert(segmentFromReasoning("v2 stacked ensemble (GBDT+ridge, 7 NHL seasons). Trained 2026-07-22.") === "vet", "reasoning: veteran");
assert(segmentFromReasoning("Contextual projection") === undefined && segmentFromReasoning(undefined) === undefined, "reasoning: not a v2 skater");
assert(rateSegment({ position: "LW", modelSegment: "young" }) === "youngF", "young winger → youngF");
assert(rateSegment({ position: "LW", primaryPosition: "D", modelSegment: "vet" }) === "vetD", "segment follows the primary position");
assert(rateSegment({ position: "C" }) === null, "no segment without modelSegment");
assert(isReliableRebuild({ profileGames: 150, olderSeasonGames: 400 }), "100+ profile games: reliable");
assert(isReliableRebuild({ profileGames: 60, olderSeasonGames: 0 }), "whole history in the profiles: reliable");
assert(!isReliableRebuild({ profileGames: 60, olderSeasonGames: 300 }), "few profile games over MoneyPuck seasons: unreliable");

// --- synthetic pool: four segments with different drifts ---
type P = RateCalibratable & { name: string; projection: SkaterProjection };
function rates(over: Partial<Record<SkaterCategory, number>>): Partial<Record<SkaterCategory, number>> {
  const base = Object.fromEntries(SKATER_CATEGORIES.map((c) => [c, 0])) as Record<SkaterCategory, number>;
  return { ...base, ...over };
}
function player(
  id: number,
  position: Position,
  segment: ModelSegment | undefined,
  market: Partial<Record<SkaterCategory, number>>,
  edge: Partial<Record<SkaterCategory, number>>,
  gamesPlayed = 70,
): P {
  const m = rates(market);
  const e = rates(edge);
  const modelRates = Object.fromEntries(
    SKATER_CATEGORIES.map((c) => [c, (m[c] ?? 0) + (e[c] ?? 0)]),
  ) as Record<SkaterCategory, number>;
  return {
    id,
    name: `p${id}`,
    isGoalie: false,
    position,
    primaryPosition: position,
    gamesPlayed,
    projectionMethod: "ml",
    projection: totalsFromRates(modelRates, gamesPlayed, position),
    modelRates,
    modelMarketEdge: e,
    modelSegment: segment,
    marketEdge: e,
  };
}

// Drift per segment (per game): goals, assists; shots drift tilts with the
// market (edge = a − 0.1·market); PPP edge = 0.05 − 0.2·market for veterans.
const DRIFT: Record<RateSegment, { goals: number; assists: number; shotsA: number }> = {
  vetF: { goals: 0.11, assists: 0.13, shotsA: 0.7 },
  youngF: { goals: 0.06, assists: 0.1, shotsA: 0.5 },
  vetD: { goals: 0.05, assists: 0.15, shotsA: 0.6 },
  youngD: { goals: 0.03, assists: 0.07, shotsA: 1.0 },
};
const pool: P[] = [];
let nextId = 1;
for (const seg of RATE_SEGMENTS) {
  const n = seg === "vetF" ? 40 : seg === "youngD" ? 26 : 30;
  const isD = seg.endsWith("D");
  const d = DRIFT[seg];
  for (let i = 0; i < n; i++) {
    const pos: Position = isD ? "D" : i % 3 === 0 ? "C" : i % 3 === 1 ? "LW" : "RW";
    const goalsM = (isD ? 0.05 : 0.1) + 0.01 * i;
    const shotsM = (isD ? 1.2 : 1.6) + 0.04 * i;
    const pppM = 0.05 + 0.01 * i;
    pool.push(
      player(
        nextId++,
        pos,
        seg.startsWith("young") ? "young" : "vet",
        { goals: goalsM, assists: 0.3, shots: shotsM, powerplayPoints: pppM, blocks: 1.2, faceoffWins: pos === "C" ? 6 : 0.2 },
        {
          goals: d.goals + (i % 2 === 0 ? 0.02 : -0.02),
          assists: d.assists,
          shots: d.shotsA - 0.1 * shotsM,
          powerplayPoints: 0.05 - 0.2 * pppM,
          blocks: 0.1,
          faceoffWins: pos === "C" ? 0.1 : 0.05,
        },
      ),
    );
  }
}
// Short-season player: out of the fit, still calibrated with its segment.
pool.push(player(500, "LW", "young", { goals: 0.3 }, { goals: 0.5 }, 20));
// Goalie and contextual skater: untouched.
const goalie = { id: 900, isGoalie: true, position: "G" as Position, gamesPlayed: 50, projectionMethod: "ml", projection: { wins: 25, saves: 1200, shutouts: 3, savePct: 0.91 } };
const contextual = { ...player(901, "C", undefined, { goals: 0.2 }, {}), projectionMethod: "contextual", modelRates: undefined, modelMarketEdge: undefined };

{
  const params = fitRateCalibration(pool);
  assert(params.poolSize.vetF === 40 && params.poolSize.youngF === 30 && params.poolSize.vetD === 30 && params.poolSize.youngD === 26, "fit pool per segment = v2 skaters with 40+ GP");
  assert(params.poolSize.F === 70 && params.poolSize.D === 56, "groups pool their segments");
  assert(RATE_SEGMENTS.every((s) => params.keyOf[s] === s), "segments of 25+ regulars are fit on their own");
  assert(params.targetSource === "zero", "no reference: zero target");
  for (const seg of RATE_SEGMENTS) {
    assert(near(params.raw[seg].goals!.a, DRIFT[seg].goals) && params.raw[seg].goals!.b === 0, `raw ${seg} goals = mean edge, no slope`);
    assert(near(params.raw[seg].shots!.a, DRIFT[seg].shotsA, 1e-9) && near(params.raw[seg].shots!.b, -0.1, 1e-9), `raw ${seg} shots line recovered`);
  }
  assert(near(params.raw.vetF.faceoffWins!.a, 0.1, 1e-9), "faceoff edge fit on centers only");
  assert(params.raw.vetD.faceoffWins === undefined, "no faceoff fit for defensemen");
  assert(near(params.raw.F.goals!.a, (40 * 0.11 + 30 * 0.06) / 70, 1e-9), "group fit pools its segments");

  const { players: out, calibrated } = applyRateCalibration([...pool, goalie as never, contextual as never], { params });
  assert(calibrated === pool.length, "every skater with raw model state is calibrated");
  assert(out.find((p) => p.id === 900) === (goalie as never), "goalie untouched");
  assert(out.find((p) => p.id === 901) === (contextual as never), "contextual skater untouched");
  for (const p of out.filter((x) => x.modelRates)) {
    const c = calibrateRates(p, params);
    for (const cat of SKATER_CATEGORIES) {
      const mkt = (p.modelRates?.[cat] ?? 0) - (p.modelMarketEdge?.[cat] ?? 0);
      if (c.rates[cat] > 0) assert(near(c.rates[cat] - c.edge[cat], mkt, 1e-9), `market unchanged (${p.id} ${cat})`);
    }
  }
  // Every segment's calibrated edge is centered (and a pure market trend is gone).
  for (const seg of RATE_SEGMENTS) {
    const sub = out.filter((p) => p.modelRates && rateSegment(p) === seg && p.gamesPlayed >= RATE_CALIBRATION_MIN_GP);
    for (const cat of ["goals", "assists"] as const) {
      assert(Math.abs(mean(sub.map((p) => p.marketEdge?.[cat] ?? 0))) < 1e-4, `${seg} ${cat} edge centered`);
    }
    assert(sub.every((p) => Math.abs(p.marketEdge?.shots ?? 1) < 1e-4), `${seg} shots edge that was a pure line is removed`);
    assert(sub.every((p) => Math.abs(p.marketEdge?.powerplayPoints ?? 1) < 1e-4), `${seg} PPP edge that was a pure line is removed`);
  }
  // Young forwards lose their own drift, not the veterans' (the 2026-09 bug).
  const youngF = out.find((p) => rateSegment(p) === "youngF" && p.gamesPlayed >= 40)!;
  assert(near(calibrateRates(youngF, params).rates.goals, (youngF.modelRates!.goals ?? 0) - 0.06, 1e-9), "young forward calibrated with the young drift");
  const winger = out.find((p) => p.id === 2)!;
  assert(near(calibrateRates(winger, params).rates.faceoffWins, 0.25, 1e-9), "winger faceoffs are not shifted by the centers' fit");
  assert(out.filter((p) => rateGroup(p) === "D").every((p) => (p.projection as SkaterProjection).faceoffWins === 0), "defensemen keep 0 faceoffs");
  const short = out.find((p) => p.id === 500)!;
  assert(near(calibrateRates(short, params).rates.goals, 0.8 - 0.06, 1e-9), "short-season skater calibrated with its segment's fit");
  // Unknown segment: the F / D group.
  const unknown = { ...player(600, "RW", undefined, { goals: 0.3 }, { goals: 0.2 }), gamesPlayed: 10 };
  assert(calibrationKey(unknown, params) === "F", "no segment → group key");
  assert(near(calibrateRates(unknown, params).rates.goals, 0.5 - params.raw.F.goals!.a, 1e-9), "no segment → group fit");

  // Idempotence: recalibrating the output (same raw state) changes nothing.
  const again = applyRateCalibration(out);
  assert(JSON.stringify(again.params) === JSON.stringify(params), "refit on the calibrated board gives the same fit");
  assert(JSON.stringify(again.players) === JSON.stringify(out), "calibration is idempotent");

  // A cell without a usable edge is the market plus the target edge, out of the fit.
  const noEdge = player(700, "RW", "vet", { goals: 0.4, hits: 2 }, { goals: 0.11 });
  delete noEdge.modelMarketEdge!.hits;
  const c = calibrateRates(noEdge, params);
  assert(near(c.rates.hits, 2) && c.edge.hits === 0, "missing edge, zero target: rate kept as the market");
  const withIt = fitRateCalibration([...pool, { ...noEdge, gamesPlayed: 80 }]);
  assert(near(withIt.raw.vetF.hits!.a, params.raw.vetF.hits!.a), "missing edge ignored by the fit");
}

// --- small segment falls back to its group ---
{
  const small = pool.filter((p) => rateSegment(p) !== "youngD" || p.id % 2 === 0);
  const params = fitRateCalibration(small);
  assert(params.poolSize.youngD < 25 && params.keyOf.youngD === "D", "segment below 25 regulars fit with its group");
  const yd = small.find((p) => rateSegment(p) === "youngD")!;
  assert(calibrationKey(yd, params) === "D", "its players use the group key");
}

// --- healthy reference target ---
{
  // Reference: veteran D hits edge −0.16 per game (the Marcel market
  // over-projects them), young forwards' goals +0.01, PPP line.
  const lines = Object.fromEntries(RATE_KEYS.map((k) => [k, {}])) as unknown as EdgeLines;
  lines.vetD.hits = { a: -0.16, b: 0 };
  lines.youngF.goals = { a: 0.01, b: 0 };
  lines.vetF.powerplayPoints = { a: 0.02, b: -0.05 };
  const reference: RateReference = { version: 1, bundleTrainedAt: "x", source: "test board", fittedAt: "x", poolSize: Object.fromEntries(RATE_KEYS.map((k) => [k, 30])) as Record<(typeof RATE_KEYS)[number], number>, lines };
  const withHits = pool.map((p) =>
    rateSegment(p) === "vetD"
      ? { ...p, modelRates: { ...p.modelRates, hits: 1.5 + 0.3 }, modelMarketEdge: { ...p.modelMarketEdge, hits: 0.3 } }
      : p,
  );
  const params = fitRateCalibration(withHits, reference);
  assert(params.targetSource === "test board", "reference recorded as the target");
  const out = applyRateCalibration(withHits, { params }).players;
  const vetD = out.filter((p) => rateSegment(p) === "vetD" && p.gamesPlayed >= 40);
  assert(near(mean(vetD.map((p) => p.marketEdge?.hits ?? 0)), -0.16, 1e-4), "vet D hits edge moved onto the reference's −0.16");
  const youngF = out.filter((p) => rateSegment(p) === "youngF" && p.gamesPlayed >= 40);
  assert(near(mean(youngF.map((p) => p.marketEdge?.goals ?? 0)), 0.01, 1e-4), "young F goals edge moved onto the reference's +0.01");
  const vetF = out.filter((p) => rateSegment(p) === "vetF" && p.gamesPlayed >= 40);
  assert(
    vetF.every((p) => {
      const m = (p.modelRates?.powerplayPoints ?? 0) - (p.modelMarketEdge?.powerplayPoints ?? 0);
      return near(p.marketEdge?.powerplayPoints ?? 9, 0.02 - 0.05 * m, 1e-4);
    }),
    "vet F PPP edge follows the reference line",
  );
  // A no-edge cell gets the target edge.
  const repairedD = { ...vetD[0], modelMarketEdge: { ...vetD[0].modelMarketEdge } };
  delete repairedD.modelMarketEdge.hits;
  repairedD.modelRates = { ...repairedD.modelRates, hits: 2 };
  assert(near(calibrateRates(repairedD, params).rates.hits, 2 - 0.16, 1e-9), "repaired cell = market + reference edge");
  assert(near(targetEdge("hits", 2, repairedD, params), -0.16, 1e-12), "targetEdge reads the reference");
  // The reference script fits a healthy board with the same function.
  const refit = fitEdgeLines(
    vetD.map((p) => ({ ...edgeSample(p), edge: { hits: p.marketEdge?.hits ?? 0 }, market: { hits: 1.5 } })),
  );
  assert(near(refit.lines.vetD.hits!.a, -0.16, 1e-4), "fitEdgeLines of the calibrated edges gives back the target");
}

// --- level guard against the no-growth market ---
{
  const lvl = segmentLevels(applyRateCalibration(pool).players);
  assert(lvl.some((l) => l.segment === "youngF" && l.cat === "goals"), "levels reported per segment × stat");
  // The 2026-09 F / D calibration: young forwards at 0.77 of their market.
  const shrunk = pool.map((p) =>
    rateSegment(p) === "youngF"
      ? { ...p, projection: { ...p.projection, goals: Math.round(p.projection.goals * 0.4) } }
      : p,
  );
  const issues = segmentLevelIssues(shrunk);
  assert(issues.some((s) => s.startsWith("youngF goals")), `young forwards far below their market are flagged (${issues.join("; ")})`);
}

// --- rate limits ---
assert(SKATER_RATE_LIMITS.D.goals >= 0.4, "D goals limit sits above the realized record pace (0.456 max)");
{
  const makarLike = totalsFromRates(
    rates({ goals: 0.32, assists: 0.85, shots: 3.1, blocks: 1.4, hits: 0.5, powerplayPoints: 0.4, penaltyMinutes: 0.3 }) as Record<SkaterCategory, number>,
    70,
    "D",
  );
  assert(makarLike.goals === 22, `a 0.32 goals/game defenseman keeps 22 goals over 70 games (got ${makarLike.goals})`);
  const oldCap = clampSkaterProjection({ ...makarLike, goals: 40 }, 70, "D");
  assert(oldCap.goals === Math.floor(SKATER_RATE_LIMITS.D.goals * 70), "runaway output is still clamped");
  const issues = findProjectionIssues([
    { name: "Makar-like", position: "D", isGoalie: false, gamesPlayed: 70, projection: makarLike },
  ]);
  assert(issues.length === 0, "sanity check accepts a 22-goal defenseman");
}

// --- legacy board bootstrap ---
{
  assert(legacyCappedTotal(0.18, 58, 70) === 12, "legacy cap: floor(0.18·58) scaled to 70 GP = 12 (Makar 2026-08-11)");
  assert(legacyCappedTotal(0.18, 60, 60) === 10, "legacy cap without GP calibration = floor");
  const makar = {
    position: "D" as Position,
    primaryPosition: "D" as Position,
    gamesPlayed: 70,
    modelGamesPlayed: 58,
    projection: { goals: 12, assists: 65, shots: 218, blocks: 112, hits: 41, powerplayPoints: 25, penaltyMinutes: 19, faceoffWins: 0 },
  };
  assert(JSON.stringify(legacyCappedCells(makar)) === JSON.stringify(["goals"]), "legacy capped cell detected");
  const edge = { goals: 0.0446, assists: 0.1831, shots: 0.4494, blocks: 0.0518, hits: 0.1085, powerplayPoints: 0.0144, penaltyMinutes: -0.0294 };
  // Rebuild = the board's implied market for every uncapped cell.
  const market: Partial<Record<SkaterCategory, number>> = { goals: 0.2753 };
  for (const cat of ["assists", "shots", "blocks", "hits", "powerplayPoints", "penaltyMinutes"] as const) {
    market[cat] = makar.projection[cat] / 70 - edge[cat];
  }
  const b = bootstrapModelRates(makar, edge, market, false);
  assert(near(b.rates.goals, 0.2753 + 0.0446, 1e-9), "capped cell restored to market + edge");
  assert(near(b.rates.assists, 65 / 70, 1e-9), "unreliable rebuild: uncapped cell keeps its published rate");
  assert(b.uncapped.join() === "goals" && b.repaired.length === 0 && b.rebased.length === 0, "only the capped cell moves");
  const br = bootstrapModelRates(makar, edge, market, true);
  assert(near(br.rates.assists, 65 / 70, 1e-9) && br.rebased.length === 0, "reliable rebuild equal to the board: nothing reported as rebased");

  // Moderately wrong market (a hits history 20% too high): rebased, edge kept.
  const stone = {
    position: "RW" as Position,
    gamesPlayed: 66,
    projection: { goals: 25, assists: 45, shots: 130, blocks: 30, hits: 50, powerplayPoints: 20, penaltyMinutes: 20, faceoffWins: 10 },
  };
  const sEdge = { hits: 0.05 };
  const sMarket = { hits: 0.62 }; // implied 50/66 − 0.05 = 0.708
  const s = bootstrapModelRates(stone, sEdge, sMarket, true);
  assert(s.rebased.includes("hits") && s.repaired.length === 0, "moderate market gap: rebased, not repaired");
  assert(near(s.rates.hits, 0.62 + 0.05, 1e-9) && s.edge.hits === 0.05, "rebased cell = rebuilt market + raw edge");
  const sUnrel = bootstrapModelRates(stone, sEdge, sMarket, false);
  assert(near(sUnrel.rates.hits, 50 / 66, 1e-9) && sUnrel.rebased.length === 0, "an unreliable rebuild never rebases");

  // Grossly corrupted market input: implied market far above a reliable rebuild.
  const weegar = {
    position: "D" as Position,
    gamesPlayed: 76,
    modelGamesPlayed: 64,
    projection: { goals: 6, assists: 25, shots: 150, blocks: 221, hits: 228, powerplayPoints: 5, penaltyMinutes: 40, faceoffWins: 0 },
  };
  const wEdge = { blocks: -0.302, hits: -0.222 };
  const wMarket = { goals: 0.08, assists: 0.33, shots: 1.97, blocks: 2.078, hits: 2.109, powerplayPoints: 0.066, penaltyMinutes: 0.53 };
  const w = bootstrapModelRates(weegar, wEdge, wMarket, true);
  assert(w.repaired.includes("blocks") && w.repaired.includes("hits"), "corrupted blocks / hits markets repaired");
  assert(near(w.rates.blocks, 2.078) && w.edge.blocks === undefined, "repaired cell = rebuilt market, no edge");
  const wUnreliable = bootstrapModelRates(weegar, wEdge, wMarket, false);
  assert(wUnreliable.repaired.length === 0, "an unreliable rebuild never overrules the board");
}

// --- publish split keeps the raw model state in the details ---
{
  const p = {
    id: 1, name: "x", team: "COL", position: "D", positions: ["D"], isGoalie: false, gamesPlayed: 70,
    projection: rates({ goals: 19 }), categoryZScores: {}, fantasyValue: 0, vor: 0, rank: 1, positionRank: 1,
    marketEdge: { goals: 0.01 }, modelRates: { goals: 0.32 }, modelMarketEdge: { goals: 0.045 }, modelSegment: "vet",
  } as unknown as PlayerProjection;
  const { board, detail } = splitPublishedPlayer(p);
  assert(!("modelRates" in board) && !("modelMarketEdge" in board) && !("modelSegment" in board), "raw model state stays off the board");
  assert(detail.modelRates?.goals === 0.32 && detail.modelMarketEdge?.goals === 0.045 && detail.modelSegment === "vet", "raw model state goes to the details");
}

// --- committed board ---
{
  const root = process.cwd();
  const data = JSON.parse(readFileSync(join(root, "src", "data", "players.json"), "utf8")) as ProjectionsDataset;
  const details = JSON.parse(readFileSync(join(root, "public", "player-details.json"), "utf8")) as Record<string, PlayerDetailRecord>;
  const meta = data.rateCalibration;
  assert(meta?.version === 2, "players.json records the per-segment rate calibration");
  assert(meta != null && meta.targetSource !== "zero", "calibration targets the healthy reference board");
  assert(meta != null && RATE_SEGMENTS.every((s) => meta.keyOf[s] === s), "every meta segment is fit on its own");
  const skaters = data.players.filter((p) => !p.isGoalie);
  const hydrated = skaters.map((p) => {
    const d = details[String(p.id)];
    return { ...p, modelRates: d?.modelRates, modelMarketEdge: d?.modelMarketEdge, modelSegment: d?.modelSegment };
  });
  const v2 = hydrated.filter((p) => p.modelRates);
  assert(v2.length > 900, `raw model rates kept for the v2 skaters (${v2.length})`);
  assert(v2.filter((p) => p.projectionMethod === "ml").every((p) => p.modelSegment === "young" || p.modelSegment === "vet"), "every v2 skater carries its meta segment");

  // Totals are the calibrated rates × games (clamps only for their consistency floors).
  let mismatches = 0;
  for (const p of v2) {
    if (!meta) break;
    const c = calibrateRates(p, meta);
    const proj = p.projection as SkaterProjection;
    for (const cat of ["goals", "assists", "blocks", "hits"] as const) {
      if (proj[cat] !== Math.max(0, Math.round(c.rates[cat] * p.gamesPlayed))) mismatches++;
    }
  }
  assert(mismatches === 0, `published totals = round(calibrated rate × GP) (${mismatches} mismatches)`);

  const dRates = skaters
    .filter((p) => (p.primaryPosition ?? p.position) === "D" && p.gamesPlayed >= 20)
    .map((p) => (p.projection as SkaterProjection).goals / p.gamesPlayed);
  assert(Math.max(...dRates) <= 0.4, `no defenseman above 0.40 goals per game (max ${Math.max(...dRates).toFixed(3)})`);
  assert(dRates.filter((r) => r > 0.2).length >= 4, "several defensemen above the old 0.18 cap");
  const makar = skaters.find((p) => p.id === 8480069);
  assert(
    makar != null && (makar.projection as SkaterProjection).goals / makar.gamesPlayed >= 0.25,
    "Makar projects at 0.25+ goals per game",
  );

  // League level: goals and shots per skater-game over the v2 regulars.
  const regulars = v2.filter((p) => p.gamesPlayed >= RATE_CALIBRATION_MIN_GP && p.projectionMethod === "ml");
  const gp = regulars.reduce((s, p) => s + p.gamesPlayed, 0);
  const perGame = (cat: SkaterCategory) =>
    regulars.reduce((s, p) => s + (p.projection as SkaterProjection)[cat], 0) / gp;
  assert(perGame("goals") > 0.15 && perGame("goals") < 0.21, `goals per skater-game ${perGame("goals").toFixed(3)} in (0.15, 0.21)`);
  assert(perGame("shots") > 1.35 && perGame("shots") < 1.8, `shots per skater-game ${perGame("shots").toFixed(2)} in (1.35, 1.8)`);

  // Per segment the calibrated edge sits on the target (the healthy
  // reference), not on a pooled F / D mean.
  if (meta) {
    for (const seg of RATE_SEGMENTS) {
      const sub = regulars.filter((p) => rateSegment(p) === seg);
      for (const cat of ["goals", "assists", "powerplayPoints", "shots", "hits", "blocks"] as const) {
        const withEdge = sub.filter((p) => typeof p.modelMarketEdge?.[cat] === "number");
        const got = mean(withEdge.map((p) => details[String(p.id)]?.marketEdge?.[cat] ?? 0));
        const want = mean(
          withEdge.map((p) => targetEdge(cat, (p.modelRates?.[cat] ?? 0) - (p.modelMarketEdge?.[cat] ?? 0), p, meta)),
        );
        assert(Math.abs(got - want) < 0.005, `${seg} ${cat}: mean calibrated edge ${got.toFixed(4)} on the target ${want.toFixed(4)}`);
      }
    }
  }

  // Against the no-growth market, per segment × stat.
  const levelIssues = segmentLevelIssues(v2.filter((p) => p.projectionMethod === "ml"));
  assert(levelIssues.length === 0, `segment levels inside their bounds: ${levelIssues.join("; ")}`);

  // Outside reference: 2025-26 realized. Young forwards grow (~8% a season
  // for ≤ 2-season players, 2015-26), so their projection at their 2025-26
  // games must not fall below what they did; veteran D shots decline ~3.5%.
  const profileDoc = JSON.parse(readFileSync(join(root, "src", "data", "player-profiles.json"), "utf8")) as {
    profiles: PlayerProfile[] | Record<string, PlayerProfile>;
  };
  const season = new Map<number, PlayerProfile["teamHistory"][number]>();
  for (const pr of Object.values(profileDoc.profiles)) {
    const s = (pr.teamHistory ?? []).find((h) => !h.isGoalie && h.seasonId === 20252026);
    if (s && s.gamesPlayed >= 40) season.set(pr.id, s);
  }
  const realizedKey: Partial<Record<SkaterCategory, (h: PlayerProfile["teamHistory"][number]) => number>> = {
    goals: (h) => Number(h.stats.goals ?? 0),
    powerplayPoints: (h) => Number(h.stats.ppPoints ?? 0),
    shots: (h) => Number(h.stats.shots ?? 0),
  };
  const vsRealized = (seg: RateSegment, cat: SkaterCategory) => {
    let proj = 0;
    let real = 0;
    for (const p of regulars.filter((x) => rateSegment(x) === seg)) {
      const s = season.get(p.id);
      if (!s) continue;
      proj += ((p.projection as SkaterProjection)[cat] / p.gamesPlayed) * s.gamesPlayed;
      real += realizedKey[cat]!(s);
    }
    return real > 0 ? proj / real : NaN;
  };
  for (const cat of ["goals", "powerplayPoints"] as const) {
    const r = vsRealized("youngF", cat);
    assert(r >= 1, `young F ${cat}: projection / 2025-26 realized ${r.toFixed(3)} ≥ 1`);
  }
  const dShots = vsRealized("vetD", "shots");
  assert(dShots >= 0.94, `veteran D shots: projection / 2025-26 realized ${dShots.toFixed(3)} ≥ 0.94`);
}

if (failed) {
  console.error(`${failed} rate-calibration check(s) failed`);
  process.exit(1);
}
console.log("OK: rate calibration");
