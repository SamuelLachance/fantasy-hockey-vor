/** Soft freshness threshold (days) before the amber stale banner. */
export const PROJECTION_STALE_DAYS = 21;

/** Hard freshness threshold (days) before the assertive stale banner. */
export const PROJECTION_VERY_STALE_DAYS = 45;

/** Days between projection generation and build/reference time. */
export function projectionAgeDays(
  generatedAt: string,
  buildTimeIso?: string,
): number {
  const buildMs = Date.parse(buildTimeIso ?? generatedAt);
  const generatedMs = Date.parse(generatedAt);
  if (!Number.isFinite(buildMs) || !Number.isFinite(generatedMs)) return 0;
  return Math.max(0, (buildMs - generatedMs) / (24 * 60 * 60 * 1000));
}

export function isProjectionStale(ageDays: number): boolean {
  return ageDays > PROJECTION_STALE_DAYS;
}

export function isProjectionVeryStale(ageDays: number): boolean {
  return ageDays > PROJECTION_VERY_STALE_DAYS;
}
