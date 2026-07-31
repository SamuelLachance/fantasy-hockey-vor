"use client";

import { CATEGORY_LABELS } from "@/lib/format";
import type { Category } from "@/lib/types";
import { STICKY_NAME_BASE, STICKY_NAME_SHADOW } from "@/lib/board-dom";
import type { SortKey } from "@/lib/rankings-filters";
import { SortHeader } from "./SortHeader";

interface RankingsTableHeadProps {
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  tableCategories: readonly Category[];
  onToggleSort: (key: SortKey) => void;
  onResetSort: () => void;
}

export function RankingsTableHead({
  sortKey,
  sortDir,
  tableCategories,
  onToggleSort,
  onResetSort,
}: RankingsTableHeadProps) {
  return (
    <thead className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/95 text-xs uppercase tracking-wider text-slate-400 backdrop-blur-sm motion-reduce:bg-slate-950 motion-reduce:backdrop-blur-none">
      <tr>
        <SortHeader
          column="rank"
          label="#"
          sortKey={sortKey}
          sortDir={sortDir}
          onToggle={onToggleSort}
          onReset={onResetSort}
          className="sticky left-0 z-[5] bg-slate-950/95 px-4 py-3"
        />
        <SortHeader
          column="name"
          label="Player"
          sortKey={sortKey}
          sortDir={sortDir}
          onToggle={onToggleSort}
          onReset={onResetSort}
          className={`sticky left-10 z-[5] bg-slate-950/95 px-4 py-3 sm:left-12 ${STICKY_NAME_BASE} ${STICKY_NAME_SHADOW}`}
        />
        <th scope="col" className="px-4 py-3">
          Pos
        </th>
        <SortHeader
          column="team"
          label="Team"
          sortKey={sortKey}
          sortDir={sortDir}
          onToggle={onToggleSort}
          onReset={onResetSort}
          className="px-4 py-3"
        />
        <SortHeader
          column="vor"
          label="VOR"
          sortKey={sortKey}
          sortDir={sortDir}
          onToggle={onToggleSort}
          onReset={onResetSort}
          className="px-4 py-3"
        />
        <SortHeader
          column="draftValue"
          label="Edge"
          sortKey={sortKey}
          sortDir={sortDir}
          onToggle={onToggleSort}
          onReset={onResetSort}
          className="px-4 py-3"
          title="Consensus rank − model rank. Positive = undervalued vs synthetic market (Marcel/EWMA/lag1)."
        />
        <SortHeader
          column="sigma"
          label="Σσ"
          sortKey={sortKey}
          sortDir={sortDir}
          onToggle={onToggleSort}
          onReset={onResetSort}
          className="px-3 py-3"
          title="Calibrated aggregate uncertainty (1σ). Lower is more confident. Default sort ascending."
        />
        <SortHeader
          column="gamesPlayed"
          label="GP"
          sortKey={sortKey}
          sortDir={sortDir}
          onToggle={onToggleSort}
          onReset={onResetSort}
          className="px-4 py-3"
        />
        {tableCategories.map((cat) => (
          <SortHeader
            key={cat}
            column={cat}
            label={CATEGORY_LABELS[cat]}
            sortKey={sortKey}
            sortDir={sortDir}
            onToggle={onToggleSort}
            onReset={onResetSort}
            className="px-3 py-3 text-center"
            center
          />
        ))}
      </tr>
    </thead>
  );
}
