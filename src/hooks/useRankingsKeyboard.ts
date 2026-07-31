"use client";

import { useEffect } from "react";
import type { PlayerProjection } from "@/lib/types";

interface RankingsKeyboardInput {
  filtered: PlayerProjection[];
  expandedId: number | null;
  setExpandedId: (id: number | null) => void;
  filtersOpen: boolean;
  setFiltersOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  helpOpen: boolean;
  setHelpOpen: (open: boolean | ((o: boolean) => boolean)) => void;
}

/** Global board shortcuts: Esc, /, ?, j/k. */
export function useRankingsKeyboard({
  filtered,
  expandedId,
  setExpandedId,
  filtersOpen,
  setFiltersOpen,
  helpOpen,
  setHelpOpen,
}: RankingsKeyboardInput): void {
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "Escape") {
        if (helpOpen) {
          setHelpOpen(false);
          return;
        }
        if (filtersOpen) {
          setFiltersOpen(false);
          return;
        }
        if (inField) return;
        setExpandedId(null);
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
        setHelpOpen((o) => !o);
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
        setFiltersOpen((open) => {
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
      if (inField || helpOpen || expandedId == null) return;
      if (
        e.key !== "j" &&
        e.key !== "k" &&
        e.key !== "ArrowDown" &&
        e.key !== "ArrowUp"
      ) {
        return;
      }
      e.preventDefault();
      const idx = filtered.findIndex((p) => p.id === expandedId);
      if (idx < 0) return;
      const next =
        e.key === "j" || e.key === "ArrowDown" ? idx + 1 : idx - 1;
      if (next < 0 || next >= filtered.length) return;
      setExpandedId(filtered[next]!.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    expandedId,
    filtered,
    filtersOpen,
    helpOpen,
    setExpandedId,
    setFiltersOpen,
    setHelpOpen,
  ]);
}
