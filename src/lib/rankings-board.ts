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
  rankForFilter,
  vorForFilter,
  type RangeKey,
  type SortKey,
  type StatRanges,
} from "@/lib/rankings-filters";
import { foldSearchText } from "@/lib/search-fold";

const foldedSearchFields = new WeakMap<
  PlayerProjection,
  readonly [name: string, team: string]
>();

/** Folded name+team for board search; cached per player object. */
export function foldedBoardSearchFields(
  p: PlayerProjection,
): readonly [name: string, team: string] {
  const hit = foldedSearchFields.get(p);
  if (hit) return hit;
  const next = [foldSearchText(p.name), foldSearchText(p.team)] as const;
  foldedSearchFields.set(p, next);
  return next;
}

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
  const needle = foldSearchText(q.query.trim());
  const keys = boardFilterKeys(q.position);
  let list = players;

  if (q.position !== "ALL") {
    list = list.filter((p) => p.positions.includes(q.position as Position));
  }

  if (q.hideDepthGoalies && (q.position === "G" || q.position === "ALL")) {
    list = list.filter(isStarterEligibleGoalie);
  }

  if (needle) {
    list = list.filter((p) => {
      const [name, team] = foldedBoardSearchFields(p);
      return name.includes(needle) || team.includes(needle);
    });
  }

  list = list.filter((p) => passesRanges(p, q.statRanges, q.position, keys));

  return [...list].sort((a, b) => {
    let av: number | string;
    let bv: number | string;

    if (q.sortKey === "vor") {
      av = vorForFilter(a, q.position);
      bv = vorForFilter(b, q.position);
    } else if (q.sortKey === "rank") {
      av = rankForFilter(a, q.position);
      bv = rankForFilter(b, q.position);
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

    let cmp: number;
    if (typeof av === "string" && typeof bv === "string") {
      cmp =
        q.sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    } else {
      cmp =
        q.sortDir === "asc"
          ? Number(av) - Number(bv)
          : Number(bv) - Number(av);
    }
    // Two missing values both map to the same Infinity sentinel, and
    // Infinity − Infinity is NaN — which is truthy for `!== 0` and would
    // return NaN, skipping the tie-break and leaving order input-dependent.
    if (Number.isNaN(cmp)) cmp = 0;
    if (cmp !== 0) return cmp;
    // Deterministic tie-break so team/GP/stat ties are not input-order dependent.
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.id - b.id;
  });
}

/**
 * Peel the fewest filters so `player` reappears on the board (search →
 * position → depth goalies → stat ranges).
 */
export function revealHiddenPlayerQuery(
  player: PlayerProjection,
  q: BoardQuery,
): BoardQuery {
  if (filterAndSortBoard([player], q).length > 0) return q;

  const steps: Array<(cur: BoardQuery) => BoardQuery> = [
    (cur) => (cur.query.trim() ? { ...cur, query: "" } : cur),
    (cur) =>
      cur.position !== "ALL" &&
      !player.positions.includes(cur.position as Position)
        ? { ...cur, position: "ALL" }
        : cur,
    (cur) =>
      cur.hideDepthGoalies ? { ...cur, hideDepthGoalies: false } : cur,
    (cur) =>
      Object.keys(cur.statRanges).length > 0
        ? { ...cur, statRanges: {} }
        : cur,
  ];

  let next = q;
  for (const step of steps) {
    const candidate = step(next);
    if (candidate === next) continue;
    next = candidate;
    if (filterAndSortBoard([player], next).length > 0) return next;
  }
  return next;
}
