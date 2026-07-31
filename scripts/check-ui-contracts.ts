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
    "boardFilterResetToken",
    "useRankingsUrlSync",
    "useRankingsKeyboard",
    "RankingsPlayerRow",
    "RankingsTableHead",
    "BoardShortcutsHelp",
    "BoardActiveFilters",
    "RankingsStatusBar",
    "RankingsBoardFooter",
    "useHorizontalScrollShadow",
    "Drop deep-linked expand ids",
    "boardHasPlayerId",
    "countActiveStatFilters",
    "motion-reduce:backdrop-blur-none",
    'aria-label="Board filters"',
  ],
  "src/components/RankingsBoardFooter.tsx": [
    "Load more players",
    "RankingsEmptyState",
  ],
  "src/lib/board-players.ts": ["boardHasPlayerId"],
  "src/lib/board-active-filters.ts": ["countActiveStatFilters"],
  "src/components/RankingsPlayerRow.tsx": [
    "aria-expanded",
    "aria-controls",
    'role="button"',
    'role="region"',
    "aria-busy",
    "vorForFilter",
    "ExpandedPlayerPanel",
    "Enter",
  ],
  "src/lib/board-reset-token.ts": ["boardFilterResetToken", "g1"],
  "src/lib/board-keyboard.ts": ["nextExpandedPlayerId"],
  "src/components/BoardActiveFilters.tsx": [
    "Active board filters",
    "Clear filters",
    "formatRangeChip",
    "hasStatFilters",
    "All goalies",
    "showingAllGoalies",
  ],
  "src/components/RankingsTableHead.tsx": [
    'column="sigma"',
    "sticky left-10",
    "STICKY_NAME_SHADOW",
    "onResetSort",
  ],
  "src/components/RankingsEmptyState.tsx": [
    "No players match your filters",
    "Reset board view",
    'role="status"',
    "Press r to reset",
  ],
  "src/components/RankingsStatusBar.tsx": [
    "aria-live",
    "matching players",
    "Enter/Space",
    "opens first/last",
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
    'e.key === "Home"',
    'e.key === "End"',
    "nextExpandedPlayerId",
  ],
  "src/components/BoardShortcutsHelp.tsx": [
    "Board shortcuts",
    "Focus search",
    "Reset board view",
    "Copy board link",
    "Scroll to top",
    "Jump to board + focus search",
    "opens first if none",
    "Enter / Space",
  ],
  "src/lib/copy-flash.ts": ["copyTextWithFlash", "CopyFlash"],
  "src/lib/board-dom.ts": [
    "focusStatsFilterButton",
    "rankings-stat-filters",
    "STICKY_NAME_SHADOW",
    "STICKY_NAME_BASE",
    "scrollPageTop",
    "scrollToRankings",
    "scrollExpandedRowIntoView",
    "focusPlayerRow",
  ],
  "src/lib/rankings-export.ts": [
    "rankingsToJsonRows",
    "rankingsCsvString",
    "downloadRankingsCsv",
    "downloadRankingsJson",
    "vorForFilter",
  ],
  "src/components/ExpandedPlayerPanel.tsx": [
    "ExpandedPlayerMeta",
    "ExpandedPlayerCategories",
    "ExpandedPlayerNotes",
  ],
  "src/components/ExpandedPlayerNotes.tsx": [
    "Loading player notes",
    "sr-only",
    "Retry",
    "resetPlayerDetailsCache",
  ],
  "src/components/ExpandedPlayerCategories.tsx": [
    "categoryZBarWidth",
    "detailStatSigma",
    "Proj:",
  ],
  "src/lib/category-z-bar.ts": ["categoryZBarWidth", "categorySigmaDigits"],
  "src/components/ExpandedPlayerMeta.tsx": [
    "Copy player link",
    "Consensus #",
    'aria-live="polite"',
    "ML stacked ensemble",
  ],
  "src/components/RankingsToolbar.tsx": [
    "CSV",
    "JSON",
    "Link",
    "Starters",
    'aria-controls="rankings-stat-filters"',
    "onCopyBoardLink",
    'aria-keyshortcuts="l"',
    'aria-live="polite"',
    "HIGHLIGHT_QUERY_MAX",
    "PositionFilterTabs",
  ],
  "src/hooks/useBoardInfiniteScroll.ts": [
    "useBoardInfiniteScroll",
    "BOARD_PAGE_SIZE",
    "IntersectionObserver",
    "loadMore",
    "nextVisibleCount",
  ],
  "src/hooks/useHorizontalScrollShadow.ts": [
    "useHorizontalScrollShadow",
    "scrollLeft",
  ],
  "src/hooks/useRankingsUrlSync.ts": ["router.replace", "rankingsUrlSearch"],
  "src/hooks/usePlayerDetails.ts": [
    "requestIdleCallback",
    "fetchPlayerDetails",
    "expandedId == null || details != null",
  ],
  "src/components/PositionFilterTabs.tsx": [
    'role="tablist"',
    "ArrowRight",
    "Filter by position",
    "BOARD_POSITIONS",
    "nextBoardPositionIndex",
  ],
  "src/lib/board-positions.ts": ["BOARD_POSITIONS", "nextBoardPositionIndex"],
  "src/lib/rankings-url.ts": [
    "hideDepthGoalies",
    "playerId",
    "encodeStatRanges",
    "rf",
    "steadiestBoardHref",
    "playerBoardHref",
    "rf=${rf}",
    "HIGHLIGHT_QUERY_MAX",
    "RANGE_BOUND_MAX",
  ],
  "src/components/ScrollToTop.tsx": [
    "Scroll to top",
    "requestAnimationFrame",
    "scrollPageTop",
    "motion-reduce:transition-none",
    "motion-reduce:backdrop-blur-none",
    'aria-keyshortcuts="Home"',
  ],
  "src/components/TopPlayerLink.tsx": [
    "TopPlayerLink",
    "hover:bg-white/[0.07]",
    "motion-reduce:transition-none",
  ],
  "src/app/not-found.tsx": [
    "Page not found",
    "Back to rankings",
    "homeRankingsHref",
  ],
  "src/lib/seo-jsonld.ts": [
    "WebApplication",
    "Dataset",
    "isAccessibleForFree",
    "keywords",
  ],
  "src/lib/site.ts": [
    "SITE_ORIGIN",
    "SITE_URL",
    "homeRankingsHref",
    "playerDetailsHref",
  ],
  "src/lib/player-details-client.ts": [
    "fetchPlayerDetails",
    "resetPlayerDetailsCache",
    "attempt < 2",
    "playerDetailsHref",
  ],
  "src/app/layout.tsx": ["keywords", "robots", "category"],
  "src/lib/rankings-board.ts": [
    "filterAndSortBoard",
    "hideDepthGoalies",
    "coerceSortKeyForPosition",
  ],
  "src/lib/top-lists.ts": ["steadiestSkaters", "topEdgeSkaters"],
  "src/components/Header.tsx": [
    "Jump to board",
    "dateTime",
    "scrollToRankings",
    "focusSearch: true",
    "isProjectionStale",
    "HeaderStaleBanner",
    "HeaderRosterNote",
    'aria-keyshortcuts="End"',
  ],
  "src/components/HeaderRosterNote.tsx": [
    "2C · 2LW · 2RW · 4D · 2G",
    "SV%",
  ],
  "src/components/HeaderStaleBanner.tsx": [
    "npm run generate",
    "refresh urgently",
    'role="status"',
  ],
  "src/lib/clipboard.ts": ["copyText", "execCommand"],
  "src/lib/projection-age.ts": [
    "projectionAgeDays",
    "isProjectionVeryStale",
  ],
  "src/app/error.tsx": ["Try again", "Back to rankings", "homeRankingsHref"],
  "src/app/global-error.tsx": [
    "Try again",
    "Back to rankings",
    "homeRankingsHref",
  ],
  "src/app/loading.tsx": ["Loading rankings", "role=\"status\""],
  "src/app/manifest.ts": ["Fantasy Hockey VOR", "categories", "standalone"],
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
    "vorForFilter",
    "TopPlayerLink",
  ],
  "src/app/page.tsx": [
    "RankingsTable",
    "TopPlayers",
    "draftable",
    "r · l",
    "Home/End",
    "Enter",
  ],
  "src/components/RankingsStatFilters.tsx": [
    "onDone",
    "Done",
    'aria-keyshortcuts="Enter"',
  ],
};

let failed = 0;

// Catch duplicate object keys in this file (TS may also fail, but CI order varies).
{
  const self = readFileSync(
    join(root, "scripts/check-ui-contracts.ts"),
    "utf8",
  );
  const keyRe = /^\s+"([^"]+\.[^"]+)": \[/gm;
  const seen = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(self))) {
    const k = m[1]!;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const [k, n] of seen) {
    if (n > 1) {
      console.error(`FAIL: duplicate ui-contract key ${JSON.stringify(k)} (×${n})`);
      failed++;
    }
  }
}

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
