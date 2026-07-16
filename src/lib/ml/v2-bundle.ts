/** Serialized v2 model bundle: everything inference needs, no refitting. */

import type { GbdtModel } from "./gbdt";
import type { GpMeta, RidgeV2, StackedMeta } from "./stack";
import type { GoalieStackedMetas, GoalieStructuralParams } from "./goalie-v2";
import type { MarcelParams } from "./marcel";
import type { MarketTrainingConfig } from "./market-training";

export interface V2Bundle {
  trainedAt: string;
  projectionSeasonId: number;
  datasetBuiltAt: string;
  /** Present when models were trained with synthetic-market residual mode. */
  marketTraining?: MarketTrainingConfig;
  skater: {
    gbdt: Record<string, GbdtModel>;
    ridge: Record<string, RidgeV2>;
    marcel: Record<string, MarcelParams>;
    gbdtGp: GbdtModel;
    ridgeGp: RidgeV2;
    rateMetas: Record<string, StackedMeta>;
    gpMeta: GpMeta;
  };
  goalie: {
    gbdt: Record<string, GbdtModel>;
    ridge: Record<string, RidgeV2>;
    structural: GoalieStructuralParams;
    gbdtGp: GbdtModel;
    ridgeGp: RidgeV2;
    metas: GoalieStackedMetas;
    league: {
      svPct: [number, number][];
      saPerGame: [number, number][];
      teamSaPerGame: [string, number][];
      teamGoalieGp: [string, number][];
    };
  };
}
