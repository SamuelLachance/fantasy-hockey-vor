"use client";

import { Fragment, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import type { Category, PlayerProjection, Position } from "@/lib/types";
import {
  edgeColor,
  formatSigned,
  formatStat,
  playerCategories,
  sigmaColor,
  vorColor,
} from "@/lib/format";
import { vorForFilter } from "@/lib/rankings-filters";
import { highlightMatch } from "@/lib/highlight-match";
import { STICKY_NAME_BASE, STICKY_NAME_SHADOW } from "@/lib/board-dom";
import { isBoardRowToggleKey } from "@/lib/board-keyboard";
import {
  boardRowAriaLabel,
  boardRowDetailsAriaLabel,
  edgeCellTitle,
  sigmaCellDisplay,
  sigmaCellTitle,
} from "@/lib/board-row-a11y";
import type { PlayerDetailRecord } from "@/lib/publish-players";
import { PositionBadges } from "./PositionBadge";

const ExpandedPlayerPanel = dynamic(
  () =>
    import("./ExpandedPlayerPanel").then((m) => m.ExpandedPlayerPanel),
  { ssr: false },
);

interface RankingsPlayerRowProps {
  player: PlayerProjection;
  idx: number;
  position: Position | "ALL";
  deferredQuery: string;
  isExpanded: boolean;
  isTabStop: boolean;
  tableCategories: readonly Category[];
  playerDetails: PlayerDetailRecord | undefined;
  detailsLoading: boolean;
  detailsError: boolean;
  linkCopied: boolean;
  linkCopyFailed: boolean;
  onToggle: () => void;
  onCopyLink: () => void;
  onDetailsLoaded: (details: Record<string, PlayerDetailRecord>) => void;
  onDetailsError: () => void;
  onClearDetailsError: () => void;
}

export function RankingsPlayerRow({
  player,
  idx,
  position,
  deferredQuery,
  isExpanded,
  isTabStop,
  tableCategories,
  playerDetails,
  detailsLoading,
  detailsError,
  linkCopied,
  linkCopyFailed,
  onToggle,
  onCopyLink,
  onDetailsLoaded,
  onDetailsError,
  onClearDetailsError,
}: RankingsPlayerRowProps) {
  const cats = playerCategories(player);
  const vor = vorForFilter(player, position);
  const stickyBg = isExpanded ? "bg-slate-900" : "bg-slate-950/95";

  function onRowKeyDown(e: KeyboardEvent<HTMLTableRowElement>) {
    if (!isBoardRowToggleKey(e.key)) return;
    e.preventDefault();
    onToggle();
  }

  return (
    <Fragment>
      <tr
        id={`player-row-${player.id}`}
        tabIndex={isTabStop ? 0 : -1}
        aria-expanded={isExpanded}
        aria-controls={
          isExpanded ? `player-panel-${player.id}` : undefined
        }
        aria-label={boardRowAriaLabel(player, position, idx)}
        onClick={onToggle}
        onKeyDown={onRowKeyDown}
        className={`cursor-pointer transition hover:bg-cyan-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300/80 ${
          isExpanded ? "bg-cyan-500/10" : ""
        }`}
      >
        <td
          className={`sticky left-0 z-[1] px-4 py-3 font-mono tabular-nums text-slate-400 ${stickyBg}`}
        >
          {position === "ALL"
            ? player.rank
            : (player.positionRank ?? idx + 1)}
        </td>
        <td
          className={`sticky left-10 z-[1] max-w-[9.5rem] truncate px-4 py-3 font-medium text-white sm:left-12 sm:max-w-[14rem] ${STICKY_NAME_BASE} ${STICKY_NAME_SHADOW} ${stickyBg}`}
          title={player.name}
        >
          {highlightMatch(player.name, deferredQuery)}
        </td>
        <td className="px-4 py-3">
          <PositionBadges
            positions={player.positions}
            vorPosition={player.vorPosition ?? player.position}
          />
        </td>
        <td className="px-4 py-3 font-mono text-slate-300">
          {highlightMatch(player.team, deferredQuery)}
        </td>
        <td className={`px-4 py-3 font-mono tabular-nums font-semibold ${vorColor(vor)}`}>
          {formatSigned(vor, { digits: 2, plusZero: true })}
        </td>
        <td
          className={`px-4 py-3 font-mono tabular-nums text-sm ${edgeColor(player.draftValue ?? 0)}`}
          title={edgeCellTitle(player.syntheticMarketRank, player.rank)}
        >
          {formatSigned(player.draftValue ?? 0)}
        </td>
        <td
          className={`px-3 py-3 font-mono tabular-nums text-sm ${
            player.uncertainty?.total?.sigma != null
              ? sigmaColor(player.uncertainty.total.sigma)
              : "text-slate-500"
          }`}
          title={sigmaCellTitle(player.uncertainty?.total?.sigma)}
        >
          {sigmaCellDisplay(player.uncertainty?.total?.sigma)}
        </td>
        <td className="px-4 py-3 font-mono tabular-nums text-slate-400">
          {player.gamesPlayed}
        </td>
        {tableCategories.map((cat) => (
          <td
            key={cat}
            className="px-3 py-3 text-center font-mono tabular-nums text-slate-300"
          >
            {formatStat(player, cat)}
          </td>
        ))}
      </tr>
      {isExpanded && (
        <tr className="bg-slate-950/40">
          <td
            colSpan={8 + tableCategories.length}
            className="px-6 py-4"
            id={`player-panel-${player.id}`}
            role="region"
            aria-label={boardRowDetailsAriaLabel(player.name)}
            aria-busy={detailsLoading || undefined}
          >
            <ExpandedPlayerPanel
              player={player}
              cats={cats}
              playerDetails={playerDetails}
              detailsLoading={detailsLoading}
              detailsError={detailsError}
              linkCopied={linkCopied}
              linkCopyFailed={linkCopyFailed}
              onCopyLink={onCopyLink}
              onDetailsLoaded={onDetailsLoaded}
              onDetailsError={onDetailsError}
              onClearDetailsError={onClearDetailsError}
            />
          </td>
        </tr>
      )}
    </Fragment>
  );
}
