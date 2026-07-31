import { formatCount } from "@/lib/format";

/** Trailing footer chip for draftable pool size. */
export function footerDraftableCopy(playerCount: number): string {
  return `${formatCount(playerCount)} draftable`;
}

export const FOOTER_SOURCE_HREF =
  "https://github.com/SamuelLachance/fantasy-hockey-vor" as const;
