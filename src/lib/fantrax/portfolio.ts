/**
 * A dynasty portfolio, without a new prediction model. The seasonal curve
 * sums the published expected gains (eG); horizon values come directly from
 * dv. These are dynasty units, never the projected season fantasy points.
 * Missing players remain unknown. Only explicit `zero` ids count as zero.
 */
import type { AssetHorizon, AssetRecord } from "../dynasty/asset-score";

export interface PortfolioSnapshot {
  version: 1;
  season: string;
  builtAt: string;
  inputs?: { stateFetchedAt?: string };
  players: Readonly<Record<string, AssetRecord>>;
  zero: readonly string[];
}

export interface PortfolioSeason {
  season: number;
  label: string;
  gain: number;
  median: number | null;
  /** Tied values share the same rank; unknown coverage has no rank. */
  rank: number | null;
}

export interface PortfolioPlayer {
  id: string;
  name: string;
  group: AssetRecord["g"];
  value: number;
  /** Expected positive gains from season three on, without discount. */
  laterGain: number;
}

export interface PortfolioOutlookModel {
  seasons: PortfolioSeason[];
  total: number;
  topThreeShare: number | null;
  nearShare: number | null;
  /** Best assets for the selected horizon, with positive published values. */
  leaders: PortfolioPlayer[];
  /** Largest expected contributions from season three on. */
  core: PortfolioPlayer[];
  coverage: { total: number; known: number; missing: string[]; zero: number };
  comparisonTeams: number;
  teamCount: number;
  groups: Array<{ group: AssetRecord["g"]; value: number; share: number }>;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Reject malformed payloads instead of drawing plausible zero-filled charts. */
export function parsePortfolioSnapshot(raw: unknown): PortfolioSnapshot | null {
  if (!isObject(raw) || raw.version !== 1 || typeof raw.season !== "string" || !/^\d{4}-\d{2}$/.test(raw.season)) return null;
  if (typeof raw.builtAt !== "string" || !Number.isFinite(Date.parse(raw.builtAt))) return null;
  if (!isObject(raw.players) || !Array.isArray(raw.zero) || !raw.zero.every((id) => typeof id === "string")) return null;
  const sizes = new Set<number>();
  for (const record of Object.values(raw.players)) {
    if (!isObject(record) || typeof record.n !== "string" || !["F", "D", "G"].includes(String(record.g))) return null;
    if (!Array.isArray(record.eG) || record.eG.length < 1 || record.eG.length > 24 || !record.eG.every(finite)) return null;
    if (!isObject(record.dv) || !["winNow", "balanced", "longTerm"].every((m) => finite((record.dv as Record<string, unknown>)[m]))) return null;
    sizes.add(record.eG.length);
  }
  // The published files use one common horizon. A truncated player path is
  // unknown data, not a row of future zeroes.
  if (sizes.size !== 1) return null;
  return raw as unknown as PortfolioSnapshot;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Deduplicate roster ids: a corrupt duplicate must never double an asset. */
const uniqueIds = (ids: readonly string[]) => [...new Set(ids.filter(Boolean))];

export function buildPortfolioOutlook(input: {
  snapshot: PortfolioSnapshot;
  rosters: Readonly<Record<string, readonly string[]>>;
  teamId: string;
  /** Registry team ids; an absent roster must not silently join the median. */
  teamIds: readonly string[];
  mode: AssetHorizon;
}): PortfolioOutlookModel | null {
  const { snapshot, rosters, teamId, mode } = input;
  if (!Object.hasOwn(rosters, teamId)) return null;
  const zeroIds = new Set(snapshot.zero);
  const first = Number(snapshot.season.slice(0, 4));
  const count = Object.values(snapshot.players)[0]?.eG.length ?? 0;
  if (!count || !Number.isFinite(first)) return null;
  const ids = uniqueIds(rosters[teamId]!);
  const known = (id: string) => Object.hasOwn(snapshot.players, id) || zeroIds.has(id);
  const missing = ids.filter((id) => !known(id));
  const teamIds = uniqueIds(input.teamIds);
  const comparable = teamIds
    .filter((id) => Object.hasOwn(rosters, id))
    .map((id) => ({ id, players: uniqueIds(rosters[id]!) }))
    .filter((team) => team.players.length > 0 && team.players.every(known));
  const seasonalGain = (players: readonly string[], season: number) => players.reduce((sum, id) => sum + (snapshot.players[id]?.eG[season] ?? 0), 0);
  const seasons = Array.from({ length: count }, (_, t): PortfolioSeason => {
    const gain = seasonalGain(ids, t);
    const league = comparable.map((team) => seasonalGain(team.players, t));
    return {
      season: first + t,
      label: `${first + t}-${String((first + t + 1) % 100).padStart(2, "0")}`,
      gain,
      median: median(league),
      rank: missing.length || !ids.length || !comparable.some((team) => team.id === teamId) ? null : 1 + league.filter((x) => x > gain + 1e-9).length,
    };
  });
  const players = ids.flatMap((id): PortfolioPlayer[] => {
    const row = snapshot.players[id];
    return row ? [{ id, name: row.n, group: row.g, value: Math.max(0, row.dv[mode]), laterGain: row.eG.slice(2).reduce((sum, x) => sum + Math.max(0, x), 0) }] : [];
  });
  const leaders = players.filter((p) => p.value > 0).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const total = leaders.reduce((sum, p) => sum + p.value, 0);
  const positiveGains = ids.flatMap((id) => snapshot.players[id]?.eG ?? []);
  const allGain = positiveGains.reduce((sum, x) => sum + Math.max(0, x), 0);
  const nearGain = ids.reduce((sum, id) => sum + (snapshot.players[id]?.eG.slice(0, 2).reduce((s, x) => s + Math.max(0, x), 0) ?? 0), 0);
  return {
    seasons,
    total,
    topThreeShare: total > 0 ? leaders.slice(0, 3).reduce((sum, p) => sum + p.value, 0) / total : null,
    nearShare: allGain > 0 ? nearGain / allGain : null,
    leaders: leaders.slice(0, 4),
    core: players.filter((p) => p.laterGain > 0).sort((a, b) => b.laterGain - a.laterGain || b.value - a.value || a.id.localeCompare(b.id)).slice(0, 4),
    coverage: { total: ids.length, known: ids.length - missing.length, missing, zero: ids.filter((id) => !Object.hasOwn(snapshot.players, id) && zeroIds.has(id)).length },
    comparisonTeams: comparable.length,
    teamCount: teamIds.length,
    groups: (["F", "D", "G"] as const).map((group) => {
      const value = players.filter((p) => p.group === group).reduce((sum, p) => sum + p.value, 0);
      return { group, value, share: total > 0 ? value / total : 0 };
    }),
  };
}
