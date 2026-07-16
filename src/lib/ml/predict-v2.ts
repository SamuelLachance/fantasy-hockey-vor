/**
 * Production inference for the v2 stacked projection system.
 *
 * History comes from the ML dataset (regular-season rows, MoneyPuck-enriched,
 * bio/team-context enriched) rather than the profile's mixed-provenance
 * team history, so inference features match training exactly.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { PROJECTION_SEASON_ID } from "../nhl-api";
import type { PlayerProfile } from "../profile-types";
import type { GoalieProjection, SkaterProjection } from "../types";
import { contextualPerGameRateFromRows } from "./contextual-baseline";
import {
  buildLeagueContext,
  buildTargetLevels,
  eligibleHistory,
  type LeagueContext,
} from "./dataset-view";
import { sanitizeTargetSeasonRow } from "./features";
import { attachDurability } from "./gamelog-durability";
import {
  buildGoalieLeagueContext,
  buildGoalieLevels,
  inferGoalieForPlayer,
  type GoalieLeagueContext,
  type GoalieLevels,
} from "./goalie-v2";
import { buildProjectionTargetRow } from "./inference-context";
import { loadContextCaches } from "./enrich-rows";
import {
  inferBaseSignalsForPlayer,
  metaGpPrediction,
  metaRatePrediction,
  V2_SKATER_TARGETS,
  type BoundaryModels,
} from "./stack";
import type { MlDataset, PlayerSeasonRow } from "./types";
import type { V2Bundle } from "./v2-bundle";
import {
  loadMoneyPuckRegistrySync,
  type MoneyPuckGoalieRegistry,
} from "../moneypuck-goalies";

const BUNDLE_PATH = join(process.cwd(), "src", "data", "ml", "v2-bundle.json");
const DATASET_PATH = join(process.cwd(), "src", "data", "ml", "dataset.json");

interface V2Runtime {
  bundle: V2Bundle;
  rows: PlayerSeasonRow[];
  byPlayer: Map<number, PlayerSeasonRow[]>;
  league: LeagueContext;
  goalieLeague: GoalieLeagueContext;
  registry: MoneyPuckGoalieRegistry | null;
  caches: ReturnType<typeof loadContextCaches>;
  skaterLevels: Record<string, Record<number, number>>;
  goalieLevels: GoalieLevels;
}

let runtimeCache: V2Runtime | null | undefined;

export function getV2Runtime(): V2Runtime | null {
  if (runtimeCache !== undefined) return runtimeCache;
  if (!existsSync(BUNDLE_PATH) || !existsSync(DATASET_PATH)) {
    runtimeCache = null;
    return null;
  }
  try {
    const bundle = JSON.parse(readFileSync(BUNDLE_PATH, "utf8")) as V2Bundle;
    const dataset = JSON.parse(readFileSync(DATASET_PATH, "utf8")) as MlDataset;
    const rows = dataset.rows;
    attachDurability(rows);
    const byPlayer = new Map<number, PlayerSeasonRow[]>();
    for (const row of rows) {
      const list = byPlayer.get(row.playerId) ?? [];
      list.push(row);
      byPlayer.set(row.playerId, list);
    }
    for (const list of byPlayer.values()) list.sort((a, b) => a.seasonId - b.seasonId);
    runtimeCache = {
      bundle,
      rows,
      byPlayer,
      league: buildLeagueContext(rows),
      goalieLeague: buildGoalieLeagueContext(rows),
      registry: loadMoneyPuckRegistrySync(),
      caches: loadContextCaches(),
      skaterLevels: buildTargetLevels(rows, V2_SKATER_TARGETS, false),
      goalieLevels: buildGoalieLevels(rows),
    };
  } catch (e) {
    console.warn(`v2 runtime unavailable: ${e instanceof Error ? e.message : e}`);
    runtimeCache = null;
  }
  return runtimeCache;
}

function skaterModelsFromBundle(bundle: V2Bundle): BoundaryModels {
  return {
    boundarySeason: bundle.projectionSeasonId,
    gbdt: bundle.skater.gbdt,
    ridge: bundle.skater.ridge,
    marcel: bundle.skater.marcel,
    gbdtGp: bundle.skater.gbdtGp,
    ridgeGp: bundle.skater.ridgeGp,
  };
}

export interface V2SkaterResult {
  gamesPlayed: number;
  projection: SkaterProjection;
  reasoning: string;
  /** Per-stat model rate minus synthetic market rate (per game). */
  marketEdge?: Partial<Record<string, number>>;
}

export function projectSkaterV2(profile: PlayerProfile): V2SkaterResult | null {
  const rt = getV2Runtime();
  if (!rt) return null;

  const history = (rt.byPlayer.get(profile.id) ?? []).filter(
    (r) => !r.isGoalie && r.seasonId < PROJECTION_SEASON_ID,
  );
  const eligible = eligibleHistory(history);
  if (eligible.length === 0) return null;

  // Target row with current team, next-season age, prev-season team context.
  const target = sanitizeTargetSeasonRow(
    buildProjectionTargetRow(profile, rt.caches),
    rt.rows,
  );

  const contextualRates: Record<string, number> = {};
  for (const t of V2_SKATER_TARGETS) {
    contextualRates[t] = contextualPerGameRateFromRows(history, target, t);
  }

  const models = skaterModelsFromBundle(rt.bundle);
  const { rates, gp } = inferBaseSignalsForPlayer(
    models,
    {
      history,
      targetRow: target,
      league: rt.league,
      levels: rt.skaterLevels,
      residualModels: Boolean(rt.bundle.marketTraining),
    },
    contextualRates,
  );

  const young = eligible.length <= 2;
  const gpSignals = {
    gbdt: Float64Array.of(gp.gbdt),
    ridge: Float64Array.of(gp.ridge),
    ewma: Float64Array.of(gp.ewma),
    lag1: Float64Array.of(gp.lag1),
    durability: Float64Array.of(gp.durability),
  };
  const gamesPlayed = Math.round(
    metaGpPrediction(rt.bundle.skater.gpMeta, gpSignals, 0, young),
  );

  const marketEdge: Partial<Record<string, number>> = {};
  const perGame: Record<string, number> = {};
  for (const t of V2_SKATER_TARGETS) {
    const sig = rates[t];
    const sigArrays = {
      gbdt: Float64Array.of(sig.gbdt),
      ridge: Float64Array.of(sig.ridge),
      marcel: Float64Array.of(sig.marcel),
      ewma: Float64Array.of(sig.ewma),
      lag1: Float64Array.of(sig.lag1),
      contextual: Float64Array.of(sig.contextual),
      component: Float64Array.of(sig.component),
      market: Float64Array.of(sig.market ?? sig.marcel),
    };
    perGame[t] = metaRatePrediction(
      rt.bundle.skater.rateMetas[t],
      sigArrays,
      0,
      young,
      profile.position === "D",
    );
    marketEdge[t] = perGame[t] - (sig.market ?? sig.marcel);
  }

  const total = (t: string): number => Math.max(0, Math.round(perGame[t] * gamesPlayed));

  const projection: SkaterProjection = {
    goals: total("goals"),
    assists: total("assists"),
    shots: total("shots"),
    blocks: total("blocks"),
    hits: total("hits"),
    powerplayPoints: total("powerplayPoints"),
    penaltyMinutes: total("penaltyMinutes"),
    faceoffWins: profile.position === "C" ? total("faceoffWins") : Math.min(total("faceoffWins"), 250),
  };

  return {
    gamesPlayed,
    projection,
    marketEdge,
    reasoning: `v2 stacked ensemble (GBDT+ridge+Marcel+EB${rt.bundle.marketTraining ? "+market-residual" : ""}, ${eligible.length} NHL seasons${young ? ", young segment" : ""}). Trained ${rt.bundle.trainedAt.slice(0, 10)}.`,
  };
}

export interface V2GoalieResult {
  gamesPlayed: number;
  projection: GoalieProjection;
  reasoning: string;
}

export function projectGoalieV2(profile: PlayerProfile): V2GoalieResult | null {
  const rt = getV2Runtime();
  if (!rt) return null;

  const history = (rt.byPlayer.get(profile.id) ?? []).filter(
    (r) => r.isGoalie && r.seasonId < PROJECTION_SEASON_ID,
  );
  if (history.length === 0) return null;

  const target = sanitizeTargetSeasonRow(
    buildProjectionTargetRow(profile, rt.caches),
    rt.rows,
  );

  const result = inferGoalieForPlayer(
    {
      gbdt: rt.bundle.goalie.gbdt,
      ridge: rt.bundle.goalie.ridge,
      structural: rt.bundle.goalie.structural,
      gbdtGp: rt.bundle.goalie.gbdtGp,
      ridgeGp: rt.bundle.goalie.ridgeGp,
    },
    rt.bundle.goalie.metas,
    history,
    target,
    rt.goalieLeague,
    rt.registry,
    rt.goalieLevels,
  );
  if (!result) return null;

  const gamesPlayed = Math.round(result.gamesPlayed);
  const projection: GoalieProjection = {
    wins: Math.max(0, Math.round(result.rates.wins * gamesPlayed)),
    saves: Math.max(0, Math.round(result.rates.saves * gamesPlayed)),
    shutouts: Math.max(0, Math.round(result.rates.shutouts * gamesPlayed)),
    savePct: Math.round(result.rates.savePct * 1000) / 1000,
  };

  return {
    gamesPlayed,
    projection,
    reasoning: `v2 goalie ensemble (GBDT+ridge+EB save%+GSAx+structural wins). Trained ${rt.bundle.trainedAt.slice(0, 10)}.`,
  };
}
