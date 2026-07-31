/**
 * Unit checks for TopPlayers list helpers.
 * Run: npx tsx scripts/test-top-lists.ts
 */
import { steadiestSkaters, topEdgeSkaters } from "../src/lib/top-lists";
import type { PlayerProjection } from "../src/lib/types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const players = [
  {
    id: 1,
    name: "A",
    isGoalie: false,
    vor: 3,
    draftValue: 5,
    uncertainty: { total: { sigma: 90 } },
  },
  {
    id: 2,
    name: "B",
    isGoalie: false,
    vor: 2.5,
    draftValue: 1,
    uncertainty: { total: { sigma: 40 } },
  },
  {
    id: 3,
    name: "G",
    isGoalie: true,
    vor: 4,
    draftValue: 9,
    uncertainty: { total: { sigma: 10 } },
  },
  {
    id: 4,
    name: "C",
    isGoalie: false,
    vor: 1,
    draftValue: 8,
    uncertainty: { total: { sigma: 20 } },
  },
] as unknown as PlayerProjection[];

const edge = topEdgeSkaters(players, 2);
assert(edge[0]!.name === "A", "edge prefers high draftValue skater");
assert(edge.every((p) => !p.isGoalie), "edge skips goalies");

const steady = steadiestSkaters(players, { minVor: 2, limit: 2 });
assert(steady[0]!.name === "B", "steadiest prefers low sigma among VOR≥2");
assert(steady.every((p) => p.vor >= 2), "respects minVor");

if (failed) process.exit(1);
console.log("OK: top-lists");
