/**
 * Unit checks for Fantrax date parsing and Eastern-time period helpers.
 * Run: npx tsx scripts/test-fantrax-dates.ts
 */
import {
  addDays,
  claimWeekStart,
  daysBetween,
  fantraxDateToIso,
  periodContaining,
  rosterPeriodsIn,
  scoringPeriodAt,
  targetRosterPeriod,
  toIsoPeriods,
  torontoDate,
  torontoWeekday,
} from "../src/lib/fantrax/dates";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(fantraxDateToIso("2026-09-30T19:29:59.0-0400") === "2026-09-30T23:29:59.000Z", "EDT offset");
assert(fantraxDateToIso("2026-11-09T19:59:59.0-0500") === "2026-11-10T00:59:59.000Z", "EST offset");
assert(fantraxDateToIso("2026-09-25T00:00:01.585-0400") === "2026-09-25T04:00:01.585Z", "fractional seconds");
assert(fantraxDateToIso("2026-09-29T21:00:00Z") === "2026-09-29T21:00:00.000Z", "ISO passes through");

// Real period shapes (fxea getLeagueInfo).
const rosterPeriods = toIsoPeriods([
  { number: 2, startDate: "2026-09-30T19:30:00.0-0400", endDate: "2026-10-01T18:59:59.0-0400" },
  { number: 1, startDate: "2026-09-29T17:00:00.0-0400", endDate: "2026-09-30T19:29:59.0-0400" },
  { number: 3, startDate: "2026-10-01T19:00:00.0-0400", endDate: "2026-10-02T18:29:59.0-0400" },
]);
assert(rosterPeriods.map((p) => p.number).join(",") === "1,2,3", "periods sorted");
const scoring = toIsoPeriods([
  { number: 1, startDate: "2026-09-29T17:00:00.0-0400", endDate: "2026-10-12T12:59:59.0-0400" },
  { number: 2, startDate: "2026-10-12T13:00:00.0-0400", endDate: "2026-10-19T18:59:59.0-0400" },
]);
assert(scoring[0]!.end === "2026-10-12T16:59:59.000Z", "scoring period 1 ends 2026-10-12 12:59:59 EDT");

// Target = first lineup period whose start (first puck drop) is still ahead.
const at = (iso: string) => Date.parse(iso);
assert(targetRosterPeriod(rosterPeriods, at("2026-09-25T14:00:00Z"))?.number === 1, "before opener → rp1");
assert(targetRosterPeriod(rosterPeriods, at("2026-09-29T20:59:59Z"))?.number === 1, "1 s before lock → rp1");
assert(targetRosterPeriod(rosterPeriods, at("2026-09-29T21:00:00Z"))?.number === 2, "at lock → next period");
assert(targetRosterPeriod(rosterPeriods, at("2026-10-05T00:00:00Z")) === null, "past the last period → null");
assert(periodContaining(rosterPeriods, at("2026-09-30T12:00:00Z"))?.number === 1, "containing period");
assert(scoringPeriodAt(scoring, at("2026-09-25T14:00:00Z"))?.number === 1, "preseason → scoring period 1");
assert(scoringPeriodAt(scoring, at("2026-10-12T17:00:00Z"))?.number === 2, "13:00 EDT Oct 12 → period 2");
assert(rosterPeriodsIn(rosterPeriods, scoring[0]!).length === 3, "lineup periods inside scoring period 1");

// Eastern calendar dates across the 2026-11-01 DST change.
assert(torontoDate(at("2026-09-30T02:30:00Z")) === "2026-09-29", "late West-coast game is still Sep 29 ET");
assert(torontoDate(at("2026-11-01T03:59:00Z")) === "2026-10-31", "23:59 EDT Oct 31");
assert(torontoDate(at("2026-11-01T04:00:00Z")) === "2026-11-01", "00:00 EDT Nov 1");
assert(torontoDate(at("2026-11-02T04:30:00Z")) === "2026-11-01", "23:30 EST Nov 1 (after DST ends)");
assert(torontoDate(at("2026-11-02T05:00:00Z")) === "2026-11-02", "00:00 EST Nov 2");

// Claims reset Monday (Eastern).
assert(torontoWeekday(at("2026-09-25T14:00:00Z")) === 5, "Sep 25 2026 is a Friday");
assert(claimWeekStart(at("2026-09-25T14:00:00Z")) === "2026-09-21", "Friday → Monday Sep 21");
assert(claimWeekStart(at("2026-09-28T04:30:00Z")) === "2026-09-28", "00:30 EDT Monday resets");
assert(claimWeekStart(at("2026-09-28T03:30:00Z")) === "2026-09-21", "23:30 EDT Sunday still old week");
assert(claimWeekStart(at("2026-11-02T04:30:00Z")) === "2026-10-26", "Sunday night across DST");

assert(addDays("2026-12-31", 1) === "2027-01-01" && addDays("2026-03-01", -1) === "2026-02-28", "addDays");
assert(daysBetween("2026-09-29", "2026-10-12") === 13, "daysBetween");

if (failed) process.exit(1);
console.log("OK: fantrax dates");
