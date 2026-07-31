import {
  GOALIE_CATEGORIES,
  type Category,
  type PlayerProjection,
  type Position,
} from "@/lib/types";
import { projectionStatValue, skaterCategoriesForFilter } from "@/lib/format";
import { isStarterEligibleGoalie } from "@/lib/goalie-depth";
import {
  passesRanges,
  vorForFilter,
  type RangeKey,
  type SortKey,
  type StatRanges,
} from "@/lib/rankings-filters";

export function boardCategories(position: Position | "ALL"): readonly Category[] {
  return position === "G"
    ? GOALIE_CATEGORIES
    : skaterCategoriesForFilter(position);
}

export function boardFilterKeys(position: Position | "ALL"): RangeKey[] {
  return ["gamesPlayed", "vor", "draftValue", "sigma", ...boardCategories(position)];
}

const CORE_SORT_KEYS = new Set<SortKey>([
  "rank",
  "vor",
  "name",
  "team",
  "gamesPlayed",
  "draftValue",
  "sigma",
]);

/** Reset category sorts that vanish when the position filter changes. */
export function coerceSortKeyForPosition(
  sortKey: SortKey,
  position: Position | "ALL",
): SortKey {
  if (CORE_SORT_KEYS.has(sortKey)) return sortKey;
  const cats = boardCategories(position);
  if ((cats as readonly string[]).includes(sortKey)) return sortKey;
  return "vor";
}

/** Drop category range filters that do not apply to the current position. */
export function pruneStatRangesForPosition(
  ranges: StatRanges,
  position: Position | "ALL",
): StatRanges {
  const allowed = new Set<string>(boardFilterKeys(position));
  let changed = false;
  const out: StatRanges = {};
  for (const [key, bound] of Object.entries(ranges) as [
    RangeKey,
    { min: string; max: string } | undefined,
  ][]) {
    if (!bound) continue;
    if (!allowed.has(key)) {
      changed = true;
      continue;
    }
    out[key] = bound;
  }
  return changed ? out : ranges;
}

export interface BoardQuery {
  position: Position | "ALL";
  query: string;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  statRanges: StatRanges;
  hideDepthGoalies: boolean;
}

/** Pure filter+sort of the rankings board (testable without React). */
export function filterAndSortBoard(
  players: PlayerProjection[],
  q: BoardQuery,
): PlayerProjection[] {
  const needle = q.query.trim().toLowerCase();
  const keys = boardFilterKeys(q.position);
  let list = players;

  if (q.position !== "ALL") {
    list = list.filter((p) => p.positions.includes(q.position as Position));
  }

  if (q.hideDepthGoalies && (q.position === "G" || q.position === "ALL")) {
    list = list.filter(isStarterEligibleGoalie);
  }

  if (needle) {
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.team.toLowerCase().includes(needle),
    );
  }

  list = list.filter((p) => passesRanges(p, q.statRanges, q.position, keys));

  return [...list].sort((a, b) => {
    let av: number | string;
    let bv: number | string;

    if (q.sortKey === "vor") {
      av = vorForFilter(a, q.position);
      bv = vorForFilter(b, q.position);
    } else if (q.sortKey === "rank") {
      av = q.position === "ALL" ? a.rank : (a.positionRank ?? a.rank);
      bv = q.position === "ALL" ? b.rank : (b.positionRank ?? b.rank);
    } else if (q.sortKey === "sigma") {
      av = a.uncertainty?.total?.sigma ?? Number.POSITIVE_INFINITY;
      bv = b.uncertainty?.total?.sigma ?? Number.POSITIVE_INFINITY;
    } else if (
      q.sortKey === "name" ||
      q.sortKey === "team" ||
      q.sortKey === "gamesPlayed" ||
      q.sortKey === "draftValue"
    ) {
      av = q.sortKey === "draftValue" ? (a.draftValue ?? 0) : a[q.sortKey];
      bv = q.sortKey === "draftValue" ? (b.draftValue ?? 0) : b[q.sortKey];
    } else {
      av = projectionStatValue(a, q.sortKey) ?? -Infinity;
      bv = projectionStatValue(b, q.sortKey) ?? -Infinity;
    }

    if (typeof av === "string" && typeof bv === "string") {
      return q.sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return q.sortDir === "asc"
      ? Number(av) - Number(bv)
      : Number(bv) - Number(av);
  });
}
