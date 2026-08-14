import {
  formatRangeChip,
  isInvertedRangeBound,
  parseRangeValue,
  rangeLabel,
  type RangeKey,
  type StatRanges,
} from "@/lib/rankings-filters";
import type { Position } from "@/lib/types";

export type BoardStatChip = {
  key: RangeKey;
  label: string;
  bounds: string;
};

/** Chip label using only parseable min/max sides. */
export function formatActiveRangeChip(
  key: RangeKey,
  min: string,
  max: string,
): string {
  const minOk =
    min.trim() && parseRangeValue(key, min) != null ? min : "";
  const maxOk =
    max.trim() && parseRangeValue(key, max) != null ? max : "";
  return formatRangeChip(minOk, maxOk);
}

/** Stat range chips currently active on the board chrome. */
export function boardActiveStatChips(
  statRanges: StatRanges,
  showStatChips: boolean,
): BoardStatChip[] {
  if (!showStatChips) return [];
  const out: BoardStatChip[] = [];
  for (const [key, bounds] of Object.entries(statRanges) as Array<
    [RangeKey, { min: string; max: string } | undefined]
  >) {
    if (!bounds) continue;
    if (isInvertedRangeBound(key, bounds.min, bounds.max)) continue;
    const chip = formatActiveRangeChip(key, bounds.min ?? "", bounds.max ?? "");
    if (!chip) continue;
    out.push({ key, label: rangeLabel(key), bounds: chip });
  }
  return out;
}

/** Whether the active-filters chrome strip should render. */
export function boardActiveFiltersVisible(input: {
  position: Position | "ALL";
  query: string;
  hasStatFilters: boolean;
  chipCount: number;
  showingAllGoalies: boolean;
  hasLinkedPlayer?: boolean;
}): boolean {
  return (
    input.position !== "ALL" ||
    input.query.trim() !== "" ||
    input.hasStatFilters ||
    input.chipCount > 0 ||
    input.showingAllGoalies ||
    Boolean(input.hasLinkedPlayer)
  );
}

/** Region label for the active-filters chrome strip. */
export function boardActiveFiltersRegionLabel(): string {
  return "Active board filters";
}

/** Visible chip text for a non-ALL position filter. */
export function boardActivePositionChipLabel(position: Position): string {
  return `Pos ${position}`;
}

/** Clear control accessible name for the position chip. */
export function boardActiveClearPositionAriaLabel(): string {
  return "Clear position filter";
}

/** Clear control accessible name for the search chip. */
export function boardActiveClearSearchAriaLabel(): string {
  return "Clear search";
}

/** Visible chip text when All G (depth goalies) is active. */
export function boardActiveAllGoaliesChipLabel(): string {
  return "All goalies";
}

/** Clear control accessible name for the All goalies chip. */
export function boardActiveShowStartersAriaLabel(): string {
  return "Show starter goalies only";
}

/** Tooltip on a stat chip that opens the filters panel. */
export function boardActiveEditFiltersTitle(): string {
  return "Edit filters";
}

/** Accessible name for the stat chip that opens the filters panel. */
export function boardActiveEditStatAriaLabel(label: string): string {
  return `Edit ${label} filter`;
}

/** Remove control accessible name for a single stat chip. */
export function boardActiveRemoveStatAriaLabel(label: string): string {
  return `Remove ${label} filter`;
}

/** Visible chip that reveals a filter-hidden deep-linked player. */
export function showLinkedPlayerChipLabel(name: string): string {
  return `Show ${name}`;
}

/** Accessible name for the show-linked-player chip. */
export function showLinkedPlayerAriaLabel(name: string): string {
  return `Show linked player ${name}`;
}
