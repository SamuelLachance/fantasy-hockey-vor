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

/** Lazy-loaded expand payload path. */
export function playerDetailsHref(): string {
  return withBasePath("/player-details.json");
}
