/**
 * Snake pick math + "still there at my pick?" probabilities.
 * Run: npx tsx scripts/test-draft-snake.ts
 */
import assert from "node:assert/strict";
import {
  availabilityBand,
  marketPosition,
  probAvailableAt,
} from "../src/lib/draft/availability";
import {
  myPickAfter,
  myPickNumbers,
  nextMyPick,
  pickInfo,
  snakePickNumber,
} from "../src/lib/draft/snake";

// 12 teams, 18 rounds.
assert.deepEqual(myPickNumbers(1, 12, 4), [1, 24, 25, 48]);
assert.deepEqual(myPickNumbers(12, 12, 4), [12, 13, 36, 37]);
assert.deepEqual(myPickNumbers(5, 12, 3), [5, 20, 29]);
assert.equal(myPickNumbers(12, 12, 18).length, 18);
assert.equal(myPickNumbers(12, 12, 18).at(-1), 205, "slot 12 last pick: round 18 is reversed");
assert.equal(myPickNumbers(1, 12, 18).at(-1), 216);
assert.deepEqual(myPickNumbers(0, 12, 18), [], "no slot → no picks");
assert.deepEqual(myPickNumbers(13, 12, 18), []);
// Every pick owned by exactly one slot.
const owners = new Map<number, number>();
for (let slot = 1; slot <= 12; slot++) {
  for (const p of myPickNumbers(slot, 12, 18)) {
    assert.ok(!owners.has(p), `pick ${p} owned twice`);
    owners.set(p, slot);
  }
}
assert.equal(owners.size, 216);
for (let pick = 1; pick <= 216; pick++) {
  const info = pickInfo(pick, 12);
  assert.equal(owners.get(pick), info.slot, `pickInfo slot for ${pick}`);
  assert.equal(snakePickNumber(info.round, info.slot, 12), pick);
}
assert.deepEqual(pickInfo(13, 12), { round: 2, pickInRound: 1, slot: 12 });
assert.equal(nextMyPick([12, 13, 36], 13), 13);
assert.equal(nextMyPick([12, 13, 36], 14), 36);
assert.equal(nextMyPick([12, 13], 14), null);
assert.equal(myPickAfter([12, 13, 36], 13), 36);

// Availability.
assert.deepEqual(marketPosition({ adp: 20, rank: 5 }).source, "adp");
assert.deepEqual(marketPosition({ adp: null, rank: 5 }).source, "rank");
assert.equal(probAvailableAt({ adp: 10, rank: 10 }, 12, 12), 1, "on the clock → available");
const early = probAvailableAt({ adp: 5, rank: 5 }, 1, 24);
const late = probAvailableAt({ adp: 80, rank: 80 }, 1, 24);
assert.ok(early < 0.05, `ADP 5 gone by pick 24 (${early})`);
assert.ok(late > 0.95, `ADP 80 there at pick 24 (${late})`);
const mid = probAvailableAt({ adp: 24, rank: 24 }, 1, 24);
assert.ok(mid > 0.35 && mid < 0.65, `ADP 24 at pick 24 ≈ coin flip (${mid})`);
// Monotone in the target pick, and conditioning on survival raises it.
let prev = 1;
for (let t = 20; t <= 60; t += 5) {
  const p = probAvailableAt({ adp: 40, rank: 40 }, 13, t);
  assert.ok(p <= prev + 1e-12, "monotone");
  prev = p;
}
assert.ok(
  probAvailableAt({ adp: 30, rank: 30 }, 29, 36) > probAvailableAt({ adp: 30, rank: 30 }, 1, 36),
  "a player still there at 29 is likelier to last to 36 than seen from pick 1",
);
// A faller keeps a finite hazard, no NaN.
const faller = probAvailableAt({ adp: 5, rank: 5 }, 60, 61);
assert.ok(Number.isFinite(faller) && faller > 0 && faller < 1, `faller ${faller}`);
// Rank fallback is wider than ADP.
assert.ok(marketPosition({ adp: null, rank: 50 }).sd > marketPosition({ adp: 50, rank: 1 }).sd);
assert.equal(availabilityBand(0.8), "yes");
assert.equal(availabilityBand(0.5), "maybe");
assert.equal(availabilityBand(0.1), "no");

console.log("OK: draft-snake");
