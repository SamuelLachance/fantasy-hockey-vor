/**
 * Unit checks for expanded player notes copy.
 * Run: npx tsx scripts/test-player-notes-copy.ts
 */
import {
  playerNotesEmptyCopy,
  playerNotesHasContent,
  playerNotesLoadingLabel,
  playerNotesRetryLabel,
  playerNotesUnavailableCopy,
  playerPanelLoadingLabel,
} from "../src/lib/player-notes-copy";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(playerNotesLoadingLabel() === "Loading player notes", "loading");
assert(
  playerPanelLoadingLabel() === "Loading player details",
  "panel loading",
);
assert(
  playerNotesUnavailableCopy() === "Player notes unavailable.",
  "unavailable",
);
assert(
  playerNotesEmptyCopy() === "No projection notes for this player.",
  "empty copy",
);
assert(!playerNotesHasContent(undefined), "missing record empty");
assert(!playerNotesHasContent({ reasoning: "  ", profileSummary: "" }), "whitespace empty");
assert(
  playerNotesHasContent({ reasoning: "note", profileSummary: "" }),
  "reasoning counts",
);
assert(playerNotesRetryLabel(false) === "Retry", "retry idle");
assert(playerNotesRetryLabel(true) === "Retrying…", "retry busy");

if (failed) process.exit(1);
console.log("OK: player-notes-copy");
