/**
 * Cross-page navigation (board header + footer). The board is English; both
 * destinations are French pages, flagged "(FR)" and marked with hrefLang.
 */
export interface SiteNavLink {
  href: string;
  label: string;
  title: string;
  hrefLang: string;
}

export function siteNavLinks(): SiteNavLink[] {
  return [
    {
      href: "/league",
      label: "Fantrax league helper (FR)",
      title: "Daily Fantrax helper for the Captains Dynasty League (in French)",
      hrefLang: "fr-CA",
    },
    {
      href: "/snake",
      label: "Snake's opinions (FR)",
      title: "Unofficial database of Simon “Snake” Boisvert's podcast opinions (in French)",
      hrefLang: "fr-CA",
    },
  ];
}

/** Accessible name of the nav landmark. */
export function siteNavAriaLabel(): string {
  return "Other tools";
}
