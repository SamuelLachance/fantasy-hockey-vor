/**
 * Lightweight UI contract checks (no browser). Fails if critical board hooks vanish.
 * Run: npx tsx scripts/check-ui-contracts.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

const root = process.cwd();
const files: Record<string, string[]> = {
  "src/components/RankingsTable.tsx": [
    'id="rankings"',
    "hideDepthGoalies",
    "usePlayerDetails",
    "resetSortToVor",
    "sticky left-10",
    "truncate",
    "Reset board view",
    "useRankingsUrlSync",
    "useRankingsKeyboard",
    "ExpandedPlayerPanel",
    'column="sigma"',
    "BoardShortcutsHelp",
  ],
  "src/hooks/useRankingsKeyboard.ts": [
    'e.key === "/"',
    "ArrowDown",
    "draftValue",
    "sigma",
  ],
  "src/lib/rankings-export.ts": ["rankingsToJsonRows", "rankingsCsvString"],
  "src/components/BoardShortcutsHelp.tsx": ["Board shortcuts", "Focus search"],
  "src/components/ExpandedPlayerPanel.tsx": [
    "Copy player link",
    "detailStatSigma",
    "Loading player notes",
    "Consensus #",
  ],
  "src/components/RankingsToolbar.tsx": ["CSV", "JSON", "Link", "Starters"],
  "src/hooks/useRankingsUrlSync.ts": ["router.replace", "rankingsUrlSearch"],
  "src/hooks/usePlayerDetails.ts": ["requestIdleCallback", "fetchPlayerDetails"],
  "src/lib/rankings-url.ts": [
    "hideDepthGoalies",
    "playerId",
    "encodeStatRanges",
    "rf",
  ],
  "src/lib/seo-jsonld.ts": ["WebApplication", "Dataset"],
  "src/lib/site.ts": ["SITE_ORIGIN", "SITE_URL"],
  "src/lib/rankings-board.ts": ["filterAndSortBoard", "hideDepthGoalies"],
  "src/app/error.tsx": ["Try again", "Back to rankings"],
  "src/app/global-error.tsx": ["Try again"],
  "src/lib/publish-players.ts": ["perStatSigma", "compactBoardNumbers"],
  "src/lib/vor.ts": ["softCapCategoryZ", "PERIPHERAL"],
  "src/lib/format.ts": ["sigmaColor", "edgeColor"],
  "src/components/TopPlayers.tsx": [
    "gamesPlayed > 8",
    "playerHref",
    "gamesPlayed}gp",
    "Steadiest",
  ],
};

let failed = 0;
for (const [rel, needles] of Object.entries(files)) {
  const text = readFileSync(join(root, rel), "utf8");
  for (const n of needles) {
    if (!text.includes(n)) {
      console.error(`FAIL: ${rel} missing ${JSON.stringify(n)}`);
      failed++;
    }
  }
}

if (failed) process.exit(1);
console.log("OK: ui-contracts");
