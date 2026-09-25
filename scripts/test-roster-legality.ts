/**
 * Unit checks for Fantrax roster legality (an illegal roster scores 0).
 * Run: npx tsx scripts/test-roster-legality.ts
 */
import {
  deadReason,
  evaluateRoster,
  irEligible,
  type PlayerFlags,
  type RosterEntry,
} from "../src/lib/fantrax/roster-rules";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const eq = (a: unknown, b: unknown, msg: string) =>
  assert(a === b, `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const entries = (n: number, status: string, slot = "W", prefix = status): RosterEntry[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, slot, status }));
const healthy = (roster: RosterEntry[]): Record<string, PlayerFlags> =>
  Object.fromEntries(roster.map((r) => [r.id, { icons: [], team: "MTL" }]));

// Quebec Trashers today: 11 active, 1 IR, 29 minors → 11 counted, need 4.
const qt: RosterEntry[] = [
  ...entries(3, "ACTIVE", "C", "c"),
  ...entries(5, "ACTIVE", "W", "w"),
  ...entries(1, "ACTIVE", "D", "d"),
  ...entries(1, "ACTIVE", "Skt", "s"),
  ...entries(1, "ACTIVE", "G", "g"),
  ...entries(1, "INJURED_RESERVE"),
  ...entries(29, "MINORS"),
];
const flags = healthy(qt);
flags.d0 = { icons: ["4", "31"], team: "SEA" }; // Chase Reid: "Minor Leagues"
flags.INJURED_RESERVE0 = { icons: ["30"], team: "PIT" };
flags.MINORS0 = { icons: ["4"], team: "NSH" };
const e = evaluateRoster(qt, flags);
assert(e.counts.counted === 11, `11 counted (got ${e.counts.counted})`);
assert(e.counts.ir === 1 && e.counts.minors === 29, "IR and Minors counted separately");
assert(e.illegal && e.need === 4, `illegal, need 4 (need ${e.need})`);
assert(e.issues.some((i) => i.code === "below-min" && i.illegal), "below-min issue");
assert(e.slots.D.filled === 1 && e.slots.D.empty === 2, "two empty D slots");
assert(e.slots.G.empty === 1, "one empty G slot");
assert(e.dead.length === 1 && e.dead[0]!.id === "d0" && e.dead[0]!.reason === "minor-leagues", "dead D flagged");
assert(e.slots.D.dead.includes("d0"), "dead player listed on his slot");
assert(e.healthyOnIr.length === 0, "injured IR player is not 'healthy on IR'");
assert(!e.movableFromMinors.includes("MINORS0"), "minor-leagues prospect is not movable");
assert(e.movableFromMinors.length === 28, "healthy Minors players are movable");

// 15 counted with reserves → legal.
const legal = [...entries(13, "ACTIVE", "W"), ...entries(2, "RESERVE")];
const legalSlots = legal.map((r, i) => (r.status === "ACTIVE" ? { ...r, slot: ["C", "C", "C", "W", "W", "W", "W", "W", "F", "D", "D", "D", "Skt"][i]! } : r));
const l = evaluateRoster(legalSlots, healthy(legalSlots));
assert(!l.illegal && l.need === 0, "15 counted is legal");

// Per-slot and per-status maxima.
const overW = evaluateRoster(entries(6, "ACTIVE", "W").concat(entries(9, "RESERVE")), {});
assert(overW.issues.some((i) => i.code === "slot-over" && i.slot === "W" && i.count === 6), "6 W > 5");
assert(overW.issues.some((i) => i.code === "too-many-reserve" && i.count === 9), "9 reserve > 5");
const overMinors = evaluateRoster([...entries(15, "ACTIVE", "W", "a"), ...entries(36, "MINORS")], {});
assert(overMinors.issues.some((i) => i.code === "too-many-minors"), "36 minors > 35");
const overIr = evaluateRoster([...entries(15, "RESERVE"), ...entries(7, "INJURED_RESERVE")], {});
assert(overIr.issues.some((i) => i.code === "too-many-ir"), "7 IR > 6");

// Healthy on IR: a warning at first, illegal after 2 lineup periods.
const ir = [...legalSlots, { id: "hurt", slot: "W", status: "INJURED_RESERVE" }];
const irFlags = { ...healthy(legalSlots), hurt: { icons: [], team: "BOS" } };
const fresh = evaluateRoster(ir, irFlags, { healthyIrPeriods: { hurt: 1 } });
assert(fresh.healthyOnIr.includes("hurt") && !fresh.illegal, "healthy on IR for 1 period: warning only");
const stale = evaluateRoster(ir, irFlags, { healthyIrPeriods: { hurt: 3 } });
assert(stale.illegal && stale.issues.some((i) => i.code === "healthy-ir" && i.illegal), ">2 periods → illegal");

// Any injury flag or a suspension makes an IR slot legitimate: Fantrax's own
// "Injured Reserve List" (2), day-to-day (1), out (30), suspended (6 — this
// league lets suspended players sit on IR; Hellebuyck).
for (const icon of ["1", "2", "30", "6"]) {
  const e2 = evaluateRoster(ir, { ...irFlags, hurt: { icons: [icon], team: "BOS" } }, { healthyIrPeriods: { hurt: 3 } });
  assert(!e2.healthyOnIr.includes("hurt") && !e2.illegal, `icon ${icon} on IR is not "healthy on IR"`);
}
assert(!irEligible({ icons: ["7"], team: "BOS" }) && !irEligible({ icons: ["31"], team: "BOS" }), "inactive / minors-eligible alone is not an IR reason");

// Dead in an active slot: NHL IR (Fiala) and Inactive count, day-to-day does not.
eq(deadReason({ icons: ["2", "8"], team: "LAK" }), "injured", "NHL injured reserve → injured");
eq(deadReason({ icons: ["7"], team: "BOS" }), "inactive", "inactive");
eq(deadReason({ icons: ["1"], team: "OTT" }), null, "day-to-day can still dress");
const withIrIcon = evaluateRoster(
  [{ id: "fiala", slot: "W", status: "ACTIVE" }, { id: "dean", slot: "C", status: "MINORS" }],
  { fiala: { icons: ["2"], team: "LAK" }, dean: { icons: ["2", "31"], team: "STL" } },
);
assert(withIrIcon.dead.some((d) => d.id === "fiala" && d.reason === "injured"), "NHL-IR player in an active slot is flagged");
assert(!withIrIcon.movableFromMinors.includes("dean"), "NHL-IR Minors player is not a playable fix");

// Without fxpa icons nobody can be called healthy on IR or playable in Minors.
const blind = evaluateRoster(qt, {}, { iconsKnown: false });
assert(blind.healthyOnIr.length === 0 && blind.movableFromMinors.length === 0, "unknown icons → no guesses");
assert(blind.need === 4 && blind.illegal, "legality count does not need icons");

if (failed) process.exit(1);
console.log("OK: roster legality");
