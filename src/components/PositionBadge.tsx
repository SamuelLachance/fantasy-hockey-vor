import type { Position } from "@/lib/types";
import { POSITION_COLORS } from "@/lib/format";

interface PositionBadgeProps {
  position: Position;
  className?: string;
  highlight?: boolean;
}

export function PositionBadge({
  position,
  className = "",
  highlight = false,
}: PositionBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_COLORS[position]} ${highlight ? "ring-2 ring-cyan-400/80" : ""} ${className}`}
      title={highlight ? `VOR calculated at ${position}` : undefined}
    >
      {position}
    </span>
  );
}

interface PositionBadgesProps {
  positions: Position[];
  vorPosition?: Position;
  className?: string;
}

export function PositionBadges({
  positions,
  vorPosition,
  className = "",
}: PositionBadgesProps) {
  const unique = [...new Set(positions)];
  if (unique.length <= 1) {
    return <PositionBadge position={unique[0] ?? "C"} className={className} />;
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {unique.map((pos) => (
        <PositionBadge
          key={pos}
          position={pos}
          highlight={pos === vorPosition}
        />
      ))}
    </span>
  );
}
