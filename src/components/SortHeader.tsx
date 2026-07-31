"use client";

import type { SortKey } from "@/lib/rankings-filters";
import { sortHeaderAriaLabel, sortHeaderAriaSort, sortHeaderResetTitle } from "@/lib/sort-header";
import { SortIcon } from "./SortIcon";

interface SortHeaderProps {
  column: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onToggle: (key: SortKey) => void;
  onReset: () => void;
  label: string;
  /** Spoken name when the visible label is abbreviated (defaults to `label`). */
  accessibleLabel?: string;
  className?: string;
  title?: string;
  center?: boolean;
  /** Hide idle sort glyph (for the pinned `#` column). */
  compact?: boolean;
}

export function SortHeader({
  column,
  sortKey,
  sortDir,
  onToggle,
  onReset,
  label,
  accessibleLabel,
  className = "",
  title,
  center,
  compact,
}: SortHeaderProps) {
  const spoken = accessibleLabel ?? label;
  return (
    <th
      className={className}
      title={title}
      aria-sort={sortHeaderAriaSort(column, sortKey, sortDir)}
      scope="col"
    >
      <button
        type="button"
        onClick={() => onToggle(column)}
        onDoubleClick={onReset}
        title={title ?? sortHeaderResetTitle()}
        aria-label={sortHeaderAriaLabel(spoken, column, sortKey, sortDir)}
        className={
          center
            ? `inline-flex w-full items-center justify-center ${compact ? "gap-0.5" : "gap-1"} hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80`
            : "inline-flex items-center gap-1 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
        }
      >
        {label}
        <SortIcon
          column={column}
          sortKey={sortKey}
          sortDir={sortDir}
          compact={compact}
        />
      </button>
    </th>
  );
}
