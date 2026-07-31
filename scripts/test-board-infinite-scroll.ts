/**
 * Unit check: board infinite-scroll page size constant.
 * Run: npx tsx scripts/test-board-infinite-scroll.ts
 */
import { BOARD_PAGE_SIZE } from "../src/hooks/useBoardInfiniteScroll";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(BOARD_PAGE_SIZE === 100, "page size 100");
assert(BOARD_PAGE_SIZE >= 60, "page size not tiny");

if (failed) process.exit(1);
console.log("OK: board-infinite-scroll");
