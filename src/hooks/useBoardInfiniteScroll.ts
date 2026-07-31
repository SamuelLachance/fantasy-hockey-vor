"use client";

import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

export const BOARD_PAGE_SIZE = 80;

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

  const renderCount = useMemo(() => {
    if (expandedId == null) return visibleCount;
    const idx = filtered.findIndex((p) => p.id === expandedId);
    if (idx < 0) return visibleCount;
    return Math.max(
      visibleCount,
      Math.min(filtered.length, idx + 1 + pageSize),
    );
  }, [expandedId, filtered, visibleCount, pageSize]);

  const filteredLength = filtered.length;
  const canLoadMore = filteredLength > renderCount;

  function loadMore() {
    startTransition(() => {
      setVisibleCount((c) => Math.min(c + pageSize, filteredLength));
    });
  }

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !canLoadMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          startTransition(() => {
            setVisibleCount((c) => Math.min(c + pageSize, filteredLength));
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
