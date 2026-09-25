import { SITE_BRAND } from "@/lib/site";

/** Root title template: every page title is « <page> | Fantasy Hockey VOR ». */
export const SITE_TITLE_TEMPLATE = `%s | ${SITE_BRAND}`;

/** Default document / OG title (pages without their own). */
export function siteDefaultTitle(): string {
  return SITE_BRAND;
}

/** The home page title (`title.absolute`: the root template does not apply to the root page). */
export function siteHomeTitle(): string {
  return `Mes ligues | ${SITE_BRAND}`;
}

/** Short meta description of the site. */
export function siteDefaultDescription(): string {
  return "Outil non officiel pour mes ligues de hockey fantasy : alignements et repêchage Fantrax (Captains Dynasty), repêchage Yahoo (Light the Lamp), joueurs et opinions de Snake.";
}

/** Compact PWA / manifest blurb. */
export function siteManifestDescription(): string {
  return "Mes ligues de hockey fantasy : alignements, repêchages, joueurs.";
}
