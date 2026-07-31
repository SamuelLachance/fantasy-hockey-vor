import type { Position } from "@/lib/types";
import { BOARD_POSITIONS } from "@/lib/board-positions";
import { HIGHLIGHT_QUERY_MAX } from "@/lib/highlight-match";
import { coerceSortKeyForPosition, pruneStatRangesForPosition } from "@/lib/rankings-board";
import {
  defaultSortDir,
  isInvertedRangeBound,
  parseRangeValue,
  type RangeKey,
  type SortKey,
  type StatRanges,
} from "@/lib/rankings-filters";

/** Cap decoded range bound strings from the URL. */
const RANGE_BOUND_MAX = 24;

const POSITIONS = new Set<Position | "ALL">(BOARD_POSITIONS);
const SORT_KEYS = new Set<string>([
  "rank",
  "name",
  "team",
  "vor",
  "draftValue",
  "sigma",
  "gamesPlayed",
  "goals",
  "assists",
  "shots",
  "blocks",
  "hits",
  "powerplayPoints",
  "penaltyMinutes",
  "faceoffWins",
  "wins",
  "shutouts",
  "saves",
  "savePct",
]);

const RANGE_KEYS = new Set<string>([
  "gamesPlayed",
  "vor",
  "draftValue",
  "sigma",
  "goals",
  "assists",
  "shots",
  "blocks",
  "hits",
  "powerplayPoints",
  "penaltyMinutes",
  "faceoffWins",
  "wins",
  "shutouts",
  "saves",
  "savePct",
]);

export interface RankingsUrlState {
  position: Position | "ALL";
  query: string;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  /** Expanded player id when deep-linking a row. */
  playerId: number | null;
  /** When false, org-depth goalies (≤8 GP) stay visible. Default hide. */
  hideDepthGoalies: boolean;
  /** Active min/max stat filters. */
  statRanges: StatRanges;
}

/** Encode `key:min-max` segments (only parseable bounds). */
export function encodeStatRanges(ranges: StatRanges): string {
  const parts: string[] = [];
  for (const [key, b] of Object.entries(ranges) as [
    RangeKey,
    { min: string; max: string } | undefined,
  ][]) {
    if (!b || !RANGE_KEYS.has(key)) continue;
    if (isInvertedRangeBound(key, b.min, b.max)) continue;
    const minRaw = (b.min?.trim() ?? "").slice(0, RANGE_BOUND_MAX);
    const maxRaw = (b.max?.trim() ?? "").slice(0, RANGE_BOUND_MAX);
    const min =
      minRaw && parseRangeValue(key, minRaw) != null ? minRaw : "";
    const max =
      maxRaw && parseRangeValue(key, maxRaw) != null ? maxRaw : "";
    if (!min && !max) continue;
    parts.push(`${key}:${min}-${max}`);
  }
  return parts.join(",");
}

/** Split `min-max` after `key:` — supports negative mins (`-2-5`) and empty-min (`-50`). */
export function splitStatRangeBounds(
  rest: string,
): { min: string; max: string } | null {
  // Empty min + max only: encode emits `key:-50` → rest `-50`.
  const emptyMin = /^-([^-]+)$/.exec(rest);
  if (emptyMin) return { min: "", max: emptyMin[1]! };
  // Otherwise first non-leading `-` is the separator (`-2-5`, `-2-`, `1.5-`, `-2--5`).
  const both = /^(-?[^-]*)-(.*)$/.exec(rest);
  if (!both) return null;
  return { min: both[1]!, max: both[2]! };
}

export function decodeStatRanges(raw: string | null | undefined): StatRanges {
  if (!raw?.trim()) return {};
  const out: StatRanges = {};
  for (const part of raw.split(",").slice(0, RANGE_KEYS.size)) {
    const m = /^([A-Za-z]+):(.*)$/.exec(part.trim());
    if (!m) continue;
    const key = m[1]!;
    if (!RANGE_KEYS.has(key)) continue;
    const bounds = splitStatRangeBounds(m[2] ?? "");
    if (!bounds) continue;
    out[key as RangeKey] = {
      min: bounds.min.slice(0, RANGE_BOUND_MAX),
      max: bounds.max.slice(0, RANGE_BOUND_MAX),
    };
  }
  return out;
}

export function parseRankingsUrl(params: URLSearchParams): RankingsUrlState {
  const posRaw = params.get("pos")?.toUpperCase() ?? "ALL";
  const position = POSITIONS.has(posRaw as Position | "ALL")
    ? (posRaw as Position | "ALL")
    : "ALL";
  const query = (params.get("q") ?? "").slice(0, HIGHLIGHT_QUERY_MAX);
  const sortRaw = params.get("sort") ?? "vor";
  const sortParsed = (SORT_KEYS.has(sortRaw) ? sortRaw : "vor") as SortKey;
  const sortKey = coerceSortKeyForPosition(sortParsed, position);
  const dirRaw = params.get("dir");
  const sortDir =
    dirRaw === "asc" || dirRaw === "desc"
      ? dirRaw
      : defaultSortDir(sortKey);
  const playerRaw = params.get("player");
  const playerParsed = playerRaw != null ? Number(playerRaw) : NaN;
  const playerId =
    Number.isFinite(playerParsed) && playerParsed > 0
      ? Math.trunc(playerParsed)
      : null;
  const hideDepthGoalies = params.get("g") !== "all";
  const statRanges = pruneStatRangesForPosition(
    decodeStatRanges(params.get("rf")),
    position,
  );
  return {
    position,
    query,
    sortKey,
    sortDir,
    playerId,
    hideDepthGoalies,
    statRanges,
  };
}

/** Build query string omitting defaults so URLs stay short. */
export function rankingsUrlSearch(state: RankingsUrlState): string {
  const p = new URLSearchParams();
  if (state.position !== "ALL") p.set("pos", state.position);
  if (state.query.trim()) p.set("q", state.query.trim());
  if (state.sortKey !== "vor") p.set("sort", state.sortKey);
  // Omit dir only when it matches the sort key's default (VOR→desc, sigma→asc, …).
  if (state.sortDir !== defaultSortDir(state.sortKey)) p.set("dir", state.sortDir);
  if (state.playerId != null) p.set("player", String(state.playerId));
  if (!state.hideDepthGoalies) p.set("g", "all");
  const base = p.toString();
  const rf = encodeStatRanges(state.statRanges ?? {});
  // Append rf manually so `:` / `,` stay readable (URLSearchParams would %3A-encode).
  if (!rf) return base;
  const rfPart = `rf=${rf}`;
  return base ? `${base}&${rfPart}` : rfPart;
}

export function defaultRankingsUrlState(): RankingsUrlState {
  return {
    position: "ALL",
    query: "",
    sortKey: "vor",
    sortDir: "desc",
    playerId: null,
    hideDepthGoalies: true,
    statRanges: {},
  };
}

function boardHref(state: RankingsUrlState): string {
  const q = rankingsUrlSearch(state);
  return q ? `?${q}#rankings` : "#rankings";
}

/** Top Edge card → board sorted by draft value. */
export function edgeBoardHref(): string {
  return boardHref({
    ...defaultRankingsUrlState(),
    sortKey: "draftValue",
    sortDir: "desc",
  });
}

/** Σσ sort deep-link (default asc). */
export function sigmaBoardHref(): string {
  return boardHref({
    ...defaultRankingsUrlState(),
    sortKey: "sigma",
    sortDir: "asc",
  });
}

/** Steadiest card → Σσ asc with VOR ≥ 2 filter (matches top-lists criteria). */
export function steadiestBoardHref(): string {
  return boardHref({
    ...defaultRankingsUrlState(),
    sortKey: "sigma",
    sortDir: "asc",
    statRanges: { vor: { min: "2", max: "" } },
  });
}

/** Expand a single player on the board. */
export function playerBoardHref(id: number): string {
  return boardHref({
    ...defaultRankingsUrlState(),
    playerId: id,
  });
}

/** Absolute shareable board URL (origin + path + query + #rankings). */
export function rankingsShareUrl(
  origin: string,
  pathname: string,
  state: RankingsUrlState,
  basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "",
): string {
  const qs = rankingsUrlSearch(state);
  return `${origin}${rankingsUrlSyncHref(pathname, qs, "#rankings", basePath)}`;
}

export type RankingsUrlSyncAction =
  | { type: "noop"; search: string }
  | { type: "push"; search: string }
  | { type: "hydrate"; search: string };

/**
 * Parse board URL state from the live address bar when available.
 * Prefer `location.search` over React `searchParams` so sync stays correct
 * immediately after `history.replaceState` (Next restores searchParams async).
 */
export function parseLiveRankingsUrl(
  searchParams: { toString(): string },
  locationSearch:
    | string
    | null
    | undefined = typeof window !== "undefined"
      ? window.location.search
      : null,
): RankingsUrlState {
  const raw =
    typeof locationSearch === "string"
      ? locationSearch
      : searchParams.toString();
  const q = raw.startsWith("?") ? raw.slice(1) : raw;
  return parseRankingsUrl(new URLSearchParams(q));
}

/**
 * Decide whether local board state should write the URL, or the URL
 * (Back/Forward / external) should hydrate board state.
 *
 * When local state and the address bar both diverge from `lastPushed`, prefer
 * push — the address bar can lag briefly after a write.
 */
export function nextRankingsUrlSyncAction(
  lastPushed: string | null,
  urlSearch: string,
  stateSearch: string,
): RankingsUrlSyncAction {
  if (stateSearch === urlSearch) {
    return { type: "noop", search: urlSearch };
  }
  if (lastPushed === null) {
    // First sync: if URL already differs from seed state, trust the URL.
    return { type: "hydrate", search: urlSearch };
  }
  if (urlSearch === lastPushed) {
    return { type: "push", search: stateSearch };
  }
  if (stateSearch === lastPushed) {
    return { type: "hydrate", search: urlSearch };
  }
  // Local advanced while URL still shows the previous push target.
  return { type: "push", search: stateSearch };
}

/**
 * Whether a #rankings hash jump should scroll to the board and focus search.
 * Skip when a player deep-link is present so expand-row scroll/focus wins.
 */
export function rankingsHashShouldFocusSearch(
  params: URLSearchParams,
): boolean {
  return parseRankingsUrl(params).playerId == null;
}

/**
 * Absolute path (+ query + optional hash) for the address bar / share links.
 * Includes GitHub Pages `basePath`. Board URL sync should pass `hash=""` so
 * query-only updates never re-trigger `#rankings` scrolling.
 */
export function rankingsUrlSyncHref(
  pathname: string,
  search: string,
  hash = "",
  basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "",
): string {
  const path =
    `${basePath}${pathname || "/"}`.replace(/\/{2,}/g, "/") || "/";
  const qs = search ? `?${search}` : "";
  const fragment =
    !hash || hash.startsWith("#") ? hash : `#${hash}`;
  return `${path}${qs}${fragment}`;
}
