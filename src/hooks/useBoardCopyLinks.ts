"use client";

import { useState } from "react";
import type { CopyFlash } from "@/lib/copy-flash";
import { copyTextWithFlash } from "@/lib/copy-flash";
import type { RankingsUrlState } from "@/lib/rankings-url";
import { rankingsShareUrl } from "@/lib/rankings-url";

type ShareStateFor = (expandedId: number | null) => RankingsUrlState;

/** Board + per-player share-link copy with brief ok/err flash. */
export function useBoardCopyLinks(
  pathname: string,
  boardShareState: ShareStateFor,
  expandedId: number | null,
) {
  const [boardLinkStatus, setBoardLinkStatus] = useState<CopyFlash>("idle");
  const [playerLinkStatus, setPlayerLinkStatus] = useState<{
    id: number | null;
    status: CopyFlash;
  }>({ id: null, status: "idle" });

  function copyBoardLink() {
    copyTextWithFlash(
      rankingsShareUrl(
        window.location.origin,
        pathname,
        boardShareState(expandedId),
      ),
      setBoardLinkStatus,
    );
  }

  function copyPlayerLink(playerId: number) {
    setPlayerLinkStatus({ id: playerId, status: "idle" });
    copyTextWithFlash(
      rankingsShareUrl(
        window.location.origin,
        pathname,
        boardShareState(playerId),
      ),
      (status) => {
        setPlayerLinkStatus({ id: playerId, status });
      },
    );
  }

  return {
    boardLinkStatus,
    playerLinkStatus,
    copyBoardLink,
    copyPlayerLink,
  };
}
