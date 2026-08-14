/**
 * Unit checks for rankings URL parse/serialize.
 * Run: npx tsx scripts/test-rankings-url.ts
 */
import {
  decodeStatRanges,
  defaultRankingsUrlState,
  parsePlayerIdParam,
  splitStatRangeBounds,
  encodeStatRanges,
  edgeBoardHref,
  nextRankingsUrlSyncAction,
  parseLiveRankingsUrl,
  parseRankingsUrl,
  playerBoardHref,
  rankingsHashShouldFocusSearch,
  rankingsHashShouldSkipJump,
  rankingsShareUrl,
  rankingsUrlSearch,
  rankingsUrlSyncHref,
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
assert(decodeStatRanges("VOR:2-").vor?.min === "2", "decode uppercase VOR key");
assert(
  decodeStatRanges("DraftValue:1-").draftValue?.min === "1",
  "decode PascalCase draftValue key",
);
assert(
  parseRankingsUrl(new URLSearchParams("rf=Sigma:-50")).statRanges.sigma
    ?.max === "50",
  "parse rf case-insensitive Sigma",
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
assert(
  rankingsShareUrl(
    "https://samuellachance.github.io",
    "/",
    { ...defaults, position: "D" },
    "/fantasy-hockey-vor",
  ) === "https://samuellachance.github.io/fantasy-hockey-vor/?pos=D#rankings",
  "share url applies GitHub Pages basePath",
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
// Bounds are emitted as canonical numbers (not raw text), still length-capped.
const longBound = encodeStatRanges({ vor: { min: "9".repeat(40), max: "" } });
const longEncoded = /^vor:(.*)-$/.exec(longBound)?.[1] ?? "";
assert(longEncoded.length <= 24, `encode clamps bound length (got ${longEncoded})`);
assert(
  Number.isFinite(Number(longEncoded)) && Number(longEncoded) > 0,
  "clamped bound still parses as a number",
);

// Canonical emission: locale commas, leading +, and % never reach the URL raw
// (`,` is the rf separator; `+` decodes back as a space).
assert(
  encodeStatRanges({ vor: { min: "1,5", max: "" } }) === "vor:1.5-",
  "decimal comma is canonicalized before encoding",
);
assert(
  decodeStatRanges(encodeStatRanges({ vor: { min: "1,5", max: "" } })).vor?.min === "1.5",
  "comma bound round-trips",
);
assert(
  parseRankingsUrl(
    new URLSearchParams(
      rankingsUrlSearch({
        ...defaultRankingsUrlState(),
        statRanges: { vor: { min: "1,5", max: "" } },
      }),
    ),
  ).statRanges.vor?.min === "1.5",
  "comma bound survives a full URL round-trip",
);
assert(
  encodeStatRanges({ draftValue: { min: "+5", max: "" } }) === "draftValue:5-",
  "leading + is stripped by canonical encoding",
);

// Empty min + negative max must keep its sign through the round-trip.
const negMax = encodeStatRanges({ draftValue: { min: "", max: "-1" } });
assert(negMax === "draftValue:--1", `negative max-only encodes as --1 (got ${negMax})`);
assert(
  decodeStatRanges(negMax).draftValue?.max === "-1",
  "negative max-only round-trips with its sign",
);
assert(
  decodeStatRanges(negMax).draftValue?.min === "",
  "negative max-only leaves min empty",
);
assert(
  decodeStatRanges("vor:-2--5").vor?.min === "-2" &&
    decodeStatRanges("vor:-2--5").vor?.max === "-5",
  "both-negative bounds still split correctly",
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
  nextRankingsUrlSyncAction("q=a", "", "q=ab").type === "push",
  "sync push while replace still in flight",
);
assert(
  nextRankingsUrlSyncAction("q=a", "q=old", "q=ab").type === "push",
  "sync push when both diverge from lastPushed",
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
  rankingsUrlSyncHref("/", "pos=C", "", "") === "/?pos=C",
  "sync href query only",
);
assert(
  rankingsUrlSyncHref("/", "pos=C", "#rankings", "") === "/?pos=C#rankings",
  "sync href keeps hash",
);
assert(
  rankingsUrlSyncHref("/", "", "#rankings", "/fantasy-hockey-vor") ===
    "/fantasy-hockey-vor/#rankings",
  "sync href basePath + hash",
);
assert(
  rankingsUrlSyncHref("/", "pos=D", "#rankings", "/fantasy-hockey-vor") ===
    "/fantasy-hockey-vor/?pos=D#rankings",
  "sync href basePath + query + hash",
);
assert(
  parseLiveRankingsUrl({ toString: () => "pos=C" }, null).position === "C",
  "live parse falls back to searchParams",
);
assert(
  parseLiveRankingsUrl({ toString: () => "pos=C" }, "?pos=D").position === "D",
  "live parse prefers location.search",
);
assert(
  parseLiveRankingsUrl({ toString: () => "pos=C" }, "pos=G&g=all")
    .hideDepthGoalies === false,
  "live parse without leading ?",
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
  "player deep-link skips search focus without board list",
);
assert(
  !rankingsHashShouldFocusSearch(new URLSearchParams("player=8478402"), [
    { id: 8478402 },
  ]),
  "on-board player deep-link skips search focus",
);
assert(
  rankingsHashShouldFocusSearch(new URLSearchParams("player=8478402"), [
    { id: 1 },
  ]),
  "missing player falls back to search focus",
);
assert(
  rankingsHashShouldFocusSearch(new URLSearchParams("player=1"), []),
  "empty board falls back to search focus",
);
assert(
  !rankingsHashShouldFocusSearch(
    new URLSearchParams("player=3"),
    [{ id: 1 }],
    [{ id: 1 }, { id: 3 }],
  ),
  "filter-hidden but valid player skips search focus",
);
assert(
  rankingsHashShouldFocusSearch(
    new URLSearchParams("player=99"),
    [{ id: 1 }],
    [{ id: 1 }, { id: 3 }],
  ),
  "unknown player still focuses search",
);
assert(
  !rankingsHashShouldSkipJump(new URLSearchParams("")),
  "bare hash does not skip jump",
);
assert(
  rankingsHashShouldSkipJump(new URLSearchParams("player=3"), [{ id: 3 }]),
  "on-board player skips hash jump for expand scroll",
);
assert(
  !rankingsHashShouldSkipJump(new URLSearchParams("player=3"), [{ id: 1 }]),
  "filter-hidden player still jumps to the board",
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

assert(
  parseRankingsUrl(new URLSearchParams("pos=C&rf=wins:20-,vor:1-")).statRanges
    .wins === undefined,
  "URL prune drops wins on C",
);
assert(
  parseRankingsUrl(new URLSearchParams("pos=C&rf=wins:20-,vor:1-")).statRanges
    .vor?.min === "1",
  "URL prune keeps vor on C",
);

assert(
  encodeStatRanges({ goals: { min: "abc", max: "" } }) === "",
  "encode skips invalid-only",
);
assert(
  encodeStatRanges({ goals: { min: "2", max: "abc" } }) === "goals:2-",
  "encode keeps parseable side only",
);
assert(
  encodeStatRanges({ vor: { min: "10", max: "5" } }) === "",
  "encode skips inverted range",
);
assert(
  encodeStatRanges({ vor: { min: "-2", max: "5" } }) === "vor:-2-5",
  "encode negative min",
);
assert(
  decodeStatRanges("vor:-2-5").vor?.min === "-2" &&
    decodeStatRanges("vor:-2-5").vor?.max === "5",
  "decode negative min + max",
);
assert(
  decodeStatRanges("sigma:-1-").sigma?.min === "-1" &&
    decodeStatRanges("sigma:-1-").sigma?.max === "",
  "decode negative min only",
);
assert(
  decodeStatRanges("sigma:-50").sigma?.min === "" &&
    decodeStatRanges("sigma:-50").sigma?.max === "50",
  "decode empty-min max-only still works",
);
assert(
  decodeStatRanges("vor:-2--5").vor?.min === "-2" &&
    decodeStatRanges("vor:-2--5").vor?.max === "-5",
  "decode negative min and max",
);
assert(
  splitStatRangeBounds("-2-5")?.min === "-2" &&
    splitStatRangeBounds("-2-5")?.max === "5",
  "splitStatRangeBounds negative min",
);
assert(
  parseRankingsUrl(new URLSearchParams("g=ALL")).hideDepthGoalies === false,
  "g=ALL shows all goalies",
);
assert(
  parseRankingsUrl(new URLSearchParams("g=All")).hideDepthGoalies === false,
  "g=All shows all goalies",
);
assert(
  parseRankingsUrl(new URLSearchParams("sort=sigma&dir=DESC")).sortDir ===
    "desc",
  "dir=DESC case-insensitive",
);
assert(
  parseRankingsUrl(new URLSearchParams("sort=vor&dir=ASC")).sortDir === "asc",
  "dir=ASC case-insensitive",
);
assert(
  parseRankingsUrl(new URLSearchParams("sort=DraftValue")).sortKey ===
    "draftValue",
  "sort case-insensitive",
);
assert(parsePlayerIdParam("8478402") === 8478402, "player id ok");
assert(parsePlayerIdParam("0x20") === null, "reject hex");
assert(parsePlayerIdParam("1e6") === null, "reject scientific");
assert(parsePlayerIdParam("8478402.9") === null, "reject decimal");
assert(parsePlayerIdParam("+8478402") === null, "reject plus");
assert(parsePlayerIdParam(" 8478402") === null, "reject spaces");
assert(
  parseRankingsUrl(new URLSearchParams("player=0x20")).playerId === null,
  "parse rejects hex player",
);
assert(
  parseRankingsUrl(new URLSearchParams("player=8478402")).playerId === 8478402,
  "parse keeps decimal player",
);

if (failed) process.exit(1);
console.log("OK: rankings-url");
