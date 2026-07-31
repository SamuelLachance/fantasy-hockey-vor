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
} from "@/lib/rankings-board";
import { countActiveStatFilters } from "@/lib/board-active-filters";
import { boardHasPlayerId } from "@/lib/board-players";
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
  const [helpOpen, setHelpOpen] = useState(false);

  // Drop deep-linked expand ids that are no longer on the board dataset.
  if (expandedId != null && !boardHasPlayerId(players, expandedId)) {
    setExpandedId(null);
  }

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
  );

  const [prevPosition, setPrevPosition] = useState(position);
  if (position !== prevPosition) {
    setPrevPosition(position);
    const nextKey = coerceSortKeyForPosition(sortKey, position);
    if (nextKey !== sortKey) {
      setSortKey(nextKey);
      setSortDir("desc");
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
      query: deferredQuery,
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
      setStatRanges((prev) => ({
        ...prev,
        [key]: { min: "", max: "", ...prev[key], [field]: value },
      }));
    });
  }

  function toggleDepthGoalies() {
    if (!canToggleDepthGoalies(position)) return;
    startTransition(() => setHideDepthGoalies((v) => !v));
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
    setExpandedId,
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
  };
}
