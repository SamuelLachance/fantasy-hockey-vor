"use client";

import { useState } from "react";
import type { CopyFlash } from "@/lib/copy-flash";
import { copyTextWithFlash } from "@/lib/copy-flash";
import type { RankingsUrlState } from "@/lib/rankings-url";
import { rankingsShareUrl } from "@/lib/rankings-url";

type ShareStateFor = (playerId: number | null) => RankingsUrlState;

/** Board + per-player share-link copy with brief ok/err flash. */
export function useBoardCopyLinks(
  pathname: string,
  boardShareState: ShareStateFor,
) {
  const [boardLinkStatus, setBoardLinkStatus] = useState<CopyFlash>("idle");
  const [playerLinkStatus, setPlayerLinkStatus] = useState<{
    id: number | null;
    status: CopyFlash;
  }>({ id: null, status: "idle" });

  function copyBoardLink() {
    // Board view share never includes an expanded player (that is `p` / copyPlayerLink).
    copyTextWithFlash(
      rankingsShareUrl(
        window.location.origin,
        pathname,
        boardShareState(null),
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
