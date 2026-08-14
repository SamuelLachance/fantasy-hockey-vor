import { formatCount } from "@/lib/format";

/** Leading provenance phrase before the generated date. */
export function footerGeneratedPrefixCopy(): string {
  return "Projections generated";
}

/** Data-source chip after the projection engine label. */
export function footerNhlApiCopy(): string {
  return "NHL API";
}

/** Trailing footer chip for draftable pool size. */
export function footerDraftableCopy(playerCount: number): string {
  return `${formatCount(playerCount)} draftable`;
}

export const FOOTER_SOURCE_HREF =
  "https://github.com/SamuelLachance/fantasy-hockey-vor" as const;

/** Visible label for the repository source link. */
export function footerSourceLinkCopy(): string {
  return "GitHub";
}

/** Tooltip / title for the repository source link. */
export function footerSourceLinkTitle(): string {
  return "View source on GitHub";
}

/** Accessible name — visible label plus new-tab warning. */
export function footerSourceLinkAriaLabel(): string {
  return "View source on GitHub (opens in a new tab)";
}
