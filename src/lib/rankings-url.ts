import type { Position } from "@/lib/types";
import {
  defaultSortDir,
  type RangeKey,
  type SortKey,
  type StatRanges,
} from "@/lib/rankings-filters";

const POSITIONS = new Set<Position | "ALL">(["ALL", "C", "LW", "RW", "D", "G"]);
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

/** Encode `key:min-max` segments (empty side allowed). */
export function encodeStatRanges(ranges: StatRanges): string {
  const parts: string[] = [];
  for (const [key, b] of Object.entries(ranges) as [
    RangeKey,
    { min: string; max: string } | undefined,
  ][]) {
    if (!b || !RANGE_KEYS.has(key)) continue;
    const min = b.min?.trim() ?? "";
    const max = b.max?.trim() ?? "";
    if (!min && !max) continue;
    parts.push(`${key}:${min}-${max}`);
  }
  return parts.join(",");
}

export function decodeStatRanges(raw: string | null | undefined): StatRanges {
  if (!raw?.trim()) return {};
  const out: StatRanges = {};
  for (const part of raw.split(",")) {
    const m = /^([A-Za-z]+):([^-]*)-(.*)$/.exec(part.trim());
    if (!m) continue;
    const key = m[1]!;
    if (!RANGE_KEYS.has(key)) continue;
    out[key as RangeKey] = { min: m[2] ?? "", max: m[3] ?? "" };
  }
  return out;
}

export function parseRankingsUrl(params: URLSearchParams): RankingsUrlState {
  const posRaw = params.get("pos")?.toUpperCase() ?? "ALL";
  const position = POSITIONS.has(posRaw as Position | "ALL")
    ? (posRaw as Position | "ALL")
    : "ALL";
  const query = params.get("q") ?? "";
  const sortRaw = params.get("sort") ?? "vor";
  const sortKey = (SORT_KEYS.has(sortRaw) ? sortRaw : "vor") as SortKey;
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
  const statRanges = decodeStatRanges(params.get("rf"));
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
