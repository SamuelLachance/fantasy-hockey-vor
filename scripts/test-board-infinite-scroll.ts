/**
 * Unit check: board infinite-scroll page size constant.
 * Run: npx tsx scripts/test-board-infinite-scroll.ts
 */
import {
  BOARD_PAGE_SIZE,
  applyLoadMoreVisibleCount,
  expandVisibleFloor,
  nextVisibleCount,
  resolveVisibleCount,
} from "../src/hooks/useBoardInfiniteScroll";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(BOARD_PAGE_SIZE === 100, "page size 100");
assert(BOARD_PAGE_SIZE >= 60, "page size not tiny");
assert(nextVisibleCount(100, 100, 250) === 200, "grows by page");
assert(nextVisibleCount(200, 100, 250) === 250, "clamps to total");
assert(nextVisibleCount(250, 100, 250) === 250, "at end stays");

const list = Array.from({ length: 250 }, (_, i) => ({ id: i + 1 }));
assert(expandVisibleFloor(list, null, 100) === 0, "no expand floor");
assert(expandVisibleFloor(list, 50, 100) === 150, "mid expand floor");
assert(expandVisibleFloor(list, 999, 100) === 0, "missing id");
assert(expandVisibleFloor(list, 240, 100) === 250, "near end clamps");

assert(
  resolveVisibleCount({
    visibleCount: 400,
    pageSize: 100,
    reset: true,
    expandFloor: 0,
  }) === 100,
  "reset snaps to page size same render",
);
assert(
  resolveVisibleCount({
    visibleCount: 400,
    pageSize: 100,
    reset: true,
    expandFloor: 150,
  }) === 150,
  "reset still respects expand floor",
);
assert(
  resolveVisibleCount({
    visibleCount: 200,
    pageSize: 100,
    reset: false,
    expandFloor: 0,
  }) === 200,
  "no reset keeps window",
);

assert(
  applyLoadMoreVisibleCount(100, 100, 250, 1, 1) === 200,
  "load-more applies when gen matches",
);
assert(
  applyLoadMoreVisibleCount(100, 100, 250, 1, 2) === 100,
  "stale load-more ignored after reset gen",
);

if (failed) process.exit(1);
console.log("OK: board-infinite-scroll");
