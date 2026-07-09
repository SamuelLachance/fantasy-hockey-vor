import { predictGbm } from "./gbm";
import { inverseTransformTarget, predictRidge } from "./ridge";
import type { GbmModel, RidgeModel, StatModel } from "./types";
import { isGbmModel } from "./types";

export function predictStatModel(model: StatModel, features: number[]): number {
  let raw: number;
  if (isGbmModel(model)) {
    raw = inverseTransformTarget(
      predictGbm(model, features),
      model.logTarget ?? false,
    );
  } else {
    raw = predictRidge(model, features);
  }
  return Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

export function asRidgeModel(model: StatModel | undefined): RidgeModel | undefined {
  if (!model || isGbmModel(model)) return undefined;
  return model;
}

export function asGbmModel(model: StatModel | undefined): GbmModel | undefined {
  if (!model || !isGbmModel(model)) return undefined;
  return model;
}
