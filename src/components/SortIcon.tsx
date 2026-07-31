import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SortKey } from "@/lib/rankings-filters";

export function SortIcon({
  column,
  sortKey,
  sortDir,
}: {
  column: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
}) {
  if (sortKey !== column) {
    return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" aria-hidden="true" />;
  }
  return sortDir === "asc" ? (
    <ArrowUp className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
  ) : (
    <ArrowDown className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
  );
}
