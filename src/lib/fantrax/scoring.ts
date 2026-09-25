/**
 * League scoring table, parsed from fxea
 * `scoringSystem.scoringCategorySettings` instead of hard-coded.
 *
 * Fantrax scores by the lineup SLOT a player sits in, not his position
 * ("Score Flex positions by the players' actual positions: No"). A slot
 * without its own row for a category falls back to the Default row, so:
 *   pts(cat, slot) = cfg[cat][slot] ?? cfg[cat].Default
 * That makes Blk / Tk / skater SHO worth 0 in the Skt (captain) slot, and
 * worth 0 for a D/W dual sitting in a W slot.
 */
import type { FxeaScoringGroup } from "./api-types";
import { D_IN_SKT_FALLBACK, type DInSktFallback } from "./config";

/** category shortName → slot shortName (Default / D / Skt …) → points. */
export type CategoryPoints = Record<string, Record<string, number>>;

export interface ScoringTable {
  skater: CategoryPoints;
  goalie: CategoryPoints;
}

/** Per-game (or season-total) skater stat line keyed by our rate names. */
export interface SkaterRates {
  g: number;
  a1: number;
  a2: number;
  sog: number;
  hit: number;
  otp: number;
  ht: number;
  blk: number;
  tk: number;
  sho: number;
}

export interface GoalieRates {
  w: number;
  ga: number;
  sv: number;
  so: number;
  otl: number;
  osw: number;
  a: number;
  g: number;
}

/** Fantrax category shortName → SkaterRates key. */
export const SKATER_CATEGORY_KEYS: Record<string, keyof SkaterRates> = {
  G: "g",
  A1: "a1",
  A2: "a2",
  SOG: "sog",
  Hit: "hit",
  OTP: "otp",
  HT: "ht",
  Blk: "blk",
  Tk: "tk",
  SHO: "sho",
};

/** Fantrax category shortName → GoalieRates key. */
export const GOALIE_CATEGORY_KEYS: Record<string, keyof GoalieRates> = {
  W: "w",
  GA: "ga",
  SV: "sv",
  SHO: "so",
  "OL+ShL": "otl",
  OSW: "osw",
  A: "a",
  G: "g",
};

export function parseScoringTable(groups: FxeaScoringGroup[]): ScoringTable {
  const table: ScoringTable = { skater: {}, goalie: {} };
  for (const group of groups) {
    const target =
      group.group.code === "HOCKEY_GOALIE"
        ? table.goalie
        : group.group.code === "HOCKEY_SKATING"
          ? table.skater
          : null;
    if (!target) continue;
    for (const c of group.configs) {
      const cat = c.scoringCategory.shortName;
      const slot = c.position.shortName;
      (target[cat] ??= {})[slot] = c.points;
    }
  }
  return table;
}

/** Slot lookup with the Default fallback Fantrax applies. */
export function categoryPoints(
  cfg: CategoryPoints,
  category: string,
  slot: string,
): number {
  const row = cfg[category];
  if (!row) return 0;
  return row[slot] ?? row.Default ?? 0;
}

export interface SkaterSlotOptions {
  /** Player is a defenseman (only matters for a D in the Skt slot). */
  isD?: boolean;
  dInSkt?: DInSktFallback;
}

/** Points for a skater stat line scored in `slot`. */
export function skaterSlotPoints(
  table: ScoringTable,
  rates: SkaterRates,
  slot: string,
  opts: SkaterSlotOptions = {},
): number {
  const dInSkt = opts.dInSkt ?? D_IN_SKT_FALLBACK;
  let total = 0;
  for (const [cat, row] of Object.entries(table.skater)) {
    const key = SKATER_CATEGORY_KEYS[cat];
    if (!key) continue;
    let pts = categoryPoints(table.skater, cat, slot);
    if (
      slot === "Skt" &&
      opts.isD &&
      dInSkt === "d" &&
      row.Skt === undefined &&
      row.D !== undefined
    ) {
      pts = row.D;
    }
    total += pts * rates[key];
  }
  return total;
}

export function goaliePoints(table: ScoringTable, rates: GoalieRates): number {
  let total = 0;
  for (const cat of Object.keys(table.goalie)) {
    const key = GOALIE_CATEGORY_KEYS[cat];
    if (!key) continue;
    total += categoryPoints(table.goalie, cat, "Default") * rates[key];
  }
  return total;
}

/**
 * Split a skater line into the two numbers the rest of the tool stores:
 * `off` = Default-slot points (what a C / W / F slot scores) and `dx` = the
 * extra a D slot adds (Blk / Tk / SHO here).
 */
export function skaterComponents(
  table: ScoringTable,
  rates: SkaterRates,
): { off: number; dx: number } {
  const off = skaterSlotPoints(table, rates, "Default");
  const d = skaterSlotPoints(table, rates, "D", { isD: true });
  return { off, dx: d - off };
}

export interface ScoringShape {
  /** Skt points ÷ Default points, shared by every offensive category. */
  sktMultiplier: number;
  /** False if categories disagree on the multiplier (then Skt is approximate). */
  uniformSkt: boolean;
  /** Slots (besides Default) that have their own rows. */
  overrideSlots: string[];
}

export function scoringShape(table: ScoringTable): ScoringShape {
  const ratios: number[] = [];
  const slots = new Set<string>();
  for (const row of Object.values(table.skater)) {
    for (const s of Object.keys(row)) if (s !== "Default") slots.add(s);
    const base = row.Default ?? 0;
    if (base !== 0 && row.Skt !== undefined) ratios.push(row.Skt / base);
  }
  const sktMultiplier = ratios.length
    ? ratios.reduce((a, b) => a + b, 0) / ratios.length
    : 1;
  const uniformSkt = ratios.every((r) => Math.abs(r - sktMultiplier) < 1e-9);
  return { sktMultiplier, uniformSkt, overrideSlots: [...slots].sort() };
}

/**
 * Per-game value of a skater in each slot type, from the stored
 * `{off, dx}` pair. C / W / F score Default; D adds dx; Skt multiplies the
 * offense and (by default) drops dx — a D captain loses his blocks.
 */
export function skaterSlotValue(
  off: number,
  dx: number,
  slot: string,
  sktMultiplier: number,
  opts: SkaterSlotOptions = {},
): number {
  if (slot === "D") return off + dx;
  if (slot === "Skt") {
    const keepDx = opts.isD && (opts.dInSkt ?? D_IN_SKT_FALLBACK) === "d";
    return off * sktMultiplier + (keepDx ? dx : 0);
  }
  return off;
}
