import type { Category, PlayerProjection } from "@/lib/types";
import { CATEGORY_LABELS, formatSigned, formatStat } from "@/lib/format";
import {
  categorySigmaDigits,
  categoryZBarWidth,
  categoryZMeterValue,
} from "@/lib/category-z-bar";
import {
  detailStatSigma,
  type PlayerDetailRecord,
} from "@/lib/publish-players";

interface ExpandedPlayerCategoriesProps {
  player: PlayerProjection;
  cats: readonly Category[];
  playerDetails: PlayerDetailRecord | undefined;
}

export function ExpandedPlayerCategories({
  player,
  cats,
  playerDetails,
}: ExpandedPlayerCategoriesProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cats.map((cat) => {
        const z = player.categoryZScores[cat] ?? 0;
        const width = categoryZBarWidth(z);
        const sigma = detailStatSigma(playerDetails, cat);
        return (
          <div
            key={cat}
            className="rounded-xl border border-white/5 bg-white/5 p-3"
          >
            <div className="mb-1 flex justify-between text-xs text-slate-400">
              <span>{CATEGORY_LABELS[cat]}</span>
              <span
                className={`tabular-nums ${z >= 0 ? "text-emerald-400" : "text-rose-400"}`}
              >
                {formatSigned(z, { digits: 2, plusZero: true })} z
              </span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-slate-800"
              role="meter"
              aria-label={`${CATEGORY_LABELS[cat]} category z-score`}
              aria-valuemin={-4}
              aria-valuemax={4}
              aria-valuenow={categoryZMeterValue(z)}
              aria-valuetext={`${formatSigned(z, { digits: 2, plusZero: true })} z`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${width}%` }}
                aria-hidden="true"
              />
            </div>
            <div className="mt-1 text-sm font-medium tabular-nums text-white">
              Proj: {formatStat(player, cat)}
              {sigma != null && cat !== "savePct" && (
                <span className="ml-1 text-xs font-normal text-slate-500">
                  ±{sigma.toFixed(categorySigmaDigits(cat))}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
