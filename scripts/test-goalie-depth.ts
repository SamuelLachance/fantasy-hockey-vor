/**
 * Unit checks for goalie depth + position leaders.
 * Run: npx tsx scripts/test-goalie-depth.ts
 */
import {
  GOALIE_DEPTH_MAX_GP,
  isStarterEligibleGoalie,
  topByPositionLeaders,
} from "../src/lib/goalie-depth";
import type { PlayerProjection } from "../src/lib/types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(GOALIE_DEPTH_MAX_GP === 8, "depth max stays 8");
assert(
  isStarterEligibleGoalie({ isGoalie: true, gamesPlayed: 9 }),
  "9gp starter",
);
assert(
  !isStarterEligibleGoalie({ isGoalie: true, gamesPlayed: 8 }),
  "8gp depth",
);
assert(
  isStarterEligibleGoalie({ isGoalie: false, gamesPlayed: 1 }),
  "skaters always eligible",
);

const players = [
  {
    id: 1,
    name: "Starter G",
    isGoalie: true,
    gamesPlayed: 40,
    positions: ["G"],
    position: "G",
    vorByPosition: { G: 5 },
    vor: 5,
  },
  {
    id: 2,
    name: "Depth G",
    isGoalie: true,
    gamesPlayed: 4,
    positions: ["G"],
    position: "G",
    vorByPosition: { G: 9 },
    vor: 9,
  },
  {
    id: 3,
    name: "C1",
    isGoalie: false,
    gamesPlayed: 80,
    positions: ["C"],
    position: "C",
    vorByPosition: { C: 4 },
    vor: 4,
  },
] as unknown as PlayerProjection[];

const leaders = topByPositionLeaders(players, 3);
const g = leaders.find((x) => x.position === "G")!;
assert(g.players.length === 1, "G leaders exclude depth");
assert(g.players[0]!.name === "Starter G", "G leader is starter");
const c = leaders.find((x) => x.position === "C")!;
assert(c.players[0]!.name === "C1", "C leader present");

if (failed) process.exit(1);
console.log("OK: goalie-depth");
