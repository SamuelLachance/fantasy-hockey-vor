import {
  SKATER_CATEGORIES,
  GOALIE_CATEGORIES,
  type Category,
  type PlayerProjection,
  type Position,
} from "@/lib/types";

export const CATEGORY_LABELS: Record<Category, string> = {
  goals: "G",
  assists: "A",
  shots: "SOG",
  blocks: "BLK",
  hits: "HIT",
  powerplayPoints: "PPP",
  penaltyMinutes: "PIM",
  faceoffWins: "FOW",
  wins: "W",
  shutouts: "SO",
  saves: "SV",
  savePct: "SV%",
};

export const CATEGORY_FULL_LABELS: Record<Category, string> = {
  goals: "Goals",
  assists: "Assists",
  shots: "Shots",
  blocks: "Blocks",
  hits: "Hits",
  powerplayPoints: "Power Play Points",
  penaltyMinutes: "Penalty Minutes",
  faceoffWins: "Faceoff Wins",
  wins: "Wins",
  shutouts: "Shutouts",
  saves: "Saves",
  savePct: "Save %",
};

export const POSITION_COLORS: Record<Position, string> = {
  C: "bg-cyan-500/20 text-cyan-300 ring-cyan-500/30",
  LW: "bg-sky-500/20 text-sky-300 ring-sky-500/30",
  RW: "bg-blue-500/20 text-blue-300 ring-blue-500/30",
  D: "bg-indigo-500/20 text-indigo-300 ring-indigo-500/30",
  G: "bg-violet-500/20 text-violet-300 ring-violet-500/30",
};

export function formatStat(
  player: PlayerProjection,
  category: Category,
): string {
  const value = (player.projection as unknown as Record<string, number>)[
    category
  ];
  if (category === "savePct") return (value * 100).toFixed(1) + "%";
  if (category === "penaltyMinutes") return value.toFixed(0);
  return value.toLocaleString();
}

export function playerCategories(
  player: PlayerProjection,
): readonly Category[] {
  return player.isGoalie ? GOALIE_CATEGORIES : SKATER_CATEGORIES;
}

export function vorColor(vor: number): string {
  if (vor >= 4) return "text-emerald-400";
  if (vor >= 2) return "text-cyan-300";
  if (vor >= 0) return "text-slate-200";
  return "text-rose-400";
}
