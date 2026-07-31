/**
 * Unit checks for How VOR Works explainer copy.
 * Run: npx tsx scripts/test-how-vor-copy.ts
 */
import {
  howVorReplacementCopy,
  howVorScarcityGoaliesLabel,
  howVorScarcityHintCopy,
  howVorScarcitySkatersLabel,
  howVorScarcityTitleCopy,
  howVorYahooPositionsCopy,
  howVorZScoreCopy,
} from "../src/lib/how-vor-copy";
import { DEFAULT_LEAGUE } from "../src/lib/league";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(howVorZScoreCopy().includes("z-score"), "z-score copy");
assert(howVorZScoreCopy().includes("SV%"), "mentions SV%");
assert(
  howVorReplacementCopy(12, DEFAULT_LEAGUE.roster).includes("12-team"),
  "teams in replacement",
);
assert(
  howVorReplacementCopy(12, DEFAULT_LEAGUE.roster).includes("G rank"),
  "G rank",
);
assert(howVorYahooPositionsCopy().includes("Yahoo"), "Yahoo copy");
assert(howVorScarcityHintCopy().includes("Higher weight"), "scarcity hint");
assert(
  howVorScarcityTitleCopy() === "Category scarcity weights",
  "scarcity title",
);
assert(!howVorScarcityTitleCopy().includes("(skaters)"), "title not skaters-only");
assert(howVorScarcitySkatersLabel() === "Skaters", "skaters label");
assert(howVorScarcityGoaliesLabel() === "Goalies", "goalies label");

if (failed) process.exit(1);
console.log("OK: how-vor-copy");
