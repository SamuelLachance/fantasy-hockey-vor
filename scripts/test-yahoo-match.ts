/**
 * Unit checks for Yahoo↔NHL name collision disambiguation.
 * Run: npx tsx scripts/test-yahoo-match.ts
 */
import {
  disambiguateByPosition,
  matchYahooToNhlIds,
  normalizePlayerName,
  type YahooPlayerRecord,
} from "../src/lib/yahoo-fantasy";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const nhl = [
  {
    id: 8480012,
    name: "Elias Pettersson",
    team: "VAN",
    position: "C" as const,
    positions: ["C" as const],
  },
  {
    id: 8483678,
    name: "Elias Pettersson",
    team: "VAN",
    position: "D" as const,
    positions: ["D" as const],
  },
];

const yahoo: YahooPlayerRecord[] = [
  {
    yahooPlayerId: 7520,
    name: "Elias Pettersson",
    team: "VAN",
    displayPosition: "C",
    primaryPosition: "C",
    positions: ["C"],
  },
  {
    yahooPlayerId: 32762,
    name: "Elias Pettersson",
    team: "VAN",
    displayPosition: "D",
    primaryPosition: "D",
    positions: ["D"],
  },
];

const ids = disambiguateByPosition(
  [8480012, 8483678],
  new Map(nhl.map((p) => [p.id, p])),
  yahoo[0]!,
);
assert(ids.length === 1 && ids[0] === 8480012, "C Yahoo → C NHL");

const dataset = matchYahooToNhlIds(yahoo, nhl);
assert(dataset.matched === 2, "both Elias matched");
assert(dataset.byNhlId[8480012]?.primaryPosition === "C", "center mapped");
assert(dataset.byNhlId[8483678]?.primaryPosition === "D", "defense mapped");

assert(
  normalizePlayerName("Max Shabanov") === normalizePlayerName("Maxim Shabanov"),
  "Max/Maxim alias",
);
assert(
  normalizePlayerName("Josh Mahura") === normalizePlayerName("Joshua Mahura"),
  "Josh/Joshua alias",
);

if (failed) process.exit(1);
console.log("OK: yahoo-match");
