"use client";

import { useEffect, useRef } from "react";
import type { PlayerProjection } from "@/lib/types";
import { focusStatsFilterButton } from "@/lib/board-dom";
import { defaultSortDir, type SortKey } from "@/lib/rankings-filters";

interface RankingsKeyboardInput {
  filtered: PlayerProjection[];
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
}

/** Global board shortcuts: Esc, /, ?, j/k, r, l. */
export function useRankingsKeyboard({
  filtered,
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
}: RankingsKeyboardInput): void {
  // Keep latest handlers/state without rebinding the window listener every render.
  const filteredRef = useRef(filtered);
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

  useEffect(() => {
    filteredRef.current = filtered;
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
  });

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      const helpOpenNow = helpOpenRef.current;
      const filtersOpenNow = filtersOpenRef.current;
      const expandedIdNow = expandedIdRef.current;

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
        if (inField) return;
        setExpandedIdRef.current(null);
        return;
      }
      if (
        !inField &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        (e.key === "?" || (e.key === "/" && e.shiftKey))
      ) {
        e.preventDefault();
        setHelpOpenRef.current((o) => !o);
        return;
      }
      if (
        !inField &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key === "/"
      ) {
        e.preventDefault();
        document
          .querySelector<HTMLInputElement>('#rankings input[type="search"]')
          ?.focus();
        return;
      }
      if (
        !inField &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        (e.key === "f" || e.key === "F")
      ) {
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
      if (
        !inField &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !helpOpenNow &&
        e.key === "Home"
      ) {
        e.preventDefault();
        const reduce = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
        return;
      }
      if (
        !inField &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !helpOpenNow &&
        e.key === "End"
      ) {
        e.preventDefault();
        const reduce = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        document.getElementById("rankings")?.scrollIntoView({
          behavior: reduce ? "auto" : "smooth",
          block: "start",
        });
        return;
      }
      if (
        !inField &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !helpOpenNow &&
        (e.key === "r" || e.key === "R") &&
        onResetBoardRef.current
      ) {
        e.preventDefault();
        onResetBoardRef.current();
        return;
      }
      if (
        !inField &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !helpOpenNow &&
        (e.key === "l" || e.key === "L") &&
        onCopyBoardLinkRef.current
      ) {
        e.preventDefault();
        onCopyBoardLinkRef.current();
        return;
      }
      if (!inField && !e.metaKey && !e.ctrlKey && !e.altKey && !helpOpenNow) {
        const sortHotkeys: Record<string, SortKey> = {
          v: "vor",
          e: "draftValue",
          u: "sigma",
          g: "gamesPlayed",
        };
        const sortKey = sortHotkeys[e.key.toLowerCase()];
        if (sortKey) {
          e.preventDefault();
          setSortKeyRef.current(sortKey);
          setSortDirRef.current(defaultSortDir(sortKey));
          return;
        }
      }
      if (inField || helpOpenNow || expandedIdNow == null) return;
      if (
        e.key !== "j" &&
        e.key !== "k" &&
        e.key !== "ArrowDown" &&
        e.key !== "ArrowUp"
      ) {
        return;
      }
      e.preventDefault();
      const list = filteredRef.current;
      const idx = list.findIndex((p) => p.id === expandedIdNow);
      if (idx < 0) return;
      const next =
        e.key === "j" || e.key === "ArrowDown" ? idx + 1 : idx - 1;
      if (next < 0 || next >= list.length) return;
      setExpandedIdRef.current(list[next]!.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
