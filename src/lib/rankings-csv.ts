import type { Category, PlayerProjection, Position } from "@/lib/types";
import { CATEGORY_LABELS, projectionStatValue } from "@/lib/format";
import { vorForFilter } from "@/lib/rankings-filters";

function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build a CSV of the current filtered board (full list, not page slice). */
export function rankingsToCsv(
  players: PlayerProjection[],
  position: Position | "ALL",
  categories: readonly Category[],
): string {
  const vorScope = position === "ALL" ? "overall" : "position";
  const meta = `# fantasy-hockey-vor;filter=${position};vorScope=${vorScope};count=${players.length}`;
  const headers = [
    "rank",
    "name",
    "team",
    "positions",
    "vor",
    "edge",
    "sigma",
    "gp",
    ...categories.map((c) => CATEGORY_LABELS[c]),
  ];
  const lines = [meta, headers.join(",")];
  for (const p of players) {
    const rank = position === "ALL" ? p.rank : (p.positionRank ?? p.rank);
    const cells: Array<string | number> = [
      rank,
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
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
