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
    "useRankingsUrlSync",
    "useRankingsKeyboard",
    "ExpandedPlayerPanel",
    'column="sigma"',
    "BoardShortcutsHelp",
    "BoardActiveFilters",
    "RankingsEmptyState",
    "RankingsStatusBar",
  ],
  "src/components/BoardActiveFilters.tsx": [
    "Active board filters",
    "Clear filters",
    "formatRangeChip",
  ],
  "src/components/RankingsEmptyState.tsx": [
    "No players match your filters",
    "Reset board view",
  ],
  "src/components/RankingsStatusBar.tsx": [
    "aria-live",
    "matching players",
  ],
  "src/hooks/useRankingsKeyboard.ts": [
    'e.key === "/"',
    "ArrowDown",
    "draftValue",
    "sigma",
    "onResetBoard",
    "filteredRef",
    "focusStatsFilterButton",
    "onCopyBoardLink",
  ],
  "src/lib/copy-flash.ts": ["copyTextWithFlash", "CopyFlash"],
  "src/lib/board-dom.ts": ["focusStatsFilterButton", "rankings-stat-filters"],
  "src/lib/rankings-export.ts": ["rankingsToJsonRows", "rankingsCsvString"],
  "src/components/BoardShortcutsHelp.tsx": [
    "Board shortcuts",
    "Focus search",
    "Reset board view",
    "Copy board link",
  ],
  "src/components/ExpandedPlayerPanel.tsx": [
    "Copy player link",
    "detailStatSigma",
    "Loading player notes",
    "Consensus #",
  ],
  "src/components/RankingsToolbar.tsx": [
    "CSV",
    "JSON",
    "Link",
    "Starters",
    'aria-controls="rankings-stat-filters"',
    "onCopyBoardLink",
    'aria-keyshortcuts="l"',
  ],
  "src/hooks/useRankingsUrlSync.ts": ["router.replace", "rankingsUrlSearch"],
  "src/hooks/usePlayerDetails.ts": ["requestIdleCallback", "fetchPlayerDetails"],
  "src/lib/rankings-url.ts": [
    "hideDepthGoalies",
    "playerId",
    "encodeStatRanges",
    "rf",
    "steadiestBoardHref",
    "playerBoardHref",
    "rf=${rf}",
  ],
  "src/lib/seo-jsonld.ts": ["WebApplication", "Dataset"],
  "src/lib/site.ts": ["SITE_ORIGIN", "SITE_URL"],
  "src/lib/rankings-board.ts": ["filterAndSortBoard", "hideDepthGoalies"],
  "src/lib/top-lists.ts": ["steadiestSkaters", "topEdgeSkaters"],
  "src/components/Header.tsx": ["Jump to board", "dateTime"],
  "src/app/error.tsx": ["Try again", "Back to rankings"],
  "src/app/global-error.tsx": ["Try again"],
  "src/lib/publish-players.ts": ["perStatSigma", "compactBoardNumbers"],
  "src/lib/vor.ts": ["softCapCategoryZ", "PERIPHERAL"],
  "src/lib/format.ts": ["sigmaColor", "edgeColor"],
  "src/components/TopPlayers.tsx": [
    "gamesPlayed > 8",
    "playerBoardHref",
    "gamesPlayed}gp",
    "Steadiest",
    "steadiestBoardHref",
    "edgeBoardHref",
  ],
  "src/components/RankingsStatFilters.tsx": ["onDone", "Done"],
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
