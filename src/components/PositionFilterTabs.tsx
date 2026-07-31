"use client";

import { startTransition, type KeyboardEvent } from "react";
import type { Position } from "@/lib/types";
import {
  BOARD_POSITIONS,
  boardPositionPanelId,
  boardPositionTabId,
  nextBoardPositionIndex,
  positionFilterAnnounce,
  positionFilterTabLabel,
  positionFilterTablistLabel,
} from "@/lib/board-positions";

interface PositionFilterTabsProps {
  position: Position | "ALL";
  setPosition: (pos: Position | "ALL") => void;
}

/** Arrow-keyable position filter tabs for the rankings toolbar. */
export function PositionFilterTabs({
  position,
  setPosition,
}: PositionFilterTabsProps) {
  function onPositionTabKeyDown(e: KeyboardEvent, index: number) {
    if (
      e.key !== "ArrowRight" &&
      e.key !== "ArrowLeft" &&
      e.key !== "Home" &&
      e.key !== "End"
    ) {
      return;
    }
    e.preventDefault();
    const next = nextBoardPositionIndex(
      index,
      e.key as "ArrowRight" | "ArrowLeft" | "Home" | "End",
    );
    startTransition(() => setPosition(BOARD_POSITIONS[next]!));
    const tabs = (
      e.currentTarget.parentElement as HTMLElement | null
    )?.querySelectorAll('[role="tab"]');
    const el = tabs?.[next] as HTMLElement | undefined;
    el?.focus();
  }

  return (
    <div
      className="flex flex-wrap gap-2"
      role="tablist"
      aria-label={positionFilterTablistLabel()}
      aria-keyshortcuts="[ ]"
    >
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {positionFilterAnnounce(position)}
      </span>
      {BOARD_POSITIONS.map((pos, index) => (
        <button
          key={pos}
          type="button"
          role="tab"
          aria-label={positionFilterTabLabel(pos)}
          aria-selected={position === pos}
          aria-controls={boardPositionPanelId()}
          id={boardPositionTabId(pos)}
          tabIndex={position === pos ? 0 : -1}
          onClick={() => startTransition(() => setPosition(pos))}
          onKeyDown={(e) => onPositionTabKeyDown(e, index)}
          className={`inline-flex min-h-11 items-center rounded-full px-4 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
            position === pos
              ? "bg-cyan-500 text-slate-950"
              : "bg-white/5 text-slate-300 hover:bg-white/10"
          }`}
        >
          {pos}
        </button>
      ))}
    </div>
  );
}
