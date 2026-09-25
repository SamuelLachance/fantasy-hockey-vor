import { memo } from "react";
import { CATEGORY_FR, CATEGORY_SHORT, formatSignedFr, formatStat } from "@/lib/draft/draft-copy";
import type { LeagueCategory } from "@/lib/leagues/types";

interface CategoryMiniBarsProps {
  categories: readonly LeagueCategory[];
  z: readonly number[];
  proj: readonly number[];
}

/** z beyond ±3 draws as a full half-bar; the number keeps the true value. */
const BAR_BOUND = 3;

/**
 * One tiny diverging bar per category: the player's z against his own
 * group (forwards, defensemen or goalies), so a defenseman's blocks are
 * compared with other defensemen's, not with forwards'. Up = above his
 * peers, down = below. Hover/title and the screen reader text carry the
 * projected line.
 */
export const CategoryMiniBars = memo(function CategoryMiniBars({
  categories,
  z,
  proj,
}: CategoryMiniBarsProps) {
  const summary = categories
    .map((c, i) => `${CATEGORY_FR[c]} ${formatStat(c, proj[i] ?? 0)} (${formatSignedFr(z[i] ?? 0)} z vs pairs)`)
    .join(", ");
  return (
    <span className="inline-flex items-end gap-[3px]" title={summary}>
      <span className="sr-only">{summary}</span>
      {categories.map((c, i) => {
        const v = z[i] ?? 0;
        const h = Math.min(1, Math.abs(v) / BAR_BOUND) * 50;
        return (
          <span key={c} className="flex flex-col items-center gap-0.5" aria-hidden="true">
            <span className="relative block h-5 w-1.5 rounded-sm bg-white/5">
              <span className="absolute inset-x-0 top-1/2 h-px bg-white/15" />
              <span
                className={`absolute inset-x-0 rounded-sm ${v >= 0 ? "bg-cyan-400" : "bg-rose-400"}`}
                style={
                  v >= 0
                    ? { bottom: "50%", height: `${h}%` }
                    : { top: "50%", height: `${h}%` }
                }
              />
            </span>
            <span className="hidden text-[8px] leading-none text-slate-500 sm:block">
              {CATEGORY_SHORT[c].slice(0, 3)}
            </span>
          </span>
        );
      })}
    </span>
  );
});
