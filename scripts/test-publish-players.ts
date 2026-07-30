/**
 * Unit checks for published player split/slim.
 * Run: npx tsx scripts/test-publish-players.ts
 */
import { slimUncertainty, splitPublishedPlayer } from "../src/lib/publish-players";
import type { PlayerProjection } from "../src/lib/types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const u = slimUncertainty({
  gamesPlayedSigma: 8,
  aleatoricShare: 0.4,
  total: { sigma: 12, modelSpread: 3, aleatoric: 11 },
  perStat: { goals: { sigma: 5, modelSpread: 1, aleatoric: 4 } },
});
assert(u?.perStat === undefined, "perStat omitted");
assert(u?.gamesPlayedSigma === 8, "gp sigma kept");

const p = {
  id: 99,
  name: "Test",
  team: "TOR",
  position: "C",
  positions: ["C"],
  isGoalie: false,
  gamesPlayed: 80,
  projection: { goals: 30 },
  categoryZScores: {},
  fantasyValue: 1,
  vor: 2,
  rank: 1,
  positionRank: 1,
  reasoning: "note",
  profileSummary: "bio",
  marketEdge: { goals: 0.1 },
  uncertainty: {
    gamesPlayedSigma: 8,
    aleatoricShare: 0.5,
    total: { sigma: 10, modelSpread: 2, aleatoric: 9 },
    perStat: { goals: { sigma: 4, modelSpread: 1, aleatoric: 3 } },
  },
} as unknown as PlayerProjection;

const { board, detail } = splitPublishedPlayer(p);
assert(board.marketEdge === undefined, "marketEdge off board");
assert(board.reasoning === undefined, "reasoning off board");
assert(board.uncertainty?.perStat === undefined, "no perStat on board");
assert(detail.reasoning === "note", "reasoning in detail");
assert(detail.perStatUncertainty?.goals?.sigma === 4, "perStat in detail");
assert(detail.marketEdge?.goals === 0.1, "marketEdge in detail");

if (failed) process.exit(1);
console.log("OK: publish-players");
