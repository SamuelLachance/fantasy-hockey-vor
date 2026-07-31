/**
 * Unit checks for rankings URL parse/serialize.
 * Run: npx tsx scripts/test-rankings-url.ts
 */
import {
  parseRankingsUrl,
  rankingsUrlSearch,
} from "../src/lib/rankings-url";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const defaults = parseRankingsUrl(new URLSearchParams(""));
assert(defaults.position === "ALL", "default pos ALL");
assert(defaults.query === "", "default q empty");
assert(defaults.sortKey === "vor", "default sort vor");
assert(defaults.sortDir === "desc", "default dir desc");
assert(defaults.playerId === null, "default no player");
assert(defaults.hideDepthGoalies === true, "default hide depth G");
assert(rankingsUrlSearch(defaults) === "", "defaults omit from URL");

const round = parseRankingsUrl(
  new URLSearchParams(
    "pos=D&q=mcdavid&sort=draftValue&dir=asc&player=8478402&g=all",
  ),
);
assert(round.position === "D", "pos D");
assert(round.query === "mcdavid", "q");
assert(round.sortKey === "draftValue", "sort draftValue");
assert(round.sortDir === "asc", "dir asc");
assert(round.playerId === 8478402, "player id");
assert(round.hideDepthGoalies === false, "g=all shows depth");
assert(
  rankingsUrlSearch(round) ===
    "pos=D&q=mcdavid&sort=draftValue&dir=asc&player=8478402&g=all",
  "serialize round-trip",
);

assert(
  parseRankingsUrl(new URLSearchParams("pos=ZZ&sort=nope")).position === "ALL",
  "invalid pos → ALL",
);
assert(
  parseRankingsUrl(new URLSearchParams("pos=ZZ&sort=nope")).sortKey === "vor",
  "invalid sort → vor",
);
assert(
  parseRankingsUrl(new URLSearchParams("sort=sigma")).sortKey === "sigma",
  "sort sigma",
);
assert(
  parseRankingsUrl(new URLSearchParams("sort=sigma")).sortDir === "asc",
  "sigma defaults to asc dir",
);
assert(
  rankingsUrlSearch({
    ...defaults,
    sortKey: "sigma",
    sortDir: "asc",
  }) === "sort=sigma",
  "serialize sigma omits default asc dir",
);
assert(
  rankingsUrlSearch({
    ...defaults,
    sortKey: "sigma",
    sortDir: "desc",
  }) === "sort=sigma&dir=desc",
  "serialize sigma keeps non-default dir",
);

if (failed) process.exit(1);
console.log("OK: rankings-url");
