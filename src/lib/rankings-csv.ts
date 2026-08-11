import type { Category, PlayerProjection, Position } from "@/lib/types";
import { CATEGORY_LABELS, projectionStatValue } from "@/lib/format";
import {
  rankForFilter,
  vorForFilter,
  type SortKey,
  type StatRanges,
} from "@/lib/rankings-filters";
import { encodeStatRanges } from "@/lib/rankings-url";

function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface RankingsCsvMeta {
  query?: string;
  sortKey?: SortKey;
  sortDir?: "asc" | "desc";
  hideDepthGoalies?: boolean;
  statRanges?: StatRanges;
}

/** Build the `# fantasy-hockey-vor;…` comment for CSV exports. */
export function rankingsCsvMetaLine(
  position: Position | "ALL",
  playerCount: number,
  meta?: RankingsCsvMeta,
): string {
  const vorScope = position === "ALL" ? "overall" : "position";
  const parts = [
    "fantasy-hockey-vor",
    `filter=${position}`,
    `vorScope=${vorScope}`,
    `count=${playerCount}`,
  ];
  if (meta?.sortKey) parts.push(`sort=${meta.sortKey}`);
  if (meta?.sortDir) parts.push(`dir=${meta.sortDir}`);
  if (meta?.hideDepthGoalies === false) parts.push("g=all");
  if (meta?.query?.trim()) {
    parts.push(`q=${encodeURIComponent(meta.query.trim().slice(0, 48))}`);
  }
  const rf = meta?.statRanges ? encodeStatRanges(meta.statRanges) : "";
  if (rf) parts.push(`rf=${rf}`);
  return `# ${parts.join(";")}`;
}

/** Build a CSV of the current filtered board (full list, not page slice). */
export function rankingsToCsv(
  players: PlayerProjection[],
  position: Position | "ALL",
  categories: readonly Category[],
  meta?: RankingsCsvMeta,
): string {
  const lines = [
    rankingsCsvMetaLine(position, players.length, meta),
    [
      "rank",
      "id",
      "name",
      "team",
      "positions",
      "vor",
      "edge",
      "sigma",
      "gp",
      ...categories.map((c) => CATEGORY_LABELS[c]),
    ].join(","),
  ];
  for (const p of players) {
    const rank = rankForFilter(p, position);
    const cells: Array<string | number> = [
      rank,
      p.id,
      p.name,
      p.team,
      p.positions.join("/"),
      vorForFilter(p, position).toFixed(3),
      p.draftValue ?? 0,
      p.uncertainty?.total?.sigma != null
        ? p.uncertainty.total.sigma.toFixed(2)
        : "",
      p.gamesPlayed,
    ];
    for (const cat of categories) {
      const v = projectionStatValue(p, cat);
      cells.push(v == null ? "" : cat === "savePct" ? v.toFixed(4) : v);
    }
    lines.push(cells.map(csvEscape).join(","));
  }
  return `\uFEFF${lines.join("\n")}`;
}

export function downloadTextFile(filename: string, text: string, mime: string) {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke — Safari/Firefox can drop the download if revoked in the same turn.
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
