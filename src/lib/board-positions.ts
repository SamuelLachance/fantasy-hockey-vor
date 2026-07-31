import type { Position } from "@/lib/types";

/** Ordered board position filter tabs (ALL first). */
export const BOARD_POSITIONS = [
  "ALL",
  "C",
  "LW",
  "RW",
  "D",
  "G",
] as const satisfies ReadonlyArray<Position | "ALL">;

export type BoardPosition = (typeof BOARD_POSITIONS)[number];

/** Stable DOM id for a position filter tab (tablist keyboard focus). */
export function boardPositionTabId(position: Position | "ALL"): string {
  return `board-pos-tab-${position}`;
}

/** Screen-reader announcement when the position filter changes. */
export function positionFilterAnnounce(position: Position | "ALL"): string {
  return `Position filter ${position}`;
}

/** Tablist accessible name for position filters. */
export function positionFilterTablistLabel(): string {
  return "Filter by position";
}

/** Next tab index for arrow / Home / End keyboard navigation. */
export function nextBoardPositionIndex(
  currentIndex: number,
  key: "ArrowRight" | "ArrowLeft" | "Home" | "End",
  length = BOARD_POSITIONS.length,
): number {
  if (length <= 0) return 0;
  const i = ((currentIndex % length) + length) % length;
  if (key === "ArrowRight") return (i + 1) % length;
  if (key === "ArrowLeft") return (i - 1 + length) % length;
  if (key === "Home") return 0;
  return length - 1;
}

/** Cycle position tabs by ±1 (used by [ / ] hotkeys). */
export function cycleBoardPosition(
  current: Position | "ALL",
  direction: 1 | -1,
): BoardPosition {
  const idx = BOARD_POSITIONS.indexOf(current);
  const next = nextBoardPositionIndex(
    idx < 0 ? 0 : idx,
    direction === 1 ? "ArrowRight" : "ArrowLeft",
  );
  return BOARD_POSITIONS[next]!;
}
