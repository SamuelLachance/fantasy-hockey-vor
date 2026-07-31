import {
  formatRangeChip,
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
}): boolean {
  return (
    input.position !== "ALL" ||
    input.query.trim() !== "" ||
    input.hasStatFilters ||
    input.chipCount > 0 ||
    input.showingAllGoalies
  );
}
