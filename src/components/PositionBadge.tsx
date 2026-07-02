import type { Position } from "@/lib/types";
import { POSITION_COLORS } from "@/lib/format";

interface PositionBadgeProps {
  position: Position;
  className?: string;
}

export function PositionBadge({ position, className = "" }: PositionBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${POSITION_COLORS[position]} ${className}`}
    >
      {position}
    </span>
  );
}
