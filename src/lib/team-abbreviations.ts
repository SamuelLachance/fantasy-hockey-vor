/**
 * NHL team abbreviation normalization + franchise continuity across relocations.
 *
 * Season IDs are NHL cayenne style: 20232024 = 2023-24.
 */

/** Canonical present-day abbrevs for short / legacy codes. */
const PRESENT_ALIASES: Record<string, string> = {
  ARI: "UTA",
  PHX: "UTA",
  SJ: "SJS",
  LA: "LAK",
  NJ: "NJD",
  TB: "TBL",
  WSH: "WSH",
  WAS: "WSH",
};

/**
 * For a modern abbrev + historical season, which abbrev the NHL API / our
 * caches actually used that year. First matching rule wins.
 */
const FRANCHISE_HISTORY: Array<{
  modern: string;
  /** Inclusive seasonId range where `historical` was the on-ice abbrev. */
  fromSeasonId: number;
  toSeasonId: number;
  historical: string;
}> = [
  // Arizona Coyotes → Utah Hockey Club (2024-25)
  { modern: "UTA", fromSeasonId: 20142015, toSeasonId: 20232024, historical: "ARI" },
  { modern: "UTA", fromSeasonId: 0, toSeasonId: 20132014, historical: "PHX" },
  // Atlanta Thrashers → Winnipeg Jets (2011-12)
  { modern: "WPG", fromSeasonId: 0, toSeasonId: 20102011, historical: "ATL" },
];

/** First listed team, uppercased (handles "DAL,COL" trade strings). */
export function primaryTeam(team: string): string {
  return team.split(",")[0]?.trim().toUpperCase() || "";
}

/** Map short/legacy codes to the current canonical abbrev (ARI→UTA, etc.). */
export function normalizeTeamAbbrev(team: string): string {
  const t = primaryTeam(team);
  return PRESENT_ALIASES[t] ?? t;
}

/**
 * Abbreviation under which team-season context was stored for `seasonId`.
 * Use for cache lookups (`teamBySeasonTeam`, SA/g, goalie GP pools).
 */
export function franchiseTeamForSeason(team: string, seasonId: number): string {
  const modern = normalizeTeamAbbrev(team);
  for (const rule of FRANCHISE_HISTORY) {
    if (rule.modern !== modern) continue;
    if (seasonId >= rule.fromSeasonId && seasonId <= rule.toSeasonId) {
      return rule.historical;
    }
  }
  // Prefer the historical code if the caller still has ARI/PHX on an old row.
  const raw = primaryTeam(team);
  if (raw === "ARI" || raw === "PHX" || raw === "ATL") return raw;
  return modern;
}

/** `${team}:${seasonId}` key with franchise-aware team. */
export function franchiseTeamSeasonKey(team: string, seasonId: number): string {
  return `${franchiseTeamForSeason(team, seasonId)}:${seasonId}`;
}
