"use client";

import { useEffect } from "react";
import type { Position } from "@/lib/types";
import { boardDocumentTitle } from "@/lib/board-document-title";
import { siteDefaultTitle } from "@/lib/site-meta";

/** Keep the browser tab title in sync with board filters / expanded player. */
export function useBoardDocumentTitle(opts: {
  position: Position | "ALL";
  query: string;
  playerName?: string | null;
}): void {
  const { position, query, playerName } = opts;
  useEffect(() => {
    document.title = boardDocumentTitle({
      position,
      query,
      playerName,
    });
    return () => {
      document.title = siteDefaultTitle();
    };
  }, [position, query, playerName]);
}
