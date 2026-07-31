/** Soft freshness threshold (days) before the amber stale banner. */
export const PROJECTION_STALE_DAYS = 21;

/** Hard freshness threshold (days) before the assertive stale banner. */
export const PROJECTION_VERY_STALE_DAYS = 45;

/** Age (days) at/under which the sitemap claims daily changeFrequency. */
export const SITEMAP_DAILY_MAX_AGE_DAYS = 7;

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

/** Sitemap changeFrequency based on projection freshness. */
export function sitemapChangeFrequency(
  ageDays: number,
): "daily" | "weekly" {
  return ageDays <= SITEMAP_DAILY_MAX_AGE_DAYS ? "daily" : "weekly";
}

const SITEMAP_LASTMOD_FALLBACK = "2026-07-22T00:00:00.000Z";

/**
 * Sitemap lastmod: newer of projection generation and build time so UI-only
 * deploys still advance <lastmod> for crawlers.
 */
export function sitemapLastModified(
  generatedAt: string,
  buildTimeIso?: string,
): Date {
  const candidates = [generatedAt, buildTimeIso, SITEMAP_LASTMOD_FALLBACK]
    .map((s) => Date.parse(s ?? ""))
    .filter(Number.isFinite);
  return new Date(Math.max(...candidates));
}
