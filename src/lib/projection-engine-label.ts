/** Human-readable projection engine label (stacked-ensemble → stacked ensemble). */
export function formatProjectionEngine(engine: string): string {
  return engine.replace(/-/g, " ");
}

/** Fallback when a dataset omits projectionEngine (publish always sets stacked-ensemble). */
export const DEFAULT_PROJECTION_ENGINE = "stacked-ensemble";
