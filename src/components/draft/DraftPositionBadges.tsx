import { POSITION_COLORS } from "@/lib/format";
import type { Position } from "@/lib/types";

interface DraftPositionBadgesProps {
  positions: readonly Position[];
  /** Position the VOR is measured at (ringed when several are eligible). */
  vorPos?: Position;
}

/** Yahoo eligibility chips, same palette as the main board. */
export function DraftPositionBadges({ positions, vorPos }: DraftPositionBadgesProps) {
  const unique = [...new Set(positions)];
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {unique.map((pos) => {
        const ringed = unique.length > 1 && pos === vorPos;
        return (
          <span
            key={pos}
            className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold ring-1 ring-inset ${POSITION_COLORS[pos]} ${ringed ? "ring-cyan-300/80" : ""}`}
            title={ringed ? `VOR calculé à ${pos}` : `Admissible à ${pos}`}
          >
            {pos}
          </span>
        );
      })}
    </span>
  );
}
