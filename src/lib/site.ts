/** Canonical production origin (GitHub Pages). */
export const SITE_ORIGIN =
  "https://samuellachance.github.io/fantasy-hockey-vor";

export const SITE_URL = `${SITE_ORIGIN}/`;

/** In-app path to the rankings board (respects GitHub Pages basePath). */
export function homeRankingsHref(): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/#rankings`.replace(
    /\/{2,}/g,
    "/",
  );
}
