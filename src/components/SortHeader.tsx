"use client";

import type { SortKey } from "@/lib/rankings-filters";
import { SortIcon } from "./SortIcon";

interface SortHeaderProps {
  column: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onToggle: (key: SortKey) => void;
  onReset: () => void;
  label: string;
  className?: string;
  title?: string;
  center?: boolean;
}

export function SortHeader({
  column,
  sortKey,
  sortDir,
  onToggle,
  onReset,
  label,
  className = "",
  title,
  center,
}: SortHeaderProps) {
  const active = sortKey === column;
  return (
    <th
      className={className}
      title={title}
      aria-sort={
        active ? (sortDir === "asc" ? "ascending" : "descending") : "none"
      }
      scope="col"
    >
      <button
        type="button"
        onClick={() => onToggle(column)}
        onDoubleClick={onReset}
        title={title ?? "Double-click to reset sort to VOR"}
        aria-label={
          active
            ? `${label}, sorted ${sortDir === "asc" ? "ascending" : "descending"}`
            : `Sort by ${label}`
        }
        className={
          center
            ? "inline-flex w-full items-center justify-center gap-1 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            : "inline-flex items-center gap-1 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
        }
      >
        {label} <SortIcon column={column} sortKey={sortKey} sortDir={sortDir} />
      </button>
    </th>
  );
}
