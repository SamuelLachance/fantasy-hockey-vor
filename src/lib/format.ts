import {
  SKATER_CATEGORIES,
  DEFENSE_SKATER_CATEGORIES,
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

/**
 * Locale-pinned count formatting. The static HTML is prerendered once at
 * build time; using the visitor's locale would cause a hydration mismatch
 * (e.g. "1,346" vs "1 346") that forces React to re-render the whole tree.
 */
export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * Signed display for VOR/Edge. `plusZero` matches VOR cells (+0.00);
 * Edge uses plusZero=false so zero stays bare.
 */
export function formatSigned(
  value: number,
  opts?: { digits?: number; plusZero?: boolean },
): string {
  const body =
    opts?.digits == null ? String(value) : value.toFixed(opts.digits);
  const showPlus = value > 0 || (Boolean(opts?.plusZero) && value >= 0);
  return showPlus ? `+${body}` : body;
}

export function formatStat(
  player: PlayerProjection,
  category: Category,
): string {
  const value = projectionStatValue(player, category);
  if (value == null) return "—";
  if (category === "savePct") {
    // Hockey convention: .9124 — four decimals so starters don't look identical.
    return "." + String(Math.round(value * 10000)).padStart(4, "0");
  }
  if (category === "penaltyMinutes") return value.toFixed(0);
  return formatCount(value);
}

/** Raw projected value for a category, or null if not applicable. */
export function projectionStatValue(
  player: PlayerProjection,
  category: Category,
): number | null {
  if (player.isGoalie) {
    if (!(GOALIE_CATEGORIES as readonly string[]).includes(category)) {
      return null;
    }
  } else if ((GOALIE_CATEGORIES as readonly string[]).includes(category)) {
    return null;
  } else if (
    category === "faceoffWins" &&
    player.position === "D"
  ) {
    return null;
  }
  const value = (player.projection as unknown as Record<string, number>)[
    category
  ];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function playerCategories(
  player: PlayerProjection,
): readonly Category[] {
  if (player.isGoalie) return GOALIE_CATEGORIES;
  if (player.position === "D") return DEFENSE_SKATER_CATEGORIES;
  return SKATER_CATEGORIES;
}

export function skaterCategoriesForFilter(
  position: Position | "ALL",
): readonly Category[] {
  if (position === "G") return GOALIE_CATEGORIES;
  if (position === "D") return DEFENSE_SKATER_CATEGORIES;
  return SKATER_CATEGORIES;
}

export function vorColor(vor: number): string {
  if (vor >= 4) return "text-emerald-400";
  if (vor >= 2) return "text-cyan-300";
  if (vor >= 0) return "text-slate-200";
  return "text-rose-400";
}

/** Color for calibrated aggregate uncertainty (lower is better). */
export function sigmaColor(sigma: number): string {
  if (!Number.isFinite(sigma)) return "text-slate-500";
  if (sigma < 40) return "text-emerald-400";
  if (sigma < 70) return "text-slate-300";
  if (sigma < 100) return "text-amber-300";
  return "text-rose-300";
}

/** Color for consensus-minus-model Edge (draftValue). */
export function edgeColor(edge: number): string {
  if (edge > 0) return "text-emerald-400";
  if (edge < 0) return "text-rose-400";
  return "text-slate-500";
}
