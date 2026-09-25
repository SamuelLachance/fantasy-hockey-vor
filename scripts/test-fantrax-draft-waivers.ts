/**
 * Unit checks for the draft VONA helper and the waiver Δ scorer.
 * Run: npx tsx scripts/test-fantrax-draft-waivers.ts
 */
import type { SlotId } from "../src/lib/fantrax/config";
import { draftOutlook, draftValue, type DraftPickInfo, type DraftPoolPlayer } from "../src/lib/fantrax/draft";
import { eligibleSlots, type LineupCandidate } from "../src/lib/fantrax/lineup";
import { waiverTargets, type WaiverDay } from "../src/lib/fantrax/waivers";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

// ---- draft: fixed order, me = "me" at picks 4 and 8 of 10.
const picks: DraftPickInfo[] = Array.from({ length: 10 }, (_, i) => ({
  pick: i + 1,
  round: 1,
  teamId: i === 3 || i === 7 ? "me" : `t${i}`,
  ...(i < 2 ? { playerId: `taken${i}` } : {}),
}));
const pool: DraftPoolPlayer[] = [
  { id: "taken0", groups: ["C"], seasonFp: 400, adp: 1 },
  { id: "g1", groups: ["G"], seasonFp: 250, adp: 3 },
  { id: "g2", groups: ["G"], seasonFp: 200, adp: 50 },
  { id: "d1", groups: ["D"], seasonFp: 240, adp: 4 },
  { id: "d2", groups: ["D"], seasonFp: 235, adp: 60 },
  { id: "w1", groups: ["W"], seasonFp: 300, adp: 2 },
  { id: "w2", groups: ["W"], seasonFp: 290, adp: 70 },
  { id: "c1", groups: ["C"], seasonFp: 280, adp: 80 },
];
const o = draftOutlook(picks, "me", pool, {});
assert(o.state === "running" && o.made === 2, "2 of 10 made");
assert(o.current?.pick === 3 && o.next?.pick === 4 && o.following?.pick === 8, "current #3, mine #4 then #8");
assert(o.picksBefore === 1, "one pick before mine");
// Before #4 the ADP-first survivor (w1, ADP 2) goes; before #8 three more go
// in ADP order (g1, d1, then g2 at ADP 50).
assert(o.vona.W.bestId === "w2" && near(o.vona.W.vona!, 0), "W: w1 gone by #4, w2 (ADP 70) still there at #8");
assert(o.vona.G.bestId === "g1" && near(o.vona.G.vona!, 250), "G: steep drop (g1, g2 both gone by #8)");
assert(o.vona.D.bestId === "d1" && near(o.vona.D.vona!, 240 - 235), "D: flat");
assert(o.board[0]!.id === "w1" && o.board[0]!.likelyGone, "best now is flagged as likely gone");
assert(!o.board.some((b) => b.id === "taken0"), "drafted players leave the board");
// Empty D/G slots add up to +50%.
assert(near(draftValue(pool[3]!, { D: 1 }), 240 * 1.5) && near(draftValue(pool[3]!, { G: 1 }), 240), "need bonus");
const onClock = draftOutlook(
  picks.map((p) => (p.pick === 3 ? { ...p, playerId: "c1" } : p)),
  "me",
  pool,
);
assert(onClock.picksBefore === 0 && onClock.next?.pick === 4, "on the clock → 0 picks before");
// When two picks in three go to prospects outside the pool, fewer pool
// players are expected gone: 1 × 1/3 → none before #4, 3 × 1/3 → one
// (w1, first by ADP) between #4 and #8.
const third = draftOutlook(picks, "me", pool, {}, { poolShare: 1 / 3 });
assert(third.vona.W.bestId === "w1" && !third.board.find((b) => b.id === "w1")?.likelyGone, "w1 survives to #4");
assert(near(third.vona.W.vona!, 300 - 290), "W: w1 gone by #8, w2 left");
assert(third.vona.G.bestId === "g1" && near(third.vona.G.vona!, 0), "G: g1 still there at #8");
const done = draftOutlook(picks.map((p) => ({ ...p, playerId: p.playerId ?? `x${p.pick}` })), "me", pool);
assert(done.state === "done" && done.next === null, "finished draft");

// ---- waivers: roster with an empty D slot; two lineup days.
const cand = (id: string, e: string, v: number, status = "ACTIVE"): LineupCandidate => {
  const eligible = eligibleSlots(e);
  const values: Partial<Record<SlotId, number>> = {};
  for (const s of eligible) values[s] = s === "Skt" ? 1.5 * v : v;
  return { id, eligible, status, values };
};
const roster = [cand("f1", "W,F,Skt", 3), cand("f2", "W,F,Skt", 2), cand("d1", "D,Skt", 2)];
const pickups: Record<string, number> = { fa: 3, ww: 3.2 };
const days: WaiverDay[] = [0, 1].map((i) => ({
  candidates: roster,
  wwUsable: i >= 1,
  poolCandidate: (id) => (pickups[id] ? cand(id, "D", pickups[id]!, id === "ww" ? "WW" : "FA") : null),
}));
const t = waiverTargets(
  days,
  [
    { id: "fa", status: "FA", fpg: 3, gamesLeftSeason: 80 },
    { id: "ww", status: "WW", fpg: 3.2, gamesLeftSeason: 80 },
  ],
  { slotCounts: { C: 0, W: 2, F: 0, D: 2, Skt: 1, G: 0 }, needsDrop: false, drops: [], minDelta: 3 },
);
assert(t[0]?.id === "fa" && near(t[0].delta, 6) && t[0].days === 2, "FA plays both days (+6)");
assert(t[1]?.id === "ww" && near(t[1].delta, 3.2) && t[1].days === 1, "WW only from day 2 (+3.2)");
const filtered = waiverTargets(days, [{ id: "ww", status: "WW", fpg: 3.2, gamesLeftSeason: 80 }], {
  slotCounts: { C: 0, W: 2, F: 0, D: 2, Skt: 1, G: 0 },
  needsDrop: false,
  drops: [],
  minDelta: 5,
});
assert(filtered.length === 0, "gains below the threshold are hidden");
// Full roster: the cheapest drop is used.
const full = waiverTargets(days, [{ id: "fa", status: "FA", fpg: 3, gamesLeftSeason: 80 }], {
  slotCounts: { C: 0, W: 2, F: 0, D: 1, Skt: 0, G: 0 },
  needsDrop: true,
  drops: [
    { id: "f1", action: "drop", fpg: 3 },
    { id: "d1", action: "minors", fpg: 2 },
  ],
  minDelta: 1,
});
assert(full[0]?.drop?.id === "d1" && full[0].drop.action === "minors" && near(full[0].delta, 2), "swap D for D, send the weaker to Minors");

if (failed) process.exit(1);
console.log("OK: fantrax draft + waivers");
