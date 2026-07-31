/**
 * Unit checks for rankings URL parse/serialize.
 * Run: npx tsx scripts/test-rankings-url.ts
 */
import {
  decodeStatRanges,
  encodeStatRanges,
  edgeBoardHref,
  nextRankingsUrlSyncAction,
  parseRankingsUrl,
  playerBoardHref,
  rankingsHashShouldFocusSearch,
  rankingsShareUrl,
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
assert(
  parseRankingsUrl(
    new URLSearchParams(steadiestBoardHref().replace(/^\?/, "").replace(/#.*$/, "")),
  ).statRanges.vor?.min === "2",
  "steadiest href parses VOR min 2",
);
assert(playerBoardHref(8478402) === "?player=8478402#rankings", "player board href");
assert(
  rankingsShareUrl("https://example.com", "/fantasy-hockey-vor/", {
    ...defaults,
    playerId: 8478402,
  }) === "https://example.com/fantasy-hockey-vor/?player=8478402#rankings",
  "share url with player",
);

const longQ = "x".repeat(80);
assert(
  parseRankingsUrl(new URLSearchParams(`q=${longQ}`)).query.length === 48,
  "q clamped to highlight max",
);
assert(
  decodeStatRanges(`vor:${"9".repeat(40)}-`).vor?.min?.length === 24,
  "rf bound clamped",
);
assert(
  encodeStatRanges({
    vor: { min: "9".repeat(40), max: "" },
  }) === `vor:${"9".repeat(24)}-`,
  "encode clamps bound length",
);

assert(
  nextRankingsUrlSyncAction(null, "", "").type === "noop",
  "sync noop when matched",
);
assert(
  nextRankingsUrlSyncAction("", "pos=C", "pos=C").type === "noop",
  "sync noop matched after push",
);
assert(
  nextRankingsUrlSyncAction("pos=C", "pos=D", "pos=C").type === "hydrate",
  "sync hydrate on back/forward",
);
assert(
  nextRankingsUrlSyncAction("pos=C", "pos=C", "pos=D").type === "push",
  "sync push on local change",
);
assert(
  nextRankingsUrlSyncAction(null, "pos=C", "").type === "hydrate",
  "sync hydrate when first URL differs",
);

assert(
  parseRankingsUrl(new URLSearchParams("pos=D&sort=faceoffWins")).sortKey ===
    "vor",
  "D + FOW sort coerces to vor",
);
assert(
  parseRankingsUrl(new URLSearchParams("pos=C&sort=faceoffWins")).sortKey ===
    "faceoffWins",
  "C keeps FOW sort",
);
assert(
  parseRankingsUrl(new URLSearchParams("pos=G&sort=goals")).sortKey === "vor",
  "G + goals sort coerces to vor",
);
assert(
  parseRankingsUrl(new URLSearchParams("pos=G&sort=wins")).sortKey === "wins",
  "G keeps wins sort",
);

assert(
  rankingsHashShouldFocusSearch(new URLSearchParams("")),
  "bare hash focuses search",
);
assert(
  rankingsHashShouldFocusSearch(new URLSearchParams("pos=C&q=mcd")),
  "filter-only focuses search",
);
assert(
  !rankingsHashShouldFocusSearch(new URLSearchParams("player=8478402")),
  "player deep-link skips search focus",
);

const viewWithPlayer = {
  position: "C" as const,
  query: "",
  sortKey: "vor" as const,
  sortDir: "desc" as const,
  playerId: 8478402,
  hideDepthGoalies: true,
  statRanges: {},
};
const boardShare = rankingsShareUrl(
  "https://example.com",
  "/",
  { ...viewWithPlayer, playerId: null },
);
const playerShare = rankingsShareUrl("https://example.com", "/", viewWithPlayer);
assert(boardShare.includes("pos=C"), "board share keeps filters");
assert(!boardShare.includes("player="), "board share omits player");
assert(playerShare.includes("player=8478402"), "player share keeps player");

if (failed) process.exit(1);
console.log("OK: rankings-url");
