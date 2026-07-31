"use client";

import { useEffect, useRef } from "react";
import type { PlayerProjection } from "@/lib/types";
import {
  boardKeyboardNavIds,
  isBoardTypingTarget,
  nextBoardEscapeTypingAction,
  nextExpandedPlayerId,
  shouldIgnoreBoardShortcut,
} from "@/lib/board-keyboard";
import { BOARD_SORT_HOTKEYS } from "@/lib/board-shortcuts";
import { focusStatsFilterButton, focusPlayerRowIfPanelFocused, scrollPageTop, scrollToRankings } from "@/lib/board-dom";
import { defaultSortDir, type SortKey } from "@/lib/rankings-filters";

interface RankingsKeyboardInput {
  filtered: PlayerProjection[];
  renderCount: number;
  expandedId: number | null;
  setExpandedId: (id: number | null) => void;
  filtersOpen: boolean;
  setFiltersOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  helpOpen: boolean;
  setHelpOpen: (open: boolean | ((o: boolean) => boolean)) => void;
  setSortKey: (key: SortKey) => void;
  setSortDir: (dir: "asc" | "desc") => void;
  onResetBoard?: () => void;
  onCopyBoardLink?: () => void;
  onCopyPlayerLink?: (playerId: number) => void;
  onToggleDepthGoalies?: () => void;
  onLoadMore?: () => void;
  onClearSearch?: () => void;
  onCyclePosition?: (direction: 1 | -1) => void;
}

/** Global board shortcuts: Esc, /, ?, j/k, r, l, p, m, [/]. */
export function useRankingsKeyboard({
  filtered,
  renderCount,
  expandedId,
  setExpandedId,
  filtersOpen,
  setFiltersOpen,
  helpOpen,
  setHelpOpen,
  setSortKey,
  setSortDir,
  onResetBoard,
  onCopyBoardLink,
  onCopyPlayerLink,
  onToggleDepthGoalies,
  onLoadMore,
  onClearSearch,
  onCyclePosition,
}: RankingsKeyboardInput): void {
  // Keep latest handlers/state without rebinding the window listener every render.
  const filteredRef = useRef(filtered);
  const renderCountRef = useRef(renderCount);
  const expandedIdRef = useRef(expandedId);
  const filtersOpenRef = useRef(filtersOpen);
  const helpOpenRef = useRef(helpOpen);
  const setExpandedIdRef = useRef(setExpandedId);
  const setFiltersOpenRef = useRef(setFiltersOpen);
  const setHelpOpenRef = useRef(setHelpOpen);
  const setSortKeyRef = useRef(setSortKey);
  const setSortDirRef = useRef(setSortDir);
  const onResetBoardRef = useRef(onResetBoard);
  const onCopyBoardLinkRef = useRef(onCopyBoardLink);
  const onCopyPlayerLinkRef = useRef(onCopyPlayerLink);
  const onToggleDepthGoaliesRef = useRef(onToggleDepthGoalies);
  const onLoadMoreRef = useRef(onLoadMore);
  const onClearSearchRef = useRef(onClearSearch);
  const onCyclePositionRef = useRef(onCyclePosition);

  useEffect(() => {
    filteredRef.current = filtered;
    renderCountRef.current = renderCount;
    expandedIdRef.current = expandedId;
    filtersOpenRef.current = filtersOpen;
    helpOpenRef.current = helpOpen;
    setExpandedIdRef.current = setExpandedId;
    setFiltersOpenRef.current = setFiltersOpen;
    setHelpOpenRef.current = setHelpOpen;
    setSortKeyRef.current = setSortKey;
    setSortDirRef.current = setSortDir;
    onResetBoardRef.current = onResetBoard;
    onCopyBoardLinkRef.current = onCopyBoardLink;
    onCopyPlayerLinkRef.current = onCopyPlayerLink;
    onToggleDepthGoaliesRef.current = onToggleDepthGoalies;
    onLoadMoreRef.current = onLoadMore;
    onClearSearchRef.current = onClearSearch;
    onCyclePositionRef.current = onCyclePosition;
  });

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const typing = isBoardTypingTarget(e.target);
      const helpOpenNow = helpOpenRef.current;
      const filtersOpenNow = filtersOpenRef.current;
      const expandedIdNow = expandedIdRef.current;
      const ignoreBoard = shouldIgnoreBoardShortcut(helpOpenNow, e.target);

      if (e.key === "Escape") {
        if (helpOpenNow) {
          setHelpOpenRef.current(false);
          return;
        }
        if (filtersOpenNow) {
          setFiltersOpenRef.current(false);
          queueMicrotask(focusStatsFilterButton);
          return;
        }
        if (typing) {
          const action = nextBoardEscapeTypingAction(e.target);
          if (action.type === "clear-search" && onClearSearchRef.current) {
            e.preventDefault();
            onClearSearchRef.current();
            return;
          }
          if (action.type === "noop-typing") return;
          if (
            action.type === "dismiss-row" &&
            action.blurSearch &&
            e.target instanceof HTMLElement
          ) {
            e.target.blur();
          }
        }
        focusPlayerRowIfPanelFocused(expandedIdNow);
        setExpandedIdRef.current(null);
        return;
      }

      if (
        !typing &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        (e.key === "?" || (e.key === "/" && e.shiftKey))
      ) {
        e.preventDefault();
        setHelpOpenRef.current((o) => !o);
        return;
      }

      if (ignoreBoard || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "/") {
        e.preventDefault();
        document
          .querySelector<HTMLInputElement>('#rankings input[type="search"]')
          ?.focus();
        return;
      }
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setFiltersOpenRef.current((open) => {
          const next = !open;
          if (next) {
            queueMicrotask(() => {
              document
                .querySelector<HTMLInputElement>(
                  '#rankings input[aria-label$="minimum"]',
                )
                ?.focus();
            });
          }
          return next;
        });
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        scrollPageTop();
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        scrollToRankings({ focusSearch: true });
        return;
      }
      if ((e.key === "r" || e.key === "R") && onResetBoardRef.current) {
        e.preventDefault();
        focusPlayerRowIfPanelFocused(expandedIdNow);
        onResetBoardRef.current();
        return;
      }
      if ((e.key === "l" || e.key === "L") && onCopyBoardLinkRef.current) {
        e.preventDefault();
        onCopyBoardLinkRef.current();
        return;
      }
      if (
        (e.key === "p" || e.key === "P") &&
        expandedIdNow != null &&
        onCopyPlayerLinkRef.current
      ) {
        e.preventDefault();
        onCopyPlayerLinkRef.current(expandedIdNow);
        return;
      }
      if ((e.key === "m" || e.key === "M") && onLoadMoreRef.current) {
        e.preventDefault();
        onLoadMoreRef.current();
        return;
      }
      if ((e.key === "[" || e.key === "]") && onCyclePositionRef.current) {
        e.preventDefault();
        onCyclePositionRef.current(e.key === "]" ? 1 : -1);
        return;
      }
      if (
        e.shiftKey &&
        (e.key === "G" || e.key === "g") &&
        onToggleDepthGoaliesRef.current
      ) {
        e.preventDefault();
        onToggleDepthGoaliesRef.current();
        return;
      }
      if (!e.shiftKey) {
        const sortKey = BOARD_SORT_HOTKEYS[e.key.toLowerCase()];
        if (sortKey) {
          e.preventDefault();
          setSortKeyRef.current(sortKey);
          setSortDirRef.current(defaultSortDir(sortKey));
          return;
        }
      }
      if (
        e.key !== "j" &&
        e.key !== "k" &&
        e.key !== "ArrowDown" &&
        e.key !== "ArrowUp"
      ) {
        return;
      }
      e.preventDefault();
      const ids = boardKeyboardNavIds(
        filteredRef.current.map((p) => p.id),
        renderCountRef.current,
        expandedIdNow,
      );
      const direction =
        e.key === "j" || e.key === "ArrowDown" ? (1 as const) : (-1 as const);
      const nextId = nextExpandedPlayerId(ids, expandedIdNow, direction);
      if (nextId != null) setExpandedIdRef.current(nextId);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
