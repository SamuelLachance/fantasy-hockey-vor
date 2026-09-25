"use client";

import { createContext, useContext } from "react";

/**
 * Query string the league's tab links carry (e.g. `?team=<id>` for a
 * non-default Fantrax team). Filled by the league's provider from React
 * state: a team chosen through the native History API never reaches
 * useSearchParams, so the URL cannot be the source.
 */
export const TabSearchContext = createContext<string>("");

export function useTabSearch(): string {
  return useContext(TabSearchContext);
}
