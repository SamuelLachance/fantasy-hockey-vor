/**
 * A pool row's season points as the player table shows them
 * (`FantraxRow.fp`), apart from table.ts so the « Actifs » tab can break
 * asset-score ties the same way without loading the table's code.
 */
import type { FantraxLeagueConfig } from "./config";
import { seasonFp } from "./draft-inputs";
import type { PoolSnapshot } from "./pool";
import type { ValuesSnapshot } from "./snapshot-types";

/**
 * A projected row's season total follows the league's config (its season
 * length: Slapshot's fantasy season ends in February), not the pool's bake.
 */
export function poolRowSeasonFp(
  r: Pick<PoolSnapshot["players"][number], "fp">,
  rec: ValuesSnapshot["players"][string] | undefined,
  config: FantraxLeagueConfig,
): number | null {
  return r.fp == null ? null : rec?.src === "proj" ? Math.round(seasonFp(rec, config) * 10) / 10 : r.fp;
}

/** Season points by Fantrax id (`poolRowSeasonFp`): the asset score's tie-break outside the table. */
export function poolSeasonFp(
  pool: Pick<PoolSnapshot, "players">,
  values: Pick<ValuesSnapshot, "players"> | null,
  config: FantraxLeagueConfig,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const r of pool.players) out[r.id] = poolRowSeasonFp(r, values?.players[r.id], config);
  return out;
}
