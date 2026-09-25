"use client";

import type { Category, PlayerProjection } from "@/lib/types";
import type { PlayerDetailRecord } from "@/lib/publish-players";
import { ExpandedPlayerCategories } from "./ExpandedPlayerCategories";
import { ExpandedPlayerMeta } from "./ExpandedPlayerMeta";
import { ExpandedPlayerNotes } from "./ExpandedPlayerNotes";
import { ExpandedPlayerSnake } from "./snake/ExpandedPlayerSnake";

interface ExpandedPlayerPanelProps {
  player: PlayerProjection;
  cats: readonly Category[];
  playerDetails: PlayerDetailRecord | undefined;
  detailsLoading: boolean;
  detailsError: boolean;
  linkCopied: boolean;
  linkCopyFailed?: boolean;
  onCopyLink: () => void;
  onDetailsLoaded: (details: Record<string, PlayerDetailRecord>) => void;
  onDetailsError: () => void;
  onClearDetailsError: () => void;
}

export function ExpandedPlayerPanel({
  player,
  cats,
  playerDetails,
  detailsLoading,
  detailsError,
  linkCopied,
  linkCopyFailed = false,
  onCopyLink,
  onDetailsLoaded,
  onDetailsError,
  onClearDetailsError,
}: ExpandedPlayerPanelProps) {
  return (
    <div>
      <ExpandedPlayerMeta
        player={player}
        linkCopied={linkCopied}
        linkCopyFailed={linkCopyFailed}
        onCopyLink={onCopyLink}
      />
      <ExpandedPlayerNotes
        playerId={player.id}
        playerDetails={playerDetails}
        detailsLoading={detailsLoading}
        detailsError={detailsError}
        onDetailsLoaded={onDetailsLoaded}
        onDetailsError={onDetailsError}
        onClearDetailsError={onClearDetailsError}
      />
      <ExpandedPlayerCategories
        player={player}
        cats={cats}
        playerDetails={playerDetails}
      />
      <ExpandedPlayerSnake playerId={player.id} />
    </div>
  );
}
