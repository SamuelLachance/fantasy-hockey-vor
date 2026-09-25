/**
 * Internal paths (pure). `*Path` functions return next/link hrefs (no
 * basePath: next/link adds it); `*Href` functions return plain `<a>` /
 * script / fetch URLs with the basePath. No path ever ends with a slash
 * except the home page: GitHub Pages answers `/x/` with a 404.
 */
import { withBasePath } from "@/lib/site";
import type { LeagueEntry, LeagueTab } from "./registry";

function normSearch(search: string): string {
  if (!search || search === "?") return "";
  return search.startsWith("?") ? search : `?${search}`;
}

/**
 * The home page (« Mes ligues »), for a plain `<a>` only: a next/link to
 * the root route asks Pages for `/fantasy-hockey-vor.txt` (404), then
 * reloads the page anyway.
 */
export function homeHref(): string {
  return withBasePath("/");
}

/** A league tab, for next/link. */
export function leagueTabPath(slug: string, tab: LeagueTab, search = ""): string {
  return `/ligues/${slug}/${tab}${normSearch(search)}`;
}

/** A league tab with the basePath, for plain `<a>` hrefs and scripts. */
export function leagueTabHref(slug: string, tab: LeagueTab, search = ""): string {
  return withBasePath(leagueTabPath(slug, tab, search));
}

/** A player in a league's Joueurs tab (`?joueur=<rowKey>`), for next/link. */
export function leaguePlayerPath(slug: string, rowKey: string): string {
  return leagueTabPath(slug, "joueurs", `?joueur=${encodeURIComponent(rowKey)}`);
}

/** Switching leagues keeps the tab when the other league has it, else its default tab. */
export function switchLeaguePath(tab: LeagueTab | null, target: LeagueEntry, search = ""): string {
  const t = tab && target.tabs.includes(tab) ? tab : target.defaultTab;
  return leagueTabPath(target.slug, t, search);
}

/** The Snake database (or one player's page), for next/link. */
export function snakePath(key?: string): string {
  return key ? `/snake?p=${encodeURIComponent(key)}` : "/snake";
}
