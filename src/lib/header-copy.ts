import { SITE_BRAND } from "@/lib/site";

/** Skip-link visible on keyboard focus. */
export function skipToRankingsCopy(): string {
  return "Skip to rankings";
}

/** Uppercase eyebrow above the hero H1. */
export function headerEyebrowCopy(): string {
  return "Value Over Replacement";
}

/** Hero H1 — brand mark. */
export function headerHeroTitle(): string {
  return SITE_BRAND;
}

/** Supporting paragraph under the hero title. */
export function headerLeadCopy(season: string): string {
  return (
    `${season} projections from a stacked ML ensemble — gradient ` +
    "boosting, ridge and Marcel models blended per stat, with game-log " +
    "durability, xG and team context — ranked by VOR. Edge is consensus " +
    "rank minus model rank (undervalued when positive); expand a row " +
    "for per-stat ±1σ uncertainty."
  );
}

/** Primary hero CTA. */
export function headerJumpCtaCopy(): string {
  return "Jump to board";
}

/** Tooltip / accessible hint for the hero jump CTA (also focuses search). */
export function headerJumpCtaTitle(): string {
  return "Jump to board + focus search";
}
