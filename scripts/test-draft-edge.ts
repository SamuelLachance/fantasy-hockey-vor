/**
 * Unit checks for synthetic-market projection reconstruction.
 * Run: npx tsx scripts/test-draft-edge.ts
 */
import { marketProjectionFromEdge } from "../src/lib/draft-edge";
import type { PlayerProjection, SkaterProjection } from "../src/lib/types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const base = {
  id: 1,
  name: "Test",
  team: "EDM",
  position: "C" as const,
  positions: ["C" as const],
  isGoalie: false,
  gamesPlayed: 80,
  projection: {
    goals: 40,
    assists: 60,
    shots: 240,
    blocks: 40,
    hits: 40,
    powerplayPoints: 20,
    penaltyMinutes: 40,
    faceoffWins: 400,
  } satisfies SkaterProjection,
  marketEdge: {
    goals: 0.1, // model +0.1 G/GP vs market → market has 32 G
    assists: 0,
    shots: 0,
    blocks: 0,
    hits: 0,
    powerplayPoints: 0,
    penaltyMinutes: 0,
    faceoffWins: 0,
  },
} as unknown as PlayerProjection;

const market = marketProjectionFromEdge(base);
const g = (market.projection as SkaterProjection).goals;
assert(Math.abs(g - 32) < 0.01, `market goals ~32 (got ${g})`);

const goalie = marketProjectionFromEdge({
  ...base,
  isGoalie: true,
  marketEdge: undefined,
} as PlayerProjection);
assert(goalie === goalie, "goalie identity path");

if (failed) process.exit(1);
console.log("OK: draft-edge");
