import type { Position } from "@/lib/types";
import type { SortKey } from "@/lib/rankings-filters";

const POSITIONS = new Set<Position | "ALL">(["ALL", "C", "LW", "RW", "D", "G"]);
const SORT_KEYS = new Set<string>([
  "rank",
  "name",
  "team",
  "vor",
  "draftValue",
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

export interface RankingsUrlState {
  position: Position | "ALL";
  query: string;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  /** Expanded player id when deep-linking a row. */
  playerId: number | null;
  /** When false, org-depth goalies (≤8 GP) stay visible. Default hide. */
  hideDepthGoalies: boolean;
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
  const sortDir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : "desc";
  const playerRaw = params.get("player");
  const playerParsed = playerRaw != null ? Number(playerRaw) : NaN;
  const playerId =
    Number.isFinite(playerParsed) && playerParsed > 0
      ? Math.trunc(playerParsed)
      : null;
  const hideDepthGoalies = params.get("g") !== "all";
  return { position, query, sortKey, sortDir, playerId, hideDepthGoalies };
}

/** Build query string omitting defaults so URLs stay short. */
export function rankingsUrlSearch(state: RankingsUrlState): string {
  const p = new URLSearchParams();
  if (state.position !== "ALL") p.set("pos", state.position);
  if (state.query.trim()) p.set("q", state.query.trim());
  if (state.sortKey !== "vor") p.set("sort", state.sortKey);
  if (state.sortDir !== "desc") p.set("dir", state.sortDir);
  if (state.playerId != null) p.set("player", String(state.playerId));
  if (!state.hideDepthGoalies) p.set("g", "all");
  return p.toString();
}
