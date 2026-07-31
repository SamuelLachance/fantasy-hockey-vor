import { replacementRank } from "@/lib/league";
import type { LeagueSettings } from "@/lib/types";

/** Section heading for the How VOR Works panel. */
export function howVorSectionTitleCopy(): string {
  return "How VOR Works";
}

/** Card title for the category z-score explainer. */
export function howVorZScoreTitleCopy(): string {
  return "Category Z-Scores";
}

/** Card title for the replacement-level explainer. */
export function howVorReplacementTitleCopy(): string {
  return "Replacement Level";
}

/** Card title for the Yahoo eligibility explainer. */
export function howVorYahooPositionsTitleCopy(): string {
  return "Yahoo Positions";
}

/** Category z-score explainer body. */
export function howVorZScoreCopy(): string {
  return (
    "Each stat is converted to a z-score against the draftable pool, " +
    "multiplied by a bounded scarcity weight and summed for total fantasy value. " +
    "Goalie SV% is volume-weighted, and goalie value is discounted for weekly H2H " +
    "volatility and streamability."
  );
}

/** Replacement-level explainer with live roster ranks. */
export function howVorReplacementCopy(
  teams: number,
  roster: LeagueSettings["roster"],
): string {
  return (
    `Based on a ${teams}-team league: C/LW/RW rank ` +
    `${replacementRank("C", teams, roster)}, D rank ` +
    `${replacementRank("D", teams, roster)}, G rank ` +
    `${replacementRank("G", teams, roster)} at each position.`
  );
}

/** Yahoo multi-position eligibility explainer. */
export function howVorYahooPositionsCopy(): string {
  return (
    "VOR uses Yahoo Fantasy eligibility. Multi-position players get VOR at their " +
    "best eligible slot; position filters show VOR at that position."
  );
}

/** Scarcity weights panel title (covers skaters and goalies). */
export function howVorScarcityTitleCopy(): string {
  return "Category scarcity weights";
}

/** Label above skater scarcity weight chips. */
export function howVorScarcitySkatersLabel(): string {
  return "Skaters";
}

/** Label above goalie scarcity weight chips. */
export function howVorScarcityGoaliesLabel(): string {
  return "Goalies";
}

/** Scarcity weights panel blurb. */
export function howVorScarcityHintCopy(): string {
  return "Higher weight = harder to generate vs replacement; counts more toward VOR.";
}
