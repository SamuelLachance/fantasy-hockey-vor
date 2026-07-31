import {
  CATEGORY_FULL_LABELS,
  projectionStatValue,
} from "@/lib/format";
import type { Category, PlayerProjection, Position } from "@/lib/types";

export type CoreSortKey =
  | "rank"
  | "vor"
  | "name"
  | "team"
  | "gamesPlayed"
  | "draftValue";
export type SortKey = CoreSortKey | Category;

export type CoreRangeKey = "gamesPlayed" | "vor" | "draftValue" | "sigma";
export type RangeKey = CoreRangeKey | Category;

export type StatRanges = Partial<Record<RangeKey, { min: string; max: string }>>;

export function vorForFilter(
  player: PlayerProjection,
  filter: Position | "ALL",
): number {
  if (filter !== "ALL") {
    return player.vorByPosition?.[filter] ?? player.vor;
  }
  return player.vor;
}

export function parseRangeValue(
  key: RangeKey,
  raw: string,
): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const v = Number(trimmed);
  if (!Number.isFinite(v)) return undefined;
  if (key === "savePct" && v > 1) return v / 100;
  return v;
}

function coreValue(
  player: PlayerProjection,
  key: CoreRangeKey,
  position: Position | "ALL",
): number | null {
  if (key === "vor") return vorForFilter(player, position);
  if (key === "draftValue") return player.draftValue ?? 0;
  if (key === "sigma") return player.uncertainty?.total?.sigma ?? null;
  return player.gamesPlayed;
}

export function passesRanges(
  player: PlayerProjection,
  ranges: StatRanges,
  position: Position | "ALL",
  validKeys: readonly RangeKey[],
): boolean {
  for (const [key, bounds] of Object.entries(ranges) as [
    RangeKey,
    { min: string; max: string },
  ][]) {
    if (!validKeys.includes(key)) continue;
    if (!bounds?.min && !bounds?.max) continue;

    const min = bounds.min ? parseRangeValue(key, bounds.min) : undefined;
    const max = bounds.max ? parseRangeValue(key, bounds.max) : undefined;
    if (min == null && max == null) continue;

    let value: number | null;
    if (
      key === "gamesPlayed" ||
      key === "vor" ||
      key === "draftValue" ||
      key === "sigma"
    ) {
      value = coreValue(player, key, position);
    } else {
      value = projectionStatValue(player, key);
    }
    if (value == null) return false;
    if (min != null && value < min) return false;
    if (max != null && value > max) return false;
  }
  return true;
}

export function rangeLabel(key: RangeKey): string {
  if (key === "gamesPlayed") return "Games Played";
  if (key === "vor") return "VOR";
  if (key === "draftValue") return "Edge vs consensus";
  if (key === "sigma") return "Uncertainty Σσ";
  return CATEGORY_FULL_LABELS[key];
}

export function defaultSortDir(key: SortKey): "asc" | "desc" {
  return key === "name" || key === "team" || key === "rank" ? "asc" : "desc";
}
