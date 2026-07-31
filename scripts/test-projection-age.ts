/**
 * Unit checks for projection freshness helpers.
 * Run: npx tsx scripts/test-projection-age.ts
 */
import {
  isProjectionStale,
  isProjectionVeryStale,
  projectionAgeDays,
  PROJECTION_STALE_DAYS,
  PROJECTION_VERY_STALE_DAYS,
} from "../src/lib/projection-age";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(PROJECTION_STALE_DAYS === 21, "stale threshold");
assert(PROJECTION_VERY_STALE_DAYS === 45, "very stale threshold");
assert(
  projectionAgeDays("2026-07-01T00:00:00.000Z", "2026-07-11T00:00:00.000Z") ===
    10,
  "10 day gap",
);
assert(
  projectionAgeDays("not-a-date", "2026-07-11T00:00:00.000Z") === 0,
  "invalid → 0",
);
assert(
  projectionAgeDays("2026-07-20T00:00:00.000Z", "2026-07-10T00:00:00.000Z") ===
    0,
  "negative clamped",
);
assert(!isProjectionStale(PROJECTION_STALE_DAYS), "21 not stale");
assert(isProjectionStale(PROJECTION_STALE_DAYS + 0.01), "just over 21 stale");
assert(!isProjectionVeryStale(PROJECTION_VERY_STALE_DAYS), "45 not very");
assert(
  isProjectionVeryStale(PROJECTION_VERY_STALE_DAYS + 0.01),
  "just over 45 very",
);

if (failed) process.exit(1);
console.log("OK: projection-age");
