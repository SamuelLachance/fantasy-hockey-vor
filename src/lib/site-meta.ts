import { PROJECTION_SEASON } from "@/lib/nhl-api";
import { SITE_BRAND } from "@/lib/site";

/** Default document / OG title for the rankings app. */
export function siteDefaultTitle(season = PROJECTION_SEASON): string {
  return `${SITE_BRAND} | ${season} ML Rankings`;
}

/** Short meta description pinned to the projection season. */
export function siteDefaultDescription(season = PROJECTION_SEASON): string {
  return `${season} NHL fantasy hockey Value Over Replacement rankings from a stacked ML ensemble (GBDT + ridge + Marcel), with draft Edge vs synthetic consensus and calibrated uncertainty.`;
}

/** Compact PWA / manifest blurb. */
export function siteManifestDescription(season = PROJECTION_SEASON): string {
  return `${season} NHL fantasy hockey VOR rankings from a stacked ML ensemble.`;
}

/** Dataset JSON-LD description (distinct from the long page meta). */
export function siteDatasetDescription(season = PROJECTION_SEASON): string {
  return `${season} player VOR rankings with draft Edge and calibrated uncertainty for H2H category leagues.`;
}
