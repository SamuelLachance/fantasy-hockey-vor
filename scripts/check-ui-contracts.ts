/**
 * Lightweight UI contract checks (no browser). Fails if critical board hooks vanish.
 * Run: npx tsx scripts/check-ui-contracts.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

const root = process.cwd();
const files: Record<string, string[]> = {
  "src/components/RankingsTable.tsx": [
    "RankingsTableInner",
    "Suspense",
    "Loading rankings",
  ],
  "src/components/RankingsTableInner.tsx": [
    'id="rankings"',
    'id="rankings-board-table"',
    "usePlayerDetails",
    "useRankingsBoardState",
    "useRankingsUrlSync",
    "useRankingsKeyboard",
    "useBoardCopyLinks",
    "useRankingsHashJump",
    "RankingsPlayerRow",
    "RankingsTableHead",
    "BoardShortcutsHelp",
    "RankingsBoardChrome",
    "RankingsStatusBar",
    "RankingsBoardFooter",
    "useHorizontalScrollShadow",
    "useBoardDocumentTitle",
    "overscroll-x-contain",
    "onCyclePosition",
  ],
  "src/hooks/useBoardCopyLinks.ts": [
    "useBoardCopyLinks",
    "copyTextWithFlash",
    "rankingsShareUrl",
    "copyBoardLink",
    "copyPlayerLink",
  ],
  "src/hooks/useRankingsHashJump.ts": [
    "useRankingsHashJump",
    "hashchange",
    "scrollToRankings",
    "focusSearch",
  ],
  "src/hooks/useTimedFlash.ts": [
    "useTimedFlash",
    "clearTimeout",
    "holdMs",
  ],
  "src/hooks/useBoardDocumentTitle.ts": [
    "useBoardDocumentTitle",
    "boardDocumentTitle",
    "document.title",
  ],
  "src/lib/board-document-title.ts": [
    "boardDocumentTitle",
    "Fantasy Hockey VOR",
  ],
  "src/hooks/useRankingsBoardState.ts": [
    "useRankingsBoardState",
    "boardFilterResetToken",
    "boardHasPlayerId",
    "countActiveStatFilters",
    "resetSortToVor",
    "toggleDepthGoalies",
    "Drop deep-linked expand ids",
    'position !== "G"',
  ],
  "src/components/RankingsBoardChrome.tsx": [
    'aria-label="Board filters"',
    "motion-reduce:backdrop-blur-none",
    "motion-reduce:bg-slate-950",
    "BoardActiveFilters",
    "RankingsToolbar",
  ],
  "src/components/RankingsBoardFooter.tsx": [
    "Load more",
    "remaining",
    "remainingBoardRows",
    "RankingsEmptyState",
    'aria-keyshortcuts="m"',
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
    "tabular-nums",
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
    'scope="col"',
    "motion-reduce:bg-slate-950",
  ],
  "src/components/RankingsEmptyState.tsx": [
    "No players match your filters",
    "Reset board view",
    'role="status"',
    "Press r to reset",
    "Include depth goalies",
    "keyshortcuts",
    "EmptyAction",
    "emptyBoardRecoveryFlags",
  ],
  "src/lib/board-empty-recovery.ts": [
    "emptyBoardRecoveryFlags",
    "canShowAllGoalies",
  ],
  "src/components/RankingsStatusBar.tsx": [
    "aria-live",
    "boardShowingSummary",
    "Enter/Space",
    "boardShortcutsStatusCopy",
    "tabular-nums",
  ],
  "src/lib/board-status.ts": ["boardShowingSummary", "formatCount"],
  "src/hooks/useRankingsKeyboard.ts": [
    'e.key === "/"',
    "ArrowDown",
    "BOARD_SORT_HOTKEYS",
    "onResetBoard",
    "filteredRef",
    "focusStatsFilterButton",
    "onCopyBoardLink",
    'e.key === "Home"',
    'e.key === "End"',
    "nextExpandedPlayerId",
    "onToggleDepthGoalies",
    "onLoadMore",
    "onClearSearch",
    "onCyclePosition",
    'e.key === "G"',
    'e.key === "m"',
    'e.key === "["',
  ],
  "src/components/BoardShortcutsHelp.tsx": [
    "Board shortcuts",
    "BOARD_SHORTCUT_ROWS",
    "board-shortcuts-dialog",
    "previouslyFocused",
  ],
  "src/lib/board-shortcuts.ts": [
    "BOARD_SHORTCUT_ROWS",
    "BOARD_SORT_HOTKEYS",
    "boardShortcutsStatusCopy",
    "boardShortcutsFooterChip",
    "Shift+G",
    "Load more rows",
    "Previous / next position tab",
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
    "prefersReducedMotion",
  ],
  "src/lib/rankings-export.ts": [
    "rankingsToJsonRows",
    "rankingsJsonExport",
    "rankingsCsvString",
    "downloadRankingsCsv",
    "downloadRankingsJson",
    "vorForFilter",
    "vorScope",
  ],
  "src/lib/rankings-csv.ts": [
    "rankingsToCsv",
    "fantasy-hockey-vor",
    "vorScope",
    "csvEscape",
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
    "Retrying",
    "resetPlayerDetailsCache",
    'role="alert"',
    'aria-busy="true"',
  ],
  "src/components/ExpandedPlayerCategories.tsx": [
    "categoryZBarWidth",
    "detailStatSigma",
    "Proj:",
    'role="meter"',
    "aria-valuetext",
    "tabular-nums",
  ],
  "src/lib/category-z-bar.ts": [
    "categoryZBarWidth",
    "categorySigmaDigits",
    "categoryZMeterValue",
  ],
  "src/components/ExpandedPlayerMeta.tsx": [
    "Copy player link",
    "Copy link for",
    "Consensus #",
    'aria-live="polite"',
    "projectionMethodLabel",
  ],
  "src/lib/projection-method.ts": [
    "projectionMethodLabel",
    "projectionMethodTone",
  ],
  "src/components/RankingsToolbar.tsx": [
    "RankingsExportButtons",
    "Link",
    "Starters",
    'aria-controls="rankings-stat-filters"',
    "onCopyBoardLink",
    'aria-keyshortcuts="l"',
    'aria-live="polite"',
    "HIGHLIGHT_QUERY_MAX",
    "rankings-search-limit",
    "autoComplete",
    "PositionFilterTabs",
    'aria-keyshortcuts="Shift+G"',
  ],
  "src/components/RankingsExportButtons.tsx": [
    "CSV",
    "JSON",
    "Saved",
    "useTimedFlash",
    "downloadRankingsCsv",
    "downloadRankingsJson",
    "Export filtered rankings",
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
    "horizontalScrollShadowVisible",
    "scrollLeft",
  ],
  "src/lib/horizontal-scroll-shadow.ts": [
    "HORIZONTAL_SCROLL_SHADOW_PX",
    "horizontalScrollShadowVisible",
  ],
  "src/hooks/useRankingsUrlSync.ts": ["router.replace", "rankingsUrlSearch"],
  "src/hooks/usePlayerDetails.ts": [
    "scheduleIdle",
    "fetchPlayerDetails",
    "expandedId == null || details != null",
  ],
  "src/lib/schedule-idle.ts": [
    "scheduleIdle",
    "requestIdleCallback",
    "cancelIdleCallback",
  ],
  "src/components/PositionFilterTabs.tsx": [
    'role="tablist"',
    "ArrowRight",
    "Filter by position",
    "BOARD_POSITIONS",
    "nextBoardPositionIndex",
    "aria-controls",
    "rankings-board-table",
    'aria-keyshortcuts="[ ]"',
  ],
  "src/lib/board-positions.ts": [
    "BOARD_POSITIONS",
    "nextBoardPositionIndex",
    "cycleBoardPosition",
  ],
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
    "scrollToTopVisible",
    "motion-reduce:transition-none",
    "motion-reduce:backdrop-blur-none",
    'aria-keyshortcuts="Home"',
  ],
  "src/lib/scroll-to-top.ts": [
    "scrollToTopVisible",
    "SCROLL_TOP_SHOW_AFTER",
    "SCROLL_TOP_HIDE_BELOW",
  ],
  "src/components/TopPlayerLink.tsx": [
    "TopPlayerLink",
    "dense",
    "hover:bg-white/[0.07]",
    "motion-reduce:transition-none",
  ],
  "src/app/not-found.tsx": [
    "Page not found",
    "Back to rankings",
    "homeRankingsHref",
    "BrandEyebrow",
  ],
  "src/lib/seo-jsonld.ts": [
    "WebApplication",
    "Dataset",
    "FAQPage",
    "BreadcrumbList",
    "HowTo",
    "isAccessibleForFree",
    "keywords",
    "National Hockey League",
    "sameAs",
  ],
  "src/lib/site.ts": [
    "SITE_ORIGIN",
    "SITE_URL",
    "homeRankingsHref",
    "playerDetailsHref",
    "NEXT_PUBLIC_BUILD_TIME",
  ],
  "src/lib/player-details-client.ts": [
    "fetchPlayerDetails",
    "resetPlayerDetailsCache",
    "attempt < 2",
    "playerDetailsHref",
    "normalizePlayerDetailsPayload",
  ],
  "src/app/layout.tsx": ["keywords", "robots", "category"],
  "src/lib/rankings-board.ts": [
    "filterAndSortBoard",
    "hideDepthGoalies",
    "coerceSortKeyForPosition",
    "isStarterEligibleGoalie",
  ],
  "src/lib/goalie-depth.ts": [
    "GOALIE_DEPTH_MAX_GP",
    "isStarterEligibleGoalie",
    "topByPositionLeaders",
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
    'role="note"',
  ],
  "src/components/HeaderStaleBanner.tsx": [
    "npm run generate",
    "refresh urgently",
    "aria-live",
    "veryStale",
  ],
  "src/components/SortIcon.tsx": [
    "ArrowUpDown",
    'aria-hidden="true"',
  ],
  "src/lib/board-remaining.ts": ["remainingBoardRows"],
  "src/lib/clipboard.ts": ["copyText", "execCommand"],
  "src/lib/projection-age.ts": [
    "projectionAgeDays",
    "isProjectionVeryStale",
  ],
  "src/components/BrandEyebrow.tsx": [
    "Fantasy Hockey VOR",
    "tracking-[0.2em]",
  ],
  "src/app/error.tsx": [
    "Try again",
    "Back to rankings",
    "homeRankingsHref",
    "error.digest",
    "BrandEyebrow",
  ],
  "src/app/global-error.tsx": [
    "Try again",
    "Back to rankings",
    "homeRankingsHref",
    "BrandEyebrow",
    "focus-visible:ring-2",
  ],
  "src/app/loading.tsx": [
    "Loading rankings",
    'role="status"',
    "BrandEyebrow",
  ],
  "src/app/manifest.ts": ["Fantasy Hockey VOR", "categories", "standalone"],
  "src/lib/publish-players.ts": ["perStatSigma", "compactBoardNumbers"],
  "src/lib/vor.ts": ["softCapCategoryZ", "PERIPHERAL"],
  "src/lib/format.ts": ["sigmaColor", "edgeColor", "formatSigned"],
  "src/components/TopPlayers.tsx": [
    "TopLeadersCard",
    "HowVorWorks",
    "topByPositionLeaders",
    "playerBoardHref",
    "gamesPlayed}gp",
    "Steadiest",
    "steadiestBoardHref",
    "edgeBoardHref",
    "vorForFilter",
    "TopPlayerLink",
    "dense",
    "tabular-nums",
    "Top fantasy hockey leaders",
  ],
  "src/components/HowVorWorks.tsx": [
    "How VOR Works",
    "replacementRank",
    "CATEGORY_FULL_LABELS",
    "Category scarcity weights",
  ],
  "src/components/TopLeadersCard.tsx": [
    "TopLeadersCard",
    "accentClass",
    "headerExtra",
  ],
  "src/app/page.tsx": [
    "RankingsTable",
    "TopPlayers",
    "draftable",
    "boardShortcutsFooterChip",
    "formatCount",
    "formatProjectionEngine",
  ],
  "src/components/RankingsStatFilters.tsx": [
    "onDone",
    "Done",
    'aria-keyshortcuts="Enter"',
    "normalizeRangeInput",
    'type="text"',
    "inputMode",
    "tabular-nums",
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
