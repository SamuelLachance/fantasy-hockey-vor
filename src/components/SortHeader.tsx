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
  return (
    <th className={className} title={title}>
      <button
        type="button"
        onClick={() => onToggle(column)}
        onDoubleClick={onReset}
        title={title ?? "Double-click to reset sort to VOR"}
        className={
          center
            ? "inline-flex w-full items-center justify-center gap-1 hover:text-white"
            : "inline-flex items-center gap-1 hover:text-white"
        }
      >
        {label} <SortIcon column={column} sortKey={sortKey} sortDir={sortDir} />
      </button>
    </th>
  );
}
