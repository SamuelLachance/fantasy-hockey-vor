import type { SortKey } from "@/lib/rankings-filters";

/** HTML aria-sort value for a sortable column header. */
export function sortHeaderAriaSort(
  column: SortKey,
  sortKey: SortKey,
  sortDir: "asc" | "desc",
): "ascending" | "descending" | "none" {
  if (sortKey !== column) return "none";
  return sortDir === "asc" ? "ascending" : "descending";
}

/** Accessible name for a sortable column button. */
export function sortHeaderAriaLabel(
  label: string,
  column: SortKey,
  sortKey: SortKey,
  sortDir: "asc" | "desc",
): string {
  if (sortKey !== column) return `Sort by ${label}`;
  return `${label}, sorted ${sortDir === "asc" ? "ascending" : "descending"}`;
}
