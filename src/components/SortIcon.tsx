import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SortKey } from "@/lib/rankings-filters";

export function SortIcon({
  column,
  sortKey,
  sortDir,
  /** Narrow columns: omit the idle dual-arrow so the label fits. */
  compact = false,
}: {
  column: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  compact?: boolean;
}) {
  if (sortKey !== column) {
    if (compact) return null;
    return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" aria-hidden="true" />;
  }
  const iconClass = compact
    ? "h-3 w-3 text-cyan-400"
    : "h-3.5 w-3.5 text-cyan-400";
  return sortDir === "asc" ? (
    <ArrowUp className={iconClass} aria-hidden="true" />
  ) : (
    <ArrowDown className={iconClass} aria-hidden="true" />
  );
}
