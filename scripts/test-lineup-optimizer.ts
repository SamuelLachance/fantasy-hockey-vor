/**
 * Unit checks for the Hungarian lineup optimizer: exact on random rosters
 * (vs an exhaustive DP over slot capacities), captain via the Skt slot.
 * Run: npx tsx scripts/test-lineup-optimizer.ts
 */
import { DEFAULT_SLOT_COUNTS, SLOT_ORDER, type SlotId } from "../src/lib/fantrax/config";
import {
  captainGain,
  captainRanking,
  eligibleSlots,
  hungarianMin,
  optimizeLineup,
  totalWithCaptain,
  type LineupCandidate,
} from "../src/lib/fantrax/lineup";
import { skaterSlotValue } from "../src/lib/fantrax/scoring";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

// Deterministic PRNG (mulberry32) so failures reproduce.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Exhaustive optimum: DP over (player index, remaining capacity per slot type). */
function exactBest(cands: LineupCandidate[], counts: Record<SlotId, number>): number {
  const memo = new Map<string, number>();
  const rec = (i: number, cap: number[]): number => {
    if (i === cands.length) return 0;
    const key = `${i}|${cap.join(",")}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let best = rec(i + 1, cap); // bench
    SLOT_ORDER.forEach((s, k) => {
      if (cap[k]! > 0 && cands[i]!.eligible.includes(s)) {
        const next = [...cap];
        next[k]!--;
        best = Math.max(best, (cands[i]!.values[s] ?? 0) + rec(i + 1, next));
      }
    });
    memo.set(key, best);
    return best;
  };
  return rec(0, SLOT_ORDER.map((s) => counts[s]));
}

const ELIGIBILITY = ["C,F,Skt", "W,F,Skt", "W,C,F,Skt", "D,Skt", "D,W,F,Skt", "G"];

function randomRoster(r: () => number, n: number): LineupCandidate[] {
  return Array.from({ length: n }, (_, i) => {
    const e = eligibleSlots(ELIGIBILITY[Math.floor(r() * ELIGIBILITY.length)]!);
    const hasGame = r() < 0.7;
    const off = hasGame ? r() * 6 : 0;
    const dx = e.includes("D") ? r() * 1.2 : 0;
    const values: Partial<Record<SlotId, number>> = {};
    for (const s of e) values[s] = s === "G" ? (hasGame ? r() * 5 : 0) : skaterSlotValue(off, dx, s, 1.5, { isD: e.includes("D") });
    return { id: `p${i}`, eligible: e, status: r() < 0.5 ? "ACTIVE" : "RESERVE", values };
  });
}

// Hungarian core on a small hand-checked matrix.
const pick = hungarianMin([
  [4, 1, 3],
  [2, 0, 5],
  [3, 2, 2],
]);
assert(pick.join(",") === "1,0,2", `hungarian assignment ${pick.join(",")}`);

// 200 random rosters of up to 12 players, full C3 W5 F1 D3 Skt1 G2 lineup.
const r = rng(20260929);
for (let t = 0; t < 200; t++) {
  const cands = randomRoster(r, 1 + Math.floor(r() * 12));
  const res = optimizeLineup(cands, DEFAULT_SLOT_COUNTS);
  const exact = exactBest(cands, DEFAULT_SLOT_COUNTS);
  assert(near(res.total, exact), `roster ${t}: hungarian ${res.total.toFixed(4)} = exact ${exact.toFixed(4)}`);
  const used = res.assignments.map((a) => a.playerId).filter(Boolean);
  assert(new Set(used).size === used.length, `roster ${t}: nobody placed twice`);
  for (const a of res.assignments) {
    const c = cands.find((x) => x.id === a.playerId);
    if (c) assert(c.eligible.includes(a.slot), `roster ${t}: ${c.id} eligible for ${a.slot}`);
  }
}

const sk = (id: string, e: string, off: number, dx = 0, status = "ACTIVE", currentSlot?: string): LineupCandidate => {
  const eligible = eligibleSlots(e);
  const values: Partial<Record<SlotId, number>> = {};
  for (const s of eligible) values[s] = skaterSlotValue(off, dx, s, 1.5, { isD: eligible.includes("D") });
  return { id, eligible, status, currentSlot, values };
};

// F and Skt take forwards; the captain is the biggest gain.
const roster = [
  sk("c1", "C,F,Skt", 5.4),
  sk("c2", "C,F,Skt", 3.0),
  sk("c3", "C,F,Skt", 2.8),
  // Without C depth the optimizer rightly keeps c1 at C (scarcity beats the
  // captain gain); a fourth C makes the pure captain choice visible.
  sk("c4", "C,F,Skt", 2.6),
  sk("w1", "W,F,Skt", 3.6, 0, "ACTIVE", "Skt"),
  sk("w2", "W,F,Skt", 3.4),
  sk("w3", "W,F,Skt", 3.2),
  sk("w4", "W,F,Skt", 3.1),
  sk("w5", "W,F,Skt", 3.0),
  sk("w6", "W,F,Skt", 2.9),
  sk("w7", "W,F,Skt", 2.7),
  sk("d1", "D,Skt", 2.0, 1.0),
  sk("d2", "D,Skt", 1.8, 0.9),
  sk("d3", "D,Skt", 1.6, 0.8),
  { id: "g1", eligible: eligibleSlots("G"), status: "ACTIVE", values: { G: 3 } },
];
const res = optimizeLineup(roster);
const at = (slot: SlotId) => res.assignments.filter((a) => a.slot === slot).map((a) => a.playerId);
assert(res.captain?.id === "c1", `captain is the top forward (${res.captain?.id})`);
assert(near(res.captain!.gain, 0.5 * 5.4), "captain gain = 0.5 × off");
assert(!at("F").some((id) => id?.startsWith("d")), "F slot takes a forward");
assert(at("D").every((id) => id?.startsWith("d")), "D slots take the D");
assert(at("G")[1] === null, "second G slot left empty with no eligible goalie");
assert(res.moves.some((m) => m.id === "w1" && m.from === "Skt"), "old captain moved out of Skt");

// Captain advice must agree with the optimizer. Without C depth, c1 has the
// biggest isolated Skt gain but is worth more at C (nobody else can fill his
// C slot), so ranking by isolated gain would recommend a switch that lowers
// the lineup total.
const shallow = roster.filter((c) => c.id !== "c4");
const shallowRes = optimizeLineup(shallow);
const ranking = captainRanking(shallow, 20);
assert(ranking[0]?.id === shallowRes.captain?.id, `captain ranking #1 = optimizer's Skt (${ranking[0]?.id} vs ${shallowRes.captain?.id})`);
assert(near(ranking[0]!.total, shallowRes.total) && ranking[0]!.delta === 0, "best captain's total is the optimal total");
const c1Option = ranking.find((x) => x.id === "c1");
assert(!!c1Option && c1Option.delta < 0 && c1Option.gain > ranking[0]!.gain, "c1: biggest isolated gain, yet the lineup loses with him at Skt");
assert(ranking.every((x, i) => i === 0 || x.total <= ranking[i - 1]!.total), "ranked by lineup total");
for (const x of ranking) {
  const forced = shallow.map((c) =>
    c.id === x.id ? { ...c, eligible: ["Skt" as SlotId] } : { ...c, eligible: c.eligible.filter((s) => s !== "Skt") },
  );
  assert(near(x.total, exactBest(forced, DEFAULT_SLOT_COUNTS)), `${x.id} as captain: total matches the exhaustive optimum`);
}
assert(near(totalWithCaptain(shallow, "nobody"), exactBest(shallow.map((c) => ({ ...c, eligible: c.eligible.filter((s) => s !== "Skt") })), DEFAULT_SLOT_COUNTS)), "unknown captain → Skt left empty");

// A D is captain only when 0.5·off − dx beats the best forward's 0.5·off.
const dCap = optimizeLineup([
  sk("f", "W,F,Skt", 2.0),
  sk("d", "D,Skt", 6.0, 0.4),
  sk("d2", "D,Skt", 1.0, 0.3),
]);
assert(dCap.captain?.id === "d", "elite-offense D beats a weak forward for captain");
assert(near(captainGain(sk("d", "D,Skt", 6.0, 0.4)), 0.5 * 6.0 - 0.4), "D captain gain = 0.5·off − dx");
const noDCap = optimizeLineup([sk("f", "W,F,Skt", 4.0), sk("d", "D,Skt", 4.0, 1.5), sk("f2", "W,F,Skt", 1.0)]);
assert(noDCap.captain?.id === "f", "D with big dx stays in the D slot");

// Value 0 (no game, or icon 4 → P(play) 0) never beats a playing player,
// and a slot whose only eligible player doesn't play scores 0.
const zero = optimizeLineup([
  sk("out", "D,Skt", 0, 0, "ACTIVE", "D"),
  sk("in", "D,Skt", 2.0, 0.5, "MINORS"),
  sk("fwd", "W,F,Skt", 5.0),
  { id: "g-off", eligible: eligibleSlots("G"), status: "ACTIVE", currentSlot: "G", values: { G: 0 } },
]);
const zeroD = zero.assignments.filter((a) => a.slot === "D");
assert(zeroD.some((a) => a.playerId === "in" && near(a.value, 2.5)), "playing D placed at off + dx");
assert(zero.captain?.id === "fwd", "forward captains over the D");
assert(near(zero.total, 7.5 + 2.5), `total counts only scoring players (${zero.total})`);
assert(zero.assignments.filter((a) => a.slot === "G").every((a) => a.value === 0), "goalie without a game scores 0");
assert(zero.moves.some((m) => m.id === "in" && m.from === "MINORS"), "promotion from Minors is a move");
assert(!zero.moves.some((m) => m.id === "out"), "a non-playing ACTIVE player is not shuffled needlessly");

if (failed) process.exit(1);
console.log("OK: lineup optimizer (200 random rosters exact)");
