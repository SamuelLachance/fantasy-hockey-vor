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

/** Apply load-more growth only if the reset generation still matches. */
export function applyLoadMoreVisibleCount(
  current: number,
  pageSize: number,
  total: number,
  scheduledGen: number,
  currentGen: number,
): number {
  if (scheduledGen !== currentGen) return current;
  return nextVisibleCount(current, pageSize, total);
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

/** Next mounted-row count for this render (reset + expand floor applied). */
export function resolveVisibleCount(opts: {
  visibleCount: number;
  pageSize: number;
  reset: boolean;
  expandFloor: number;
}): number {
  let next = opts.reset ? opts.pageSize : opts.visibleCount;
  if (opts.expandFloor > next) next = opts.expandFloor;
  return next;
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
  /** Changing this token resets the visible window (filters/query/ranges, not sort). */
  resetToken: string,
  pageSize = BOARD_PAGE_SIZE,
): BoardInfiniteScrollResult {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [prevToken, setPrevToken] = useState(resetToken);
  const skipIoRef = useRef(false);
  const tokenMountedRef = useRef(false);
  const resetGenRef = useRef(0);
  const reset = resetToken !== prevToken;
  if (reset) {
    setPrevToken(resetToken);
  }

  useEffect(() => {
    if (!tokenMountedRef.current) {
      tokenMountedRef.current = true;
      return;
    }
    // Arm after token change so a bottom-clamped sentinel cannot undo the reset.
    skipIoRef.current = true;
    resetGenRef.current += 1;
  }, [resetToken]);

  const expandFloor = expandVisibleFloor(filtered, expandedId, pageSize);
  // Persist expand-driven growth so collapsing a deep row does not yank rows away.
  const renderCount = resolveVisibleCount({
    visibleCount,
    pageSize,
    reset,
    expandFloor,
  });
  if (renderCount !== visibleCount) {
    setVisibleCount(renderCount);
  }

  const filteredLength = filtered.length;
  const canLoadMore = filteredLength > renderCount;

  function loadMore() {
    const gen = resetGenRef.current;
    startTransition(() => {
      setVisibleCount((c) =>
        applyLoadMoreVisibleCount(
          c,
          pageSize,
          filteredLength,
          gen,
          resetGenRef.current,
        ),
      );
    });
  }

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !canLoadMore) return;
    let raf = 0;
    const obs = new IntersectionObserver(
      (entries) => {
        // Background tabs keep intersecting; skip growth until the user returns.
        if (document.visibilityState === "hidden") return;
        if (!entries.some((e) => e.isIntersecting)) return;
        if (skipIoRef.current) {
          skipIoRef.current = false;
          // Re-check next frame so a still-visible sentinel can resume load-more.
          raf = requestAnimationFrame(() => {
            obs.unobserve(el);
            obs.observe(el);
          });
          return;
        }
        const gen = resetGenRef.current;
        startTransition(() => {
          setVisibleCount((c) =>
            applyLoadMoreVisibleCount(
              c,
              pageSize,
              filteredLength,
              gen,
              resetGenRef.current,
            ),
          );
        });
      },
      { rootMargin: "240px 0px" },
    );
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      obs.unobserve(el);
      obs.observe(el);
    };
    document.addEventListener("visibilitychange", onVis);
    obs.observe(el);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (raf) cancelAnimationFrame(raf);
      obs.disconnect();
    };
    // Omit renderCount: keep one observer across page growth so skip+reobserve
    // can resume without reconnecting on every load-more.
  }, [filteredLength, pageSize, canLoadMore]);

  return {
    loadMoreRef,
    renderCount,
    loadMore,
    canLoadMore,
  };
}
