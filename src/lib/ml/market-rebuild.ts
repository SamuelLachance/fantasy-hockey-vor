/**
 * Rebuild of the v2 synthetic-market per-game rate (0.5 Marcel + 0.3 EWMA +
 * 0.2 lag-1, era-adjusted, the bundle's Marcel parameters: exactly what
 * `inferBaseSignalsForPlayer` blends) from committed inputs only, without the
 * gitignored dataset.json:
 *  - player-profiles.json for the last three seasons (every stat);
 *  - MoneyPuck for older seasons: games and goals exact, the other stats at
 *    the player's per-game average of the profile seasons (they only enter
 *    Marcel's fourth, lightest season).
 *
 * `rates:recalibrate` uses it once per legacy board, to recover the raw model
 * rate (market + edge) of the cells the old rate caps clipped and to replace
 * the market inputs the 2026-07-30 dataset got wrong. It reproduces the
 * market of the healthy 2026-07-21 board (5291e33) to ~0.005 per game
 * (median, every stat: the rounding noise of the published totals) for the
 * players whose history is all in the profiles or who have 100+ profile
 * games; `profileGames` / `olderSeasonGames` say which (isReliableRebuild).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { PROJECTION_SEASON_ID } from "../nhl-api";
import { loadMoneyPuckSkaterRegistrySync } from "../moneypuck-skaters";
import type { PlayerProfile } from "../profile-types";
import type { SkaterCategory } from "../types";
import { buildTargetLevels, eligibleHistory, eraFactor } from "./dataset-view";
import { loadContextCaches } from "./enrich-rows";
import { sanitizeTargetSeasonRow } from "./features";
import { buildProjectionTargetRow, profileToSeasonRows } from "./inference-context";
import { marketRate } from "./market-training";
import { V2_SKATER_TARGETS } from "./stack";
import type { PlayerSeasonRow } from "./types";
import type { V2Bundle } from "./v2-bundle";

const BUNDLE_PATH = join(process.cwd(), "src", "data", "ml", "v2-bundle.json");

type Rates = Partial<Record<SkaterCategory, number>>;

export interface MarketRebuild {
  /** Synthetic-market per-game rates. */
  rates: Rates;
  /** Games in the profile's own seasons of 10+ games (every stat exact). */
  profileGames: number;
  /** Games of older seasons taken from MoneyPuck (non-goal stats averaged). */
  olderSeasonGames: number;
}

/**
 * Returns a lookup id → market rebuild, or null for a player without an
 * eligible NHL season in the profiles.
 */
export function buildMarketRebuilder(
  profiles: PlayerProfile[],
): (id: number) => MarketRebuild | null {
  const bundle = JSON.parse(readFileSync(BUNDLE_PATH, "utf8")) as V2Bundle;
  const caches = loadContextCaches();
  const mp = loadMoneyPuckSkaterRegistrySync();
  const mpByPlayer = new Map<number, Array<{ seasonId: number; gamesPlayed: number; goals: number }>>();
  for (const r of Object.values(mp?.byKey ?? {})) {
    const list = mpByPlayer.get(r.playerId) ?? [];
    list.push({ seasonId: r.seasonId, gamesPlayed: r.gamesPlayed, goals: r.goals });
    mpByPlayer.set(r.playerId, list);
  }

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const historyById = new Map<number, PlayerSeasonRow[]>();
  const coverage = new Map<number, { profileGames: number; olderSeasonGames: number }>();
  const levelRows: PlayerSeasonRow[] = [];
  for (const p of profiles) {
    if (p.isGoalie) continue;
    const rows = profileToSeasonRows(p, caches).filter(
      (r) => !r.isGoalie && r.seasonId < PROJECTION_SEASON_ID,
    );
    if (rows.length === 0) continue;
    levelRows.push(...rows);
    const firstProfileSeason = Math.min(...rows.map((r) => r.seasonId));
    let gp = 0;
    const sums: Record<string, number> = {};
    for (const r of rows) {
      gp += r.gamesPlayed;
      for (const t of V2_SKATER_TARGETS) {
        sums[t] = (sums[t] ?? 0) + ((r as unknown as Record<string, number>)[t] ?? 0);
      }
    }
    const older: PlayerSeasonRow[] = [];
    for (const m of mpByPlayer.get(p.id) ?? []) {
      if (m.seasonId >= firstProfileSeason) continue;
      const row = { ...rows[0], seasonId: m.seasonId, gamesPlayed: m.gamesPlayed } as PlayerSeasonRow;
      for (const t of V2_SKATER_TARGETS) {
        (row as unknown as Record<string, number>)[t] = gp > 0 ? ((sums[t] ?? 0) / gp) * m.gamesPlayed : 0;
      }
      row.goals = m.goals;
      older.push(row);
    }
    historyById.set(
      p.id,
      [...older, ...rows].sort((a, b) => a.seasonId - b.seasonId),
    );
    coverage.set(p.id, {
      profileGames: rows
        .filter((r) => r.gamesPlayed >= 10)
        .reduce((sum, r) => sum + r.gamesPlayed, 0),
      olderSeasonGames: older.reduce((sum, r) => sum + r.gamesPlayed, 0),
    });
  }
  // League levels from the real profile rows only (same as the history era).
  const levels = buildTargetLevels(levelRows, V2_SKATER_TARGETS, false);

  return (id: number): MarketRebuild | null => {
    const profile = profileById.get(id);
    const history = historyById.get(id);
    if (!profile || !history) return null;
    const eligible = eligibleHistory(history);
    if (eligible.length === 0) return null;
    const target = sanitizeTargetSeasonRow(
      buildProjectionTargetRow(profile, caches),
      levelRows,
    );
    const out: Rates = {};
    for (const t of V2_SKATER_TARGETS) {
      const params = bundle.skater.marcel[t];
      if (!params) continue;
      const era = eraFactor(levels[t], eligible, target.seasonId);
      out[t as SkaterCategory] = marketRate(history, target, t, params, era);
    }
    return { rates: out, ...(coverage.get(id) ?? { profileGames: 0, olderSeasonGames: 0 }) };
  };
}
