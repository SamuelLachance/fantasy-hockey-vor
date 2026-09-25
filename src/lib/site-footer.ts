/** Site footer copy (French, every page). */

export const FOOTER_SOURCE_HREF =
  "https://github.com/SamuelLachance/fantasy-hockey-vor" as const;

/** Independence notice. */
export function footerDisclaimerCopy(): string {
  return "Outil non officiel, sans lien avec la LNH, Fantrax, Yahoo ni Simon Boisvert";
}

/** Data sources. */
export function footerSourcesCopy(): string {
  return "Données : API de la LNH, Fantrax (lecture seule), MoneyPuck";
}

/** Visible label for the repository source link. */
export function footerSourceLinkCopy(): string {
  return "Code source (GitHub)";
}

/** Accessible name — visible label plus new-tab warning. */
export function footerSourceLinkAriaLabel(): string {
  return "Code source (GitHub, nouvel onglet)";
}
