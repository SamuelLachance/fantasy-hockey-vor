import type { PlayerProfile } from "../profile-types";
import {
  projectGoalieFromProfile,
  projectSkaterFromProfile,
} from "../contextual-projections";
import {
  anchorSkaterProjectionToHistory,
  clampSkaterProjection,
} from "../projection-sanity";
import { projectedGamesFromProfile, type GoalieRole } from "../projection-gp";
import type { GoalieProjection, SkaterProjection } from "../types";
import {
  buildSkaterGpInferenceFeatures,
  buildTargetInferenceFeatures,
  extractEwmaFeature,
  extractLag1Feature,
} from "./features";
import { loadContextCaches } from "./enrich-rows";
import {
  buildProjectionTargetRow,
  profileToSeasonRows,
} from "./inference-context";
import { applyBlendWeights, predictRidge } from "./ridge";
import type { MlModelBundle, PlayerSeasonRow, RidgeModel } from "./types";
import { SKATER_ML_TARGETS } from "./types";
import { loadMlModels } from "./train";

const EWMA_WEIGHTS = [0.15, 0.3, 0.55];
const CONTEXTUAL_BASELINE_R2 = 0.55;

function ewmaPerGameRate(
  history: PlayerSeasonRow[],
  stat: (row: PlayerSeasonRow) => number,
): number {
  const eligible = history.filter((h) => h.gamesPlayed >= 10).slice(-3);
  if (eligible.length === 0) return 0;
  const weights = EWMA_WEIGHTS.slice(-eligible.length);
  const totalW = weights.reduce((a, b) => a + b, 0);
  return eligible.reduce((sum, row, i) => {
    const rate = row.gamesPlayed > 0 ? stat(row) / row.gamesPlayed : 0;
    return sum + rate * (weights[i] / totalW);
  }, 0);
}

function careerRate(profile: PlayerProfile, field: string): number {
  const gp = profile.careerTotals.gamesPlayed ?? 0;
  if (gp < 5) return 0;
  return Number(profile.careerTotals[field] ?? 0) / gp;
}

function anchorPerGameRate(
  target: string,
  ewma: number,
  ml: number,
  profile: PlayerProfile,
): number {
  const career = careerRate(
    profile,
    target === "powerplayPoints"
      ? "powerPlayPoints"
      : target === "penaltyMinutes"
        ? "pim"
        : target,
  );

  if (ewma > 0) {
    return Math.max(0, ewma * 0.82 + ml * 0.18);
  }

  if (career > 0) {
    return Math.min(ml, career * 1.2);
  }

  if (target === "goals") {
    return profile.position === "D" ? 0.03 : 0.08;
  }
  if (target === "powerplayPoints") {
    return 0;
  }

  return Math.min(ml, ewma);
}

function rowStat(row: PlayerSeasonRow, target: string): number {
  return (row as unknown as Record<string, number>)[target] ?? 0;
}

function resolveSkaterModel(
  models: MlModelBundle,
  target: string,
  position: PlayerProfile["position"],
): RidgeModel | undefined {
  const group = position === "D" ? "D" : "F";
  const candidates = models.skaterModels.filter((m) => m.target === target);
  return (
    candidates.find((m) => m.positionGroup === group) ??
    candidates.find((m) => !m.positionGroup || m.positionGroup === "all")
  );
}

function mlWeightForTarget(models: MlModelBundle, target: string): number {
  const r2 = models.metrics.skater[target]?.r2 ?? 0.5;
  const mlW = Math.max(0.35, Math.min(0.92, r2));
  const contextualW = Math.max(0.08, CONTEXTUAL_BASELINE_R2);
  return mlW / (mlW + contextualW);
}

function contextualPerGameRates(
  profile: PlayerProfile,
): Record<string, number> {
  const contextual = projectSkaterFromProfile(profile);
  const gp = Math.max(1, contextual.gamesPlayed);
  const p = contextual.projection;
  return {
    goals: p.goals / gp,
    assists: p.assists / gp,
    shots: p.shots / gp,
    blocks: p.blocks / gp,
    hits: p.hits / gp,
    powerplayPoints: p.powerplayPoints / gp,
    penaltyMinutes: p.penaltyMinutes / gp,
    faceoffWins: p.faceoffWins / gp,
  };
}

function predictSkaterGp(
  profile: PlayerProfile,
  models: MlModelBundle,
  history: PlayerSeasonRow[],
  targetRow: PlayerSeasonRow,
): number | null {
  if (!models.skaterGpModel) return null;
  const { features } = buildSkaterGpInferenceFeatures(history, targetRow);
  const gp = predictRidge(models.skaterGpModel, features);
  return Math.max(10, Math.min(82, Math.round(gp)));
}

export function projectSkaterWithMl(
  profile: PlayerProfile,
  models: MlModelBundle,
  blendContextual = true,
): { projection: SkaterProjection; gamesPlayed: number; reasoning: string } {
  const caches = loadContextCaches();
  const history = profileToSeasonRows(profile, caches).filter((r) => !r.isGoalie);
  const targetRow = buildProjectionTargetRow(profile, caches);
  const mlGp = predictSkaterGp(profile, models, history, targetRow);
  const gamesPlayed = projectedGamesFromProfile(profile, undefined, mlGp);

  const contextualRates = blendContextual
    ? contextualPerGameRates(profile)
    : null;

  const rates: Record<string, number> = {};
  for (const target of SKATER_ML_TARGETS) {
    const model = resolveSkaterModel(models, target, profile.position);
    if (!model) continue;
    const { features, featureNames } = buildTargetInferenceFeatures(
      history,
      target,
      false,
      targetRow,
    );
    const ml = Math.max(0, predictRidge(model, features));
    const ewma = extractEwmaFeature(featureNames, features, target);
    const lag1 = extractLag1Feature(featureNames, features, target);
    const historyEwma = ewmaPerGameRate(history, (r) => rowStat(r, target));
    const ewmaRate = ewma > 0 ? ewma : historyEwma;

    let mlRate: number;
    if (model.blendWeights) {
      const [blended] = applyBlendWeights([ml], [ewmaRate], [lag1], model.blendWeights);
      mlRate = blended;
    } else {
      const blendW = model.ewmaBlendWeight ?? 0.85;
      if (ewmaRate > 0) {
        mlRate = Math.max(0, ewmaRate * blendW + ml * (1 - blendW));
      } else {
        mlRate = anchorPerGameRate(target, historyEwma, ml, profile);
      }
    }

    if (contextualRates && (target !== "faceoffWins" || profile.position === "C")) {
      const ctxRate = contextualRates[target] ?? mlRate;
      const w = blendContextual ? mlWeightForTarget(models, target) : 1;
      rates[target] = mlRate * w + ctxRate * (1 - w);
    } else if (target === "faceoffWins" && profile.position !== "C") {
      rates[target] = 0;
    } else {
      rates[target] = mlRate;
    }
  }

  const raw = clampSkaterProjection(
    {
      goals: Math.round(rates.goals * gamesPlayed),
      assists: Math.round(rates.assists * gamesPlayed),
      shots: Math.round(rates.shots * gamesPlayed),
      blocks: Math.round(rates.blocks * gamesPlayed),
      hits: Math.round(rates.hits * gamesPlayed),
      powerplayPoints: Math.round(rates.powerplayPoints * gamesPlayed),
      penaltyMinutes: Math.round(rates.penaltyMinutes * gamesPlayed),
      faceoffWins: Math.round(rates.faceoffWins * gamesPlayed),
    },
    gamesPlayed,
    profile.position,
  );

  const projection = anchorSkaterProjectionToHistory(profile, raw, gamesPlayed);

  const gpNote = mlGp != null ? `injury+ML GP (${mlGp})` : "injury-profile GP";

  return {
    projection,
    gamesPlayed,
    reasoning: `ML+contextual ensemble (holdout-R² weights) + ${gpNote}; EB-anchored PIM/hits/blocks`,
  };
}

export function projectGoalieWithMl(
  profile: PlayerProfile,
  _models: MlModelBundle,
  goalieRoleMap?: Map<number, GoalieRole>,
): { projection: GoalieProjection; gamesPlayed: number; reasoning: string } {
  const result = projectGoalieFromProfile(profile, goalieRoleMap);
  return {
    ...result,
    reasoning: `Goalie MoneyPuck GSAx + team SV% environment (ridge ML not used); ${result.reasoning}`,
  };
}

export function getMlModels(): MlModelBundle | null {
  return loadMlModels();
}
