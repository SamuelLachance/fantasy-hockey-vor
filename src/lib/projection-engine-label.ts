/** Human-readable projection engine label (stacked-ensemble → stacked ensemble). */
export function formatProjectionEngine(engine: string): string {
  return engine.replace(/-/g, " ");
}
