/**
 * The global navigation (every page): « Accueil », one item per league of
 * the registry (to its default tab), « Snake ». Pure; the header component
 * marks the active item with `aria-current="page"`.
 */
import { LEAGUES, type LeagueEntry } from "@/lib/leagues/registry";
import { homeHref, leagueTabPath, snakePath } from "@/lib/leagues/routes";

export interface NavItem {
  key: string;
  label: string;
  /**
   * "document": a plain `<a>` whose href already carries the basePath (the
   * home page: a next/link to the root route 404s its payload on Pages).
   * "link": a next/link href without basePath.
   */
  kind: "document" | "link";
  href: string;
  /** Small platform tag after the label (« Fantrax », « Yahoo »). */
  tag?: string;
  /** Tooltip and full meaning. */
  title: string;
  /** The league an item stands for (its tabs and old addresses are "inside" it). */
  league?: LeagueEntry;
}

/** Accessible name of the nav landmark. */
export const SITE_NAV_LABEL = "Navigation principale";

export function navItems(): NavItem[] {
  return [
    { key: "accueil", label: "Accueil", kind: "document", href: homeHref(), title: "Mes ligues : le résumé de chaque ligue" },
    ...LEAGUES.map(
      (l): NavItem => ({
        key: l.slug,
        label: l.shortName,
        kind: "link",
        href: leagueTabPath(l.slug, l.defaultTab),
        tag: l.platform,
        title: `${l.name} (${l.platform})`,
        league: l,
      }),
    ),
    { key: "snake", label: "Snake", kind: "link", href: snakePath(), title: "Les opinions de Snake (base non officielle)" },
  ];
}

/** Whether `pathname` (from usePathname, without basePath) belongs to `item`. Unknown paths match nothing. */
export function isNavActive(pathname: string | null | undefined, item: NavItem): boolean {
  if (!pathname) return false;
  if (item.key === "accueil") return pathname === "/";
  if (item.key === "snake") return pathname === "/snake";
  const l = item.league;
  if (!l) return false;
  return pathname.startsWith(`/ligues/${l.slug}/`) || l.legacyPaths.some((p) => p.path === pathname);
}

/**
 * `aria-current` of a nav item: "page" when its link is the page on screen,
 * "true" when the page is only inside it (another tab of that league, an
 * old address), else none.
 */
export function navCurrent(pathname: string | null | undefined, item: NavItem): "page" | "true" | undefined {
  if (!isNavActive(pathname, item)) return undefined;
  if (item.kind === "document") return "page";
  return pathname === item.href ? "page" : "true";
}
