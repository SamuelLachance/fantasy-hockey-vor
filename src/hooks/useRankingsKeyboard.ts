"use client";

import { useEffect, useRef } from "react";
import type { PlayerProjection } from "@/lib/types";
import {
  BOARD_PAGE_JUMP,
  boardHomeEndPlayerId,
  boardKeyboardNavIds,
  isBoardImeComposing,
  isBoardRowNavTarget,
  isBoardTypingTarget,
  nextBoardEscapeAction,
  nextExpandedPlayerId,
  nextExpandedPlayerIdByStep,
  shouldIgnoreBoardShortcut,
  shouldPrefetchBoardPage,
} from "@/lib/board-keyboard";
import { boardCopyPlayerLinkId } from "@/lib/board-players";
import { BOARD_SORT_HOTKEYS } from "@/lib/board-shortcuts";
import { focusBoardSearch, focusFirstStatFilterInput, focusStatsFilterButton, focusPlayerRow, focusPlayerRowIfPanelFocused, scrollPageTop, scrollToRankings } from "@/lib/board-dom";
import { defaultSortDir, type SortKey } from "@/lib/rankings-filters";

interface RankingsKeyboardInput {
  filtered: PlayerProjection[];
  renderCount: number;
  expandedId: number | null;
  pendingPlayerId?: number | null;
  setExpandedId: (id: number | null) => void;
  filtersOpen: boolean;
  setFiltersOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  helpOpen: boolean;
  setHelpOpen: (open: boolean | ((o: boolean) => boolean)) => void;
  setSortKey: (key: SortKey) => void;
  setSortDir: (dir: "asc" | "desc") => void;
  /** Non-empty board search — Esc clears it even when search is not focused. */
  hasQuery?: boolean;
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
  pendingPlayerId = null,
  setExpandedId,
  filtersOpen,
  setFiltersOpen,
  helpOpen,
  setHelpOpen,
  setSortKey,
  setSortDir,
  hasQuery = false,
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
  const pendingPlayerIdRef = useRef(pendingPlayerId);
  const filtersOpenRef = useRef(filtersOpen);
  const helpOpenRef = useRef(helpOpen);
  const hasQueryRef = useRef(hasQuery);
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
    pendingPlayerIdRef.current = pendingPlayerId;
    filtersOpenRef.current = filtersOpen;
    helpOpenRef.current = helpOpen;
    hasQueryRef.current = hasQuery;
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
      if (isBoardImeComposing(e)) return;
      const typing = isBoardTypingTarget(e.target);
      const helpOpenNow = helpOpenRef.current;
      const filtersOpenNow = filtersOpenRef.current;
      const expandedIdNow = expandedIdRef.current;
      const ignoreBoard = shouldIgnoreBoardShortcut(helpOpenNow, e.target);

      if (e.key === "Escape") {
        const escape = nextBoardEscapeAction({
          helpOpen: helpOpenNow,
          filtersOpen: filtersOpenNow,
          hasQuery: hasQueryRef.current,
          typing,
          target: e.target,
          expandedId: expandedIdNow,
        });
        // Blink/WebKit natively clear an <input type="search"> on Escape (and
        // fire `input`, which React turns into setQuery("")). The Esc ladder
        // means these rungs to close a layer *without* touching the query, so
        // suppress the native clear whenever focus is in the search field.
        if (escape.type === "close-help" || escape.type === "close-filters") {
          if (typing) e.preventDefault();
        }
        if (escape.type === "close-help") {
          setHelpOpenRef.current(false);
          return;
        }
        if (escape.type === "close-filters") {
          setFiltersOpenRef.current(false);
          queueMicrotask(focusStatsFilterButton);
          return;
        }
        if (escape.type === "clear-search") {
          if (!onClearSearchRef.current) return;
          e.preventDefault();
          onClearSearchRef.current();
          return;
        }
        if (escape.type === "noop") return;
        if (
          escape.type === "dismiss-row" &&
          escape.blurSearch &&
          e.target instanceof HTMLElement
        ) {
          e.preventDefault();
          // Prefer the expanded row over body — blur() alone dumps focus off-board.
          if (expandedIdNow != null) {
            focusPlayerRow(expandedIdNow);
          } else {
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

      // / and f work from toolbar chrome (e.g. Stats after Esc) but not while typing/help.
      if (
        !typing &&
        !helpOpenNow &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key === "/"
      ) {
        e.preventDefault();
        focusBoardSearch();
        return;
      }
      if (
        !typing &&
        !helpOpenNow &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        (e.key === "f" || e.key === "F")
      ) {
        e.preventDefault();
        if (filtersOpenNow) {
          // Already open: jump back into the panel (Esc still closes).
          queueMicrotask(focusFirstStatFilterInput);
          return;
        }
        setFiltersOpenRef.current(true);
        queueMicrotask(focusFirstStatFilterInput);
        return;
      }

      // r / Shift+G also work from empty-state recovery chrome (aria-keyshortcuts).
      if (
        !typing &&
        !helpOpenNow &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        (e.key === "r" || e.key === "R") &&
        onResetBoardRef.current
      ) {
        e.preventDefault();
        focusPlayerRowIfPanelFocused(expandedIdNow);
        onResetBoardRef.current();
        return;
      }
      if (
        !typing &&
        !helpOpenNow &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.shiftKey &&
        (e.key === "G" || e.key === "g") &&
        onToggleDepthGoaliesRef.current
      ) {
        e.preventDefault();
        onToggleDepthGoaliesRef.current();
        return;
      }

      if (ignoreBoard || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const rowNav =
          expandedIdNow != null || isBoardRowNavTarget(e.target);
        if (rowNav) {
          // Home/End use the full filtered list, not the last-mounted window.
          // expandVisibleFloor grows the window for the target.
          const ids = filteredRef.current.map((p) => p.id);
          const nextId = boardHomeEndPlayerId(
            ids,
            e.key === "Home" ? "Home" : "End",
          );
          if (nextId != null) {
            setExpandedIdRef.current(nextId);
            const nextIdx = ids.indexOf(nextId);
            if (
              onLoadMoreRef.current &&
              shouldPrefetchBoardPage(
                nextIdx,
                renderCountRef.current,
                filteredRef.current.length,
              )
            ) {
              onLoadMoreRef.current();
            }
          }
          return;
        }
        if (e.key === "Home") {
          scrollPageTop();
          queueMicrotask(() => focusBoardSearch({ preventScroll: true }));
        } else {
          scrollToRankings({ focusSearch: true });
        }
        return;
      }
      if ((e.key === "l" || e.key === "L") && onCopyBoardLinkRef.current) {
        e.preventDefault();
        onCopyBoardLinkRef.current();
        return;
      }
      if (
        (e.key === "p" || e.key === "P") &&
        onCopyPlayerLinkRef.current
      ) {
        const copyId = boardCopyPlayerLinkId(
          expandedIdNow,
          pendingPlayerIdRef.current,
        );
        if (copyId != null) {
          e.preventDefault();
          onCopyPlayerLinkRef.current(copyId);
        }
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
        e.key !== "ArrowUp" &&
        e.key !== "PageDown" &&
        e.key !== "PageUp"
      ) {
        return;
      }
      e.preventDefault();
      const ids = boardKeyboardNavIds(
        filteredRef.current.map((p) => p.id),
        renderCountRef.current,
        expandedIdNow,
      );
      const pageJump =
        e.key === "PageDown" || e.key === "PageUp";
      const direction =
        e.key === "j" || e.key === "ArrowDown" || e.key === "PageDown"
          ? (1 as const)
          : (-1 as const);
      const nextId = pageJump
        ? nextExpandedPlayerIdByStep(
            ids,
            expandedIdNow,
            direction,
            BOARD_PAGE_JUMP,
          )
        : nextExpandedPlayerId(ids, expandedIdNow, direction);
      if (nextId != null) {
        setExpandedIdRef.current(nextId);
        const nextIdx = ids.indexOf(nextId);
        if (
          onLoadMoreRef.current &&
          shouldPrefetchBoardPage(
            nextIdx,
            renderCountRef.current,
            filteredRef.current.length,
          )
        ) {
          onLoadMoreRef.current();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
