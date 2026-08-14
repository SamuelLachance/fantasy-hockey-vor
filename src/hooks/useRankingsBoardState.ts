"use client";

import {
  startTransition,
  useDeferredValue,
  useMemo,
  useState,
} from "react";
import type { PlayerProjection, Position } from "@/lib/types";
import {
  defaultSortDir,
  type RangeKey,
  type SortKey,
  type StatRanges,
} from "@/lib/rankings-filters";
import {
  boardCategories,
  boardFilterKeys,
  coerceSortKeyForPosition,
  filterAndSortBoard,
  pruneStatRangesForPosition,
} from "@/lib/rankings-board";
import { countActiveStatFilters } from "@/lib/board-active-filters";
import { nextDeferredExpandState } from "@/lib/board-players";
import { boardFilterResetToken } from "@/lib/board-reset-token";
import { canToggleDepthGoalies } from "@/lib/goalie-depth-toggle";
import type { RankingsUrlState } from "@/lib/rankings-url";

export interface RankingsBoardSeed {
  query: string;
  position: Position | "ALL";
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  statRanges: StatRanges;
  hideDepthGoalies: boolean;
  playerId: number | null;
}

/** Owns board filter/sort/expand state and derived filtered rows. */
export function useRankingsBoardState(
  players: PlayerProjection[],
  seed: RankingsBoardSeed,
) {
  const [query, setQuery] = useState(seed.query);
  const deferredQuery = useDeferredValue(query);
  const [position, setPosition] = useState<Position | "ALL">(seed.position);
  const [sortKey, setSortKey] = useState<SortKey>(seed.sortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(seed.sortDir);
  const [statRanges, setStatRanges] = useState<StatRanges>(seed.statRanges);
  const [filtersOpen, setFiltersOpen] = useState(
    () =>
      Object.values(seed.statRanges).some(
        (b) => b?.min?.trim() || b?.max?.trim(),
      ),
  );
  const [hideDepthGoalies, setHideDepthGoalies] = useState(
    seed.hideDepthGoalies,
  );
  const [expandedId, setExpandedId] = useState<number | null>(seed.playerId);
  const [pendingPlayerId, setPendingPlayerId] = useState<number | null>(
    seed.playerId,
  );
  const [helpOpen, setHelpOpen] = useState(false);

  const filterRangeKeys = useMemo(
    () => boardFilterKeys(position),
    [position],
  );

  const activeFilterCount = useMemo(
    () => countActiveStatFilters(statRanges, filterRangeKeys),
    [statRanges, filterRangeKeys],
  );

  const filterKey = boardFilterResetToken(
    position,
    deferredQuery,
    statRanges,
    hideDepthGoalies,
    sortKey,
    sortDir,
  );

  const [prevPosition, setPrevPosition] = useState(position);
  if (position !== prevPosition) {
    setPrevPosition(position);
    const nextKey = coerceSortKeyForPosition(sortKey, position);
    if (nextKey !== sortKey) {
      setSortKey(nextKey);
      setSortDir("desc");
    }
    const nextRanges = pruneStatRangesForPosition(statRanges, position);
    if (nextRanges !== statRanges) {
      setStatRanges(nextRanges);
    }
  }

  const filtered = useMemo(
    () =>
      filterAndSortBoard(players, {
        position,
        query: deferredQuery,
        sortKey,
        sortDir,
        statRanges,
        hideDepthGoalies,
      }),
    [
      players,
      deferredQuery,
      position,
      sortKey,
      sortDir,
      statRanges,
      hideDepthGoalies,
    ],
  );

  // Park filter-hidden expands as pending; restore when the player reappears.
  const deferredExpand = nextDeferredExpandState({
    allPlayers: players,
    filtered,
    expandedId,
    pendingPlayerId,
  });
  if (deferredExpand.expandedId !== expandedId) {
    setExpandedId(deferredExpand.expandedId);
  }
  if (deferredExpand.pendingPlayerId !== pendingPlayerId) {
    setPendingPlayerId(deferredExpand.pendingPlayerId);
  }

  function setExpandedIdFromUser(
    next: number | null | ((cur: number | null) => number | null),
  ) {
    const value = typeof next === "function" ? next(expandedId) : next;
    setExpandedId(value);
    setPendingPlayerId(value);
  }

  function clearStatFilters() {
    startTransition(() => setStatRanges({}));
  }

  function removeStatFilter(key: RangeKey) {
    startTransition(() => {
      setStatRanges((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    });
  }

  function resetBoardView() {
    setQuery("");
    clearStatFilters();
    setFiltersOpen(false);
    setExpandedId(null);
    setPendingPlayerId(null);
    startTransition(() => {
      setPosition("ALL");
      setHideDepthGoalies(true);
      setSortKey("vor");
      setSortDir("desc");
    });
  }

  function boardShareState(playerId: number | null): RankingsUrlState {
    return {
      position,
      query,
      sortKey,
      sortDir,
      playerId,
      hideDepthGoalies,
      statRanges,
    };
  }

  function toggleSort(key: SortKey) {
    startTransition(() => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir(defaultSortDir(key));
      }
    });
  }

  function resetSortToVor() {
    startTransition(() => {
      setSortKey("vor");
      setSortDir("desc");
    });
  }

  function updateRange(key: RangeKey, field: "min" | "max", value: string) {
    startTransition(() => {
      setStatRanges((prev) => {
        const bound = { min: "", max: "", ...prev[key], [field]: value };
        const next = { ...prev };
        if (!bound.min.trim() && !bound.max.trim()) {
          delete next[key];
        } else {
          next[key] = bound;
        }
        return next;
      });
    });
  }

  function toggleDepthGoalies() {
    if (!canToggleDepthGoalies(position)) return;
    startTransition(() => setHideDepthGoalies((v) => !v));
  }

  function hydrateFromUrl(next: RankingsUrlState) {
    setHelpOpen(false);
    setQuery(next.query);
    setPosition(next.position);
    setSortKey(next.sortKey);
    setSortDir(next.sortDir);
    setStatRanges(next.statRanges);
    setHideDepthGoalies(next.hideDepthGoalies);
    setExpandedId(next.playerId);
    setPendingPlayerId(next.playerId);
    setFiltersOpen(
      Object.values(next.statRanges).some(
        (b) => b?.min?.trim() || b?.max?.trim(),
      ),
    );
  }

  const tableCategories = boardCategories(position);
  const showingAllGoalies =
    !hideDepthGoalies && canToggleDepthGoalies(position);

  return {
    query,
    setQuery,
    deferredQuery,
    position,
    setPosition,
    sortKey,
    sortDir,
    setSortKey,
    setSortDir,
    statRanges,
    filtersOpen,
    setFiltersOpen,
    hideDepthGoalies,
    setHideDepthGoalies,
    expandedId,
    pendingPlayerId,
    setExpandedId: setExpandedIdFromUser,
    helpOpen,
    setHelpOpen,
    filterRangeKeys,
    activeFilterCount,
    filterKey,
    filtered,
    tableCategories,
    showingAllGoalies,
    clearStatFilters,
    removeStatFilter,
    resetBoardView,
    boardShareState,
    toggleSort,
    resetSortToVor,
    updateRange,
    toggleDepthGoalies,
    hydrateFromUrl,
  };
}
