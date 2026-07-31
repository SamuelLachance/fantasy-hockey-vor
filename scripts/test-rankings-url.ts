/**
 * Unit checks for rankings URL parse/serialize.
 * Run: npx tsx scripts/test-rankings-url.ts
 */
import {
  decodeStatRanges,
  encodeStatRanges,
  edgeBoardHref,
  parseRankingsUrl,
  rankingsUrlSearch,
  sigmaBoardHref,
  steadiestBoardHref,
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
assert(Object.keys(defaults.statRanges).length === 0, "default no ranges");
assert(rankingsUrlSearch(defaults) === "", "defaults omit from URL");

const round = parseRankingsUrl(
  new URLSearchParams(
    "pos=D&q=mcdavid&sort=draftValue&dir=asc&player=8478402&g=all&rf=sigma:-50,vor:1-",
  ),
);
assert(round.position === "D", "pos D");
assert(round.query === "mcdavid", "q");
assert(round.sortKey === "draftValue", "sort draftValue");
assert(round.sortDir === "asc", "dir asc");
assert(round.playerId === 8478402, "player id");
assert(round.hideDepthGoalies === false, "g=all shows depth");
assert(round.statRanges.sigma?.max === "50", "rf sigma max");
assert(round.statRanges.vor?.min === "1", "rf vor min");
const roundTrip = parseRankingsUrl(
  new URLSearchParams(rankingsUrlSearch(round)),
);
assert(roundTrip.position === "D", "round-trip pos");
assert(roundTrip.statRanges.sigma?.max === "50", "round-trip sigma");
assert(roundTrip.statRanges.vor?.min === "1", "round-trip vor");
assert(roundTrip.hideDepthGoalies === false, "round-trip g");

assert(
  encodeStatRanges(round.statRanges) === "sigma:-50,vor:1-",
  "encode ranges",
);
assert(
  decodeStatRanges("sigma:-50,vor:1-").sigma?.max === "50",
  "decode ranges",
);
assert(
  decodeStatRanges("vor:1.5-,sigma:-80").vor?.min === "1.5",
  "decode decimal min",
);
assert(
  encodeStatRanges({
    vor: { min: "1.5", max: "" },
    sigma: { min: "", max: "80" },
  }) === "vor:1.5-,sigma:-80",
  "encode steadiest deep-link",
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

assert(edgeBoardHref() === "?sort=draftValue#rankings", "edge board href");
assert(sigmaBoardHref() === "?sort=sigma#rankings", "sigma board href");
assert(
  steadiestBoardHref() === "?sort=sigma&rf=vor:2-#rankings",
  "steadiest board href matches top-lists VOR≥2",
);

if (failed) process.exit(1);
console.log("OK: rankings-url");
