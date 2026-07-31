"use client";

import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export const BOARD_PAGE_SIZE = 100;

/** Grow the visible window without overshooting the filtered list. */
export function nextVisibleCount(
  current: number,
  pageSize: number,
  total: number,
): number {
  return Math.min(current + pageSize, total);
}

/**
 * Minimum rows to keep mounted so an expanded player (and a page of context)
 * stay in the DOM. Persisted into visibleCount so collapse does not shrink.
 */
export function expandVisibleFloor(
  filtered: readonly { id: number }[],
  expandedId: number | null,
  pageSize: number,
): number {
  if (expandedId == null) return 0;
  const idx = filtered.findIndex((p) => p.id === expandedId);
  if (idx < 0) return 0;
  return Math.min(filtered.length, idx + 1 + pageSize);
}

interface BoardInfiniteScrollResult {
  loadMoreRef: RefObject<HTMLDivElement | null>;
  renderCount: number;
  loadMore: () => void;
  canLoadMore: boolean;
}

/** Progressive row window + intersection observer for the rankings table. */
export function useBoardInfiniteScroll<T extends { id: number }>(
  filtered: T[],
  expandedId: number | null,
  /** Changing this token resets the visible window (filters/query/ranges). */
  resetToken: string,
  pageSize = BOARD_PAGE_SIZE,
): BoardInfiniteScrollResult {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [prevToken, setPrevToken] = useState(resetToken);
  if (resetToken !== prevToken) {
    setPrevToken(resetToken);
    setVisibleCount(pageSize);
  }

  // Persist expand-driven growth so collapsing a deep row does not yank rows away.
  const expandFloor = expandVisibleFloor(filtered, expandedId, pageSize);
  if (expandFloor > visibleCount) {
    setVisibleCount(expandFloor);
  }

  const renderCount = Math.max(visibleCount, expandFloor);
  const filteredLength = filtered.length;
  const canLoadMore = filteredLength > renderCount;

  function loadMore() {
    startTransition(() => {
      setVisibleCount((c) => nextVisibleCount(c, pageSize, filteredLength));
    });
  }

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !canLoadMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          startTransition(() => {
            setVisibleCount((c) =>
              nextVisibleCount(c, pageSize, filteredLength),
            );
          });
        }
      },
      { rootMargin: "240px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [filteredLength, renderCount, pageSize, canLoadMore]);

  return {
    loadMoreRef,
    renderCount,
    loadMore,
    canLoadMore,
  };
}
