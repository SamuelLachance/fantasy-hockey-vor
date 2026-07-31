/** Canonical production origin (GitHub Pages). */
export const SITE_ORIGIN =
  "https://samuellachance.github.io/fantasy-hockey-vor";

export const SITE_URL = `${SITE_ORIGIN}/`;

function withBasePath(suffix: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${suffix}`.replace(
    /\/{2,}/g,
    "/",
  );
}

/** In-app path to the rankings board (respects GitHub Pages basePath). */
export function homeRankingsHref(): string {
  return withBasePath("/#rankings");
}

/** Lazy-loaded expand payload path (build-time cache buster when available). */
export function playerDetailsHref(): string {
  const path = withBasePath("/player-details.json");
  const v = process.env.NEXT_PUBLIC_BUILD_TIME?.trim();
  if (!v) return path;
  return `${path}?v=${encodeURIComponent(v)}`;
}
