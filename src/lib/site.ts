/** Canonical production origin (GitHub Pages). */
export const SITE_ORIGIN =
  "https://samuellachance.github.io/fantasy-hockey-vor";

export const SITE_URL = `${SITE_ORIGIN}/`;

/** Product / brand display name (titles, OG, eyebrow). A proper noun, kept in French pages. */
export const SITE_BRAND = "Fantasy Hockey VOR";

/** Compact PWA short name. */
export const SITE_SHORT_NAME = "VOR Hockey";

/**
 * `suffix` under the GitHub Pages basePath, for plain `<a>` hrefs, inline
 * scripts and fetch URLs (next/link adds the basePath itself: never pass
 * its hrefs through this).
 */
export function withBasePath(suffix: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${suffix}`.replace(
    /\/{2,}/g,
    "/",
  );
}

/**
 * Baked Fantrax snapshot file under `public/fantrax/` (basePath +
 * build-time cache buster: Pages serves every file with max-age=600).
 * `file` is what the league publishes: a bare name for the Captains league,
 * `<slug>/<name>` for another one — see `fantraxPublicFile` in
 * `src/lib/fantrax/config.ts`.
 */
export function fantraxDataHref(file: string): string {
  return withBuildVersion(withBasePath(`/fantrax/${file}`));
}

/** A categories league's file under `public/leagues/<slug>/` (basePath + the same cache buster). */
export function leagueDataHref(slug: string, file: string): string {
  return withBuildVersion(withBasePath(`/leagues/${slug}/${file}`));
}

function withBuildVersion(path: string): string {
  const v = process.env.NEXT_PUBLIC_BUILD_TIME?.trim();
  if (!v) return path;
  return `${path}?v=${encodeURIComponent(v)}`;
}

