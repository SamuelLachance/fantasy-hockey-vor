/**
 * The week's streaming plan (src/lib/fantrax/streamers.ts): a chain of
 * claims on one roster spot, solved over the days under the claims limit,
 * the waiver delay and the games caps.
 * Run: npx tsx scripts/test-streamers.ts
 */
import type { SlotCounts, SlotId } from "../src/lib/fantrax/config";
import type { LineupCandidate } from "../src/lib/fantrax/lineup";
import { planStreamers, type StreamDay } from "../src/lib/fantrax/streamers";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failed++;
    console.error(`FAIL: ${name}${detail ? ` (${detail})` : ""}`);
  }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const slots: SlotCounts = { C: 1, W: 1 };
const order: readonly SlotId[] = ["C", "W"];
const cand = (id: string, slot: SlotId, value: number, status = "ACTIVE"): LineupCandidate => ({ id, eligible: [slot], status, values: { [slot]: value }, games: value > 0 ? 1 : 0 });

// Roster: a centre and a winger at 3 a night, a bench winger X (never starts).
const roster = [cand("A", "C", 3), cand("B", "W", 3), cand("X", "W", 0.5, "RESERVE")];
// Streamers: S1 plays nights 0-1 at 5, S2 nights 2-3 at 6, S3 night 0 only at 9 (a waiver claim).
const plays: Record<string, number[]> = { S1: [5, 5, 0, 0], S2: [0, 0, 6, 6], S3: [9, 0, 0, 0] };
const days = (wwFrom: number): StreamDay[] =>
  [0, 1, 2, 3].map((i) => ({
    number: 100 + i,
    date: `2026-10-${String(26 + i).padStart(2, "0")}`,
    candidates: roster,
    poolCandidate: (id: string) => ((plays[id]?.[i] ?? 0) > 0 ? cand(id, "W", plays[id]![i]!, "FA") : null),
    wwUsable: i >= wwFrom,
    capKey: 7,
  }));
const pool = [
  { id: "S1", status: "FA" as const },
  { id: "S2", status: "FA" as const },
  { id: "S3", status: "WW" as const },
];
const base = { slotCounts: slots, slotOrder: order, needsDrop: true, drops: [{ id: "X", action: "drop" as const, fpg: 0.5 }], minGain: 1 };

{
  // Waiver not usable on night 0: S3 is out; S1 then S2 is the best chain (+2 +2, +3 +3).
  const plan = planStreamers(days(1), pool, { ...base, maxClaims: 2 });
  check("two claims: S1 then S2", plan?.steps.map((s) => s.id).join() === "S1,S2", JSON.stringify(plan?.steps));
  check("first stretch nights 0-1, second 2-3", plan?.steps[0]?.from === 0 && plan.steps[0].to === 1 && plan.steps[1]?.from === 2 && plan.steps[1].to === 3);
  check("gain 10", near(plan?.gain ?? 0, 10), String(plan?.gain));
  check("only the first claim lets a player go", plan?.steps[0]?.drop?.id === "X" && plan.steps[1]?.drop === null);
  check("games per stretch", plan?.steps[0]?.games === 2 && plan.steps[1]?.games === 2);
  check("no cap: capped = uncapped", near(plan?.gain ?? 0, plan?.gainUncapped ?? -1) && plan?.capLimited === false);
}
{
  // One claim only: S2 alone from night 0 (nights 0-1 cost nothing: X would not play anyway) beats S1 alone (4).
  const plan = planStreamers(days(1), pool, { ...base, maxClaims: 1 });
  check("one claim: the best single streamer", plan?.steps.length === 1 && plan.steps[0]!.id === "S2" && near(plan.gain, 6), JSON.stringify(plan?.steps));
}
{
  // A waiver claim made now clears for night 1: S3's night 0 cannot be claimed; once usable from night 0 he beats S1 on that night.
  const planNow = planStreamers(days(0), pool, { ...base, maxClaims: 3 });
  check("waiver usable on night 0: S3 starts the chain", planNow?.steps[0]?.id === "S3", JSON.stringify(planNow?.steps));
  const planLate = planStreamers(days(1), pool, { ...base, maxClaims: 3 });
  check("waiver not usable on night 0: S3 never starts a stretch on it", !planLate?.steps.some((s) => s.id === "S3" && s.from === 0));
}
{
  // The claims limit: a third claim must add `minGain` over the shorter plan, so no useless claim.
  const plan = planStreamers(days(1), pool, { ...base, maxClaims: 3, minGain: 1 });
  check("never more claims than they pay for", (plan?.steps.length ?? 0) <= 2, String(plan?.steps.length));
  check("no claims allowed: no plan", planStreamers(days(1), pool, { ...base, maxClaims: 0 }) === null);
}
{
  // A roster with room: nobody is let go.
  const plan = planStreamers(days(1), pool, { ...base, maxClaims: 2, needsDrop: false, drops: [] });
  check("open spot: no drop", plan != null && plan.steps.every((s) => s.drop === null) && near(plan.gain, 10), JSON.stringify(plan?.steps));
}
{
  // Games cap of 2 skater games over the 4 nights: only the best games count, so the streamers add their edge on those, not on all eight.
  const plan = planStreamers(days(1), pool, {
    ...base,
    maxClaims: 2,
    capOf: () => ({ gpMax: 2, gsMax: null, gpUsed: 0, gsUsed: 0 }),
  });
  // The cap makes S1 pointless: S2 alone already fills the two games that count (6), a second claim adds nothing.
  check("a binding cap drops the claim it makes useless", plan?.steps.length === 1 && plan.steps[0]!.id === "S2" && near(plan.gain, 6), JSON.stringify(plan));
}

{
  // A player is never let go and picked up again: R (nights 0-1 and 3) can hold only one stretch.
  const p2: Record<string, number[]> = { R: [5, 5, 0, 6], P: [0, 0, 7, 0], Q: [0, 0, 0, 4] };
  const d2: StreamDay[] = [0, 1, 2, 3].map((i) => ({
    number: 200 + i,
    date: `2026-10-${26 + i}`,
    candidates: roster,
    poolCandidate: (id: string) => ((p2[id]?.[i] ?? 0) > 0 ? cand(id, "W", p2[id]![i]!, "FA") : null),
    wwUsable: true,
    capKey: 7,
  }));
  const plan = planStreamers(d2, [{ id: "R", status: "FA" }, { id: "P", status: "FA" }, { id: "Q", status: "FA" }], { ...base, maxClaims: 3 });
  const ids = plan?.steps.map((x) => x.id) ?? [];
  check("no player twice in the chain", new Set(ids).size === ids.length, ids.join());
  check("the best chain without a repeat: R, P, Q", ids.join() === "R,P,Q" && near(plan?.gain ?? 0, 9), JSON.stringify(plan?.steps));
}

{
  const lockedDrop = { ...cand("locked", "C", 1), currentSlot: "C", locked: true };
  const d: StreamDay[] = [0, 1].map((i) => ({
    number: 300 + i,
    date: `2026-10-${28 + i}`,
    candidates: [{ ...lockedDrop, locked: i === 0 }],
    poolCandidate: () => cand("pickup", "C", 10, "FA"),
    wwUsable: true,
    capKey: 1,
  }));
  const p = planStreamers(d, [{ id: "pickup", status: "FA" }], {
    slotCounts: { C: 1 }, slotOrder: ["C"], needsDrop: true,
    drops: [{ id: "locked", action: "drop", fpg: 1 }], minGain: 1, maxClaims: 1,
  });
  check("locked drop: chain waits until tomorrow", p?.steps[0]?.from === 1 && near(p?.gain ?? 0, 9), JSON.stringify(p));
  const open = d.map((day, i) => ({ ...day, candidates: [], canClaim: () => i > 0 }));
  const future = planStreamers(open, [{ id: "pickup", status: "FA" }], {
    slotCounts: { C: 1 }, slotOrder: ["C"], needsDrop: false, drops: [], minGain: 1, maxClaims: 1,
  });
  check("locked pickup: no game credited tonight, future game preserved", future?.steps[0]?.from === 1 && near(future?.gain ?? 0, 10), JSON.stringify(future));
  check("only a locked day: no streaming gain", planStreamers([open[0]!], [{ id: "pickup", status: "FA" }], {
    slotCounts: { C: 1 }, slotOrder: ["C"], needsDrop: false, drops: [], minGain: 1, maxClaims: 1,
  }) === null);
}

{
  // One claim remains this week, then Monday provides two fresh claims.
  // Taking A then B before Monday would spend a claim not available yet.
  const rates: Record<string, number[]> = { A: [8, 0, 0, 0], B: [0, 9, 9, 0], C: [0, 0, 0, 10] };
  const d: StreamDay[] = [0, 1, 2, 3].map((i) => ({
    number: 400 + i, date: `2026-10-${23 + i}`, candidates: [],
    poolCandidate: (id) => rates[id]![i]! > 0 ? cand(id, "C", rates[id]![i]!, "FA") : null,
    wwUsable: true, capKey: 1,
    claimWeek: i < 3 ? "2026-10-19" : "2026-10-26",
    claimsAvailable: i < 3 ? 1 : 2,
  }));
  const opts = { slotCounts: { C: 1 }, slotOrder: ["C"] as const, needsDrop: false, drops: [], minGain: 1, maxClaims: 3 };
  const p = planStreamers(d, Object.keys(rates).map((id) => ({ id, status: "FA" as const })), opts);
  check("weekly reset: future claims cannot be spent early", near(p?.gain ?? 0, 28) && (p?.steps.filter((s) => s.from < 3).length ?? 0) <= 1, JSON.stringify(p));
  // Unspent old claims expire at reset: two consecutive high-value pickups
  // in the new week still cannot consume a one-claim weekly allowance.
  const reset: StreamDay[] = d.slice(0, 3).map((day, i) => ({
    ...day, claimWeek: i === 0 ? "old" : "new", claimsAvailable: 1,
    canClaim: () => i > 0,
    poolCandidate: (id) => id === "A" && i === 1 ? cand(id, "C", 10, "FA") : id === "B" && i === 2 ? cand(id, "C", 11, "FA") : null,
  }));
  const afterReset = planStreamers(reset, [{ id: "A", status: "FA" }, { id: "B", status: "FA" }], { ...opts, maxClaims: 2 });
  check("weekly reset: unused claims do not carry into next week", near(afterReset?.gain ?? 0, 11) && (afterReset?.steps.filter((s) => s.from >= 1).length ?? 0) <= 1, JSON.stringify(afterReset));
}
{
  const d: StreamDay[] = [5, 1].map((strength, i) => ({
    number: 500 + i, date: `2026-10-${28 + i}`, candidates: [cand("regular", "C", strength)],
    poolCandidate: () => cand("bench-one-night", "C", 3, "FA"), wwUsable: true, capKey: 1,
  }));
  const p = planStreamers(d, [{ id: "bench-one-night", status: "FA" }], {
    slotCounts: { C: 1 }, slotOrder: ["C"], needsDrop: false, drops: [], minGain: 1, maxClaims: 1,
  });
  check("streamer appearances exclude his bench night", near(p?.gain ?? 0, 2) && p?.steps[0]?.games === 1, JSON.stringify(p));
}

if (failed > 0) {
  console.error(`${failed} streamer check(s) failed`);
  process.exit(1);
}
console.log("OK: streamers (chain DP, waiver delay, claims limit, open spot, games cap)");
