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
assert(o.picksBefore === 1 && o.picksBeforeFollowing === 4, "one pick before mine, four before the next one");
// ADP ranks among the available: w1 1, g1 2, d1 3, g2 4, d2 5, w2 6, c1 7.
// One pool pick before #4, four before #8 (poolShare 1): G drops from g1
// (250) to g2 (200) and g1 goes early, so G is the position to take now.
const row = (out: typeof o, id: string) => out.board.find((b) => b.id === id)!;
assert(o.vona.G.bestId === "g1" && o.vona.G.vona! > 20, `G: steep drop (${o.vona.G.vona})`);
assert(
  o.vona.G.vona! > o.vona.W.vona! && o.vona.G.vona! > o.vona.D.vona! && o.vona.W.vona! > 0 && o.vona.D.vona! > 0,
  "G outranks the flat W and D",
);
assert(near(o.vona.C.vona!, 0) && near(o.vona.C.now, 280), "C: lone deep-ADP c1 is there both times");
assert(o.vona.G.laterId === "g2", "g2 is the likely best G by #8");
// One pool pick before #4, shared among the seven: ADP-first w1 is the
// likeliest to go (~42%), and the odds add up to exactly one player gone.
assert(
  o.board[0]!.id === "w1" &&
    near(o.board[0]!.available, 0.583, 0.005) &&
    o.board.every((b) => b.available >= o.board[0]!.available),
  `ADP-first w1: likeliest gone by #4 (${o.board[0]!.available})`,
);
assert(near(o.board.reduce((a, b) => a + 1 - b.available, 0), 1, 1e-6), "one pool pick → one player expected gone");
assert(row(o, "c1").available > 0.98 && !row(o, "c1").likelyGone, "deep ADP survives");
assert(row(o, "g1").vona! > 40 && row(o, "g1").vonaGroup === "G", "g1: big per-player VONA");
assert(row(o, "g2").vona! < 0, "g2: worth less than the G expected at #8");
assert(!o.board.some((b) => b.id === "taken0"), "drafted players leave the board");
// Empty D/G slots add up to +50%.
assert(near(draftValue(pool[3]!, { D: 1 }), 240 * 1.5) && near(draftValue(pool[3]!, { G: 1 }), 240), "need bonus");
const onClock = draftOutlook(
  picks.map((p) => (p.pick === 3 ? { ...p, playerId: "c1" } : p)),
  "me",
  pool,
);
assert(onClock.picksBefore === 0 && onClock.next?.pick === 4, "on the clock → 0 picks before");
assert(onClock.board.every((b) => b.available === 1), "on the clock → everyone is still there");
assert(near(onClock.vona.W.now, 300) && onClock.vona.W.bestId === "w1" && onClock.vona.W.bestP === 1, "on the clock → best now is the best left");
// When two picks in three go to prospects outside the pool, fewer pool
// players are expected gone: w1 likely survives to #4 and G is less urgent.
const third = draftOutlook(picks, "me", pool, {}, { poolShare: 1 / 3 });
assert(third.vona.W.bestId === "w1" && !row(third, "w1").likelyGone, "w1 likely survives to #4");
assert(row(third, "w1").available > row(o, "w1").available, "fewer pool picks → better odds");
assert(third.vona.G.vona! > 0 && third.vona.G.vona! < o.vona.G.vona!, "G less urgent with fewer pool picks");
const done = draftOutlook(picks.map((p) => ({ ...p, playerId: p.playerId ?? `x${p.pick}` })), "me", pool);
assert(done.state === "done" && done.next === null, "finished draft");
const last = draftOutlook(picks.map((p) => (p.pick === 8 ? { ...p, teamId: "t7" } : p)), "me", pool);
assert(last.following === null && last.vona.G.vona === null && last.board.every((b) => b.vona === null), "last pick: no VONA");

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
