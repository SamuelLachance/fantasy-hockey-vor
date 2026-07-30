/**
 * Lightweight unit checks for VOR baseline reuse (synthetic-market Edge).
 * Run: npm run test:unit
 */
import assert from "node:assert/strict";
import { applyVor } from "../src/lib/vor";
import { DEFAULT_LEAGUE } from "../src/lib/league";
import type { PlayerProjection, SkaterProjection } from "../src/lib/types";

function skater(
  id: number,
  name: string,
  position: "C" | "LW" | "RW" | "D",
  proj: Partial<SkaterProjection>,
): Omit<
  PlayerProjection,
  "categoryZScores" | "fantasyValue" | "vor" | "rank" | "positionRank"
> {
  const base: SkaterProjection = {
    goals: 20,
    assists: 30,
    shots: 180,
    blocks: 40,
    hits: 50,
    powerplayPoints: 10,
    penaltyMinutes: 20,
    faceoffWins: position === "D" ? 0 : 200,
    ...proj,
  };
  return {
    id,
    name,
    team: "TOR",
    position,
    positions: [position],
    isGoalie: false,
    gamesPlayed: 82,
    projection: base,
    projectionMethod: "ml",
    confidence: 0.7,
    reasoning: "test",
    profileSummary: "test",
  };
}

const pool = Array.from({ length: 80 }, (_, i) => {
  const pos = (["C", "LW", "RW", "D"] as const)[i % 4];
  const tier = Math.max(5, 40 - Math.floor(i / 2));
  return skater(1000 + i, `Player ${i}`, pos, {
    goals: tier,
    assists: tier + 5,
    shots: tier * 8,
    faceoffWins: pos === "D" ? 0 : tier * 10,
  });
});

const model = applyVor(pool, DEFAULT_LEAGUE);
assert.ok(model.draftableIds.length > 0, "draftable pool non-empty");
assert.equal(model.players[0].rank, 1);

const topModelId = model.players[0].id;
const marketPool = pool.map((p) => {
  if (p.id !== topModelId) return p;
  const proj = p.projection as SkaterProjection;
  return {
    ...p,
    projection: {
      ...proj,
      goals: 1,
      assists: 1,
      shots: 40,
      powerplayPoints: 0,
    },
  };
});

const zReference = pool.filter((p) => model.draftableIds.includes(p.id));
const market = applyVor(marketPool, DEFAULT_LEAGUE, {
  categoryWeights: model.categoryWeights,
  replacementLevels: model.replacementLevels,
  zReference,
});

assert.equal(market.players.length, model.players.length);
const marketRankOfTop = market.players.find((p) => p.id === topModelId)?.rank;
assert.ok(marketRankOfTop != null, "market rank exists for model #1");
assert.ok(
  marketRankOfTop > 1,
  `crushing model #1 totals must drop market rank (got ${marketRankOfTop})`,
);

console.log(
  `test-vor-baselines: ok (draftable=${model.draftableIds.length}, marketRankOfModel1=${marketRankOfTop})`,
);
