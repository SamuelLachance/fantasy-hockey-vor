"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { baseView } from "@/lib/player-table/model";
import type { TableBase, TableSpec, TableView } from "@/lib/player-table/types";
import {
  focusFromSearch,
  hasPendingParams,
  hasViewParams,
  parseView,
  presetFromSearch,
  sameViewSearch,
  viewSearch,
} from "@/lib/player-table/url";

/** Safari refuses more than ~100 history writes per 30 s: writes wait for a pause. */
const URL_WRITE_DELAY_MS = 300;

/** Tells the table the URL is readable (inside Suspense, as static export requires). */
function UrlReader({ onRead }: { onRead: () => void }) {
  const params = useSearchParams();
  const search = params.toString();
  useEffect(() => {
    onRead();
  }, [search, onRead]);
  return null;
}

export interface PlayerTableViewState<F> {
  view: TableView<F>;
  setView: Dispatch<SetStateAction<TableView<F>>>;
  /** The address named a view, a preset or a player: load the rows now. */
  explicit: boolean;
  /** A `?vue=` preset to apply once the data is in. */
  pendingPreset: string | null;
  clearPendingPreset(): void;
  /** A `?joueur=` row to open once the data is in. */
  focus: string | null;
  clearFocus(): void;
  /** Render once: reads the URL (first paint, then Back / Forward). */
  reader: ReactNode;
}

/**
 * The table's view, bookmarked in the address bar as its difference from
 * the tab's base view. Read inside Suspense on mount and on Back /
 * Forward; written with the native History API (Next's patched
 * replaceState soft-navigates and scrolls to the top on static export),
 * debounced, and only when the address says something else.
 */
export function usePlayerTableView<R, F, Caps, Ctx>(
  spec: TableSpec<R, F, Caps, Ctx>,
  base: TableBase<F>,
): PlayerTableViewState<F> {
  const [view, setView] = useState<TableView<F>>(() => baseView(base));
  const [explicit, setExplicit] = useState(false);
  const [pendingPreset, setPendingPreset] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const hydrated = useRef(false);
  const baseRef = useRef(base);
  useEffect(() => {
    baseRef.current = base;
  }, [base]);

  const readUrl = useCallback(() => {
    const search = window.location.search;
    hydrated.current = true;
    setView(parseView(spec, search, baseRef.current));
    setExplicit(hasViewParams(spec, search));
    setPendingPreset(presetFromSearch(spec, search));
    setFocus(focusFromSearch(search));
  }, [spec]);

  useEffect(() => {
    window.addEventListener("popstate", readUrl);
    return () => window.removeEventListener("popstate", readUrl);
  }, [readUrl]);

  // view → URL. A `vue` / `joueur` param stays until it is resolved, then goes.
  const waiting = pendingPreset !== null || focus !== null;
  useEffect(() => {
    if (!hydrated.current || waiting) return;
    const id = window.setTimeout(() => {
      const search = window.location.search;
      if (!hasPendingParams(search) && sameViewSearch(spec, view, baseRef.current, search)) return;
      const next = viewSearch(spec, view, baseRef.current, search);
      try {
        const url = `${window.location.pathname}${next}${window.location.hash}`;
        History.prototype.replaceState.call(window.history, window.history.state, "", url);
      } catch {
        // Sandboxed frames can refuse history writes; the view still applies.
      }
    }, URL_WRITE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [spec, view, waiting]);

  const clearPendingPreset = useCallback(() => setPendingPreset(null), []);
  const clearFocus = useCallback(() => setFocus(null), []);

  return {
    view,
    setView,
    explicit,
    pendingPreset,
    clearPendingPreset,
    focus,
    clearFocus,
    reader: (
      <Suspense fallback={null}>
        <UrlReader onRead={readUrl} />
      </Suspense>
    ),
  };
}
