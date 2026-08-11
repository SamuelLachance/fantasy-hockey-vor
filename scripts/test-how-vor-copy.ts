/**
 * Unit checks for How VOR Works explainer copy.
 * Run: npx tsx scripts/test-how-vor-copy.ts
 */
import {
  howVorReplacementCopy,
  howVorReplacementTitleCopy,
  howVorScarcityGoaliesLabel,
  howVorScarcityHintCopy,
  howVorScarcitySkatersLabel,
  howVorScarcityTitleCopy,
  howVorSectionTitleCopy,
  howVorYahooPositionsCopy,
  howVorYahooPositionsTitleCopy,
  howVorZScoreCopy,
  howVorZScoreTitleCopy,
} from "../src/lib/how-vor-copy";
import { DEFAULT_LEAGUE } from "../src/lib/league";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(howVorSectionTitleCopy() === "How VOR Works", "section title");
assert(howVorZScoreTitleCopy() === "Category Z-Scores", "z-score title");
assert(
  howVorReplacementTitleCopy() === "Replacement Level",
  "replacement title",
);
assert(
  howVorYahooPositionsTitleCopy() === "Yahoo Positions",
  "yahoo title",
);
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
assert(howVorScarcityHintCopy().includes("matchup point"), "scarcity hint");
assert(
  howVorScarcityTitleCopy() === "Category scarcity weights",
  "scarcity title",
);
assert(!howVorScarcityTitleCopy().includes("(skaters)"), "title not skaters-only");
assert(howVorScarcitySkatersLabel() === "Skaters", "skaters label");
assert(howVorScarcityGoaliesLabel() === "Goalies", "goalies label");

if (failed) process.exit(1);
console.log("OK: how-vor-copy");
