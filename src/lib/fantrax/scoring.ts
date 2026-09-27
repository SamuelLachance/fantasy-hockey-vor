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
import type { FxeaScoringCategories, FxeaScoringGroup } from "./api-types";
import {
  CAPTAINS_DYNASTY,
  D_IN_SKT_FALLBACK,
  type DInSktFallback,
  type FantraxLeagueConfig,
  type ScoringBaseSlot,
  type ScoringSource,
} from "./config";

/** category shortName → slot shortName (Default / D / Skt …) → points. */
export type CategoryPoints = Record<string, Record<string, number>>;

export interface ScoringTable {
  skater: CategoryPoints;
  goalie: CategoryPoints;
}

/**
 * Per-game (or season-total) skater stat line keyed by our rate names. The
 * first block is what the Captains categories need; the optional ones are
 * categories other leagues score (a single assists total instead of A1/A2,
 * power-play points, shorthanded goals, shots blocked) and are absent from a
 * line built for a league that does not use them.
 */
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
  /** Assists as one category (Fantrax "A"), not split into A1 / A2. */
  a?: number;
  /** Power-play points. */
  ppp?: number;
  /** Shorthanded goals. */
  shg?: number;
  /** Shots blocked, where the league scores them for every slot ("SB"). */
  sb?: number;
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
  A: "a",
  PPP: "ppp",
  SHG: "shg",
  SB: "sb",
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

/**
 * From `scoringSystem.scoringCategorySettings`. Fantrax omits every row
 * worth 0 there, so a category configured to 0 for each of a league's slots
 * arrives as a bare `Default` row and looks unconfigured: use
 * `parseScoringCategories` for such a league (see `ScoringSource`).
 */
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

/** `"points0.15"` / `"points-1.5"` → 0.15 / −1.5; anything else → null. */
export function parsePointsString(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const v = Number.parseFloat(raw.replace(/^points/, ""));
  return Number.isFinite(v) ? v : null;
}

/**
 * From `scoringSystem.scoringCategories`, the complete view: it keeps the
 * rows worth 0, so a league whose per-slot zeros are the actual rule (Hit 0
 * and SB 0 for every slot it has, with a `Default` no slot can reach) scores
 * the way Fantrax scores it.
 */
export function parseScoringCategories(categories: FxeaScoringCategories): ScoringTable {
  const table: ScoringTable = { skater: {}, goalie: {} };
  for (const [group, cats] of Object.entries(categories)) {
    const key = group.toUpperCase();
    const target = key.includes("GOALIE") ? table.goalie : key.includes("SKAT") ? table.skater : null;
    if (!target) continue;
    for (const [cat, row] of Object.entries(cats)) {
      for (const [slot, raw] of Object.entries(row)) {
        const pts = parsePointsString(raw);
        if (pts === null) continue;
        (target[cat] ??= {})[slot] = pts;
      }
    }
  }
  return table;
}

/** The scoring table of a league, from the source its config names. */
export function scoringTableFromInfo(
  scoringSystem: {
    scoringCategorySettings: FxeaScoringGroup[];
    scoringCategories?: FxeaScoringCategories;
  },
  source: ScoringSource,
): ScoringTable {
  if (source === "settings") return parseScoringTable(scoringSystem.scoringCategorySettings);
  if (!scoringSystem.scoringCategories) {
    throw new Error('scoringSource "categories": getLeagueInfo has no scoringSystem.scoringCategories');
  }
  return parseScoringCategories(scoringSystem.scoringCategories);
}

/**
 * Categories the league scores that the value model has no rate for — it
 * would drop them silently (`if (!key) continue`). Empty for every league
 * the tool supports; `check:league` fails on anything else so a new league's
 * missing category is a build error, not a quietly wrong board.
 */
export function unscoredCategories(table: ScoringTable): string[] {
  const out: string[] = [];
  const scored = (cfg: CategoryPoints, cat: string) =>
    Object.values(cfg[cat] ?? {}).some((p) => p !== 0);
  for (const cat of Object.keys(table.skater)) {
    if (!SKATER_CATEGORY_KEYS[cat] && scored(table.skater, cat)) out.push(`skater ${cat}`);
  }
  for (const cat of Object.keys(table.goalie)) {
    if (!GOALIE_CATEGORY_KEYS[cat] && scored(table.goalie, cat)) out.push(`goalie ${cat}`);
  }
  return out.sort();
}

/**
 * Categories the league configures but no slot of it can actually reach, so
 * they are worth 0 to everyone. Slapshot's Hit (`Default: 0.15`) and SB
 * (`Default: 0.3`) are exactly this: each of its five slots publishes an
 * explicit 0, leaving the Default row unreachable. Naming them keeps the
 * decision visible instead of silent.
 */
export function deadCategories(table: ScoringTable, cfg: FantraxLeagueConfig): string[] {
  const out: string[] = [];
  for (const [cat, row] of Object.entries(table.skater)) {
    if (!SKATER_CATEGORY_KEYS[cat]) continue;
    const configured = Object.values(row).some((p) => p !== 0);
    if (!configured) continue;
    const reachable = cfg.slots.order.some((s) => categoryPoints(table.skater, cat, s) !== 0);
    if (!reachable) out.push(`skater ${cat}`);
  }
  return out.sort();
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
    total += pts * (rates[key] ?? 0);
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
 * `off` = his points in the league's forward column (`baseSlot`: "Default"
 * for Captains, "C" for a league like Slapshot that publishes a row for each
 * of its own slots) and `dx` = the extra a D slot adds (Blk / Tk / SHO in
 * Captains; 0 in a league with no D-only category).
 *
 * `baseSlot` defaults to Captains' "Default" so every existing caller keeps
 * its numbers; `check:league` proves the pair models every slot the league
 * actually has (`unmodeledSlots`).
 */
export function skaterComponents(
  table: ScoringTable,
  rates: SkaterRates,
  baseSlot: ScoringBaseSlot = CAPTAINS_DYNASTY.baseSlot,
): { off: number; dx: number } {
  const off = skaterSlotPoints(table, rates, baseSlot);
  const d = skaterSlotPoints(table, rates, "D", { isD: true });
  return { off, dx: d - off };
}

/**
 * Slots of THIS league whose skater points the stored `{off, dx}` pair does
 * not reproduce. The pair models exactly three columns: `baseSlot` (`off`),
 * D (`off + dx`) and Skt (`off × sktMultiplier`). Any other slot of the
 * league must therefore score a skater the same way `baseSlot` does, for
 * every category — otherwise its starters would be valued off the wrong
 * column and `values.json` could not express it.
 *
 * Returns, per offending slot, the first category that disagrees, so the CI
 * message names the cause rather than just the symptom. Empty for Captains
 * (C / W / F all fall through to Default) and for Slapshot (C, LW and RW all
 * publish the same rows).
 */
export function unmodeledSlots(
  table: ScoringTable,
  cfg: FantraxLeagueConfig,
): Array<{ slot: string; category: string; points: number; base: number }> {
  const out: Array<{ slot: string; category: string; points: number; base: number }> = [];
  const modeled = new Set<string>([cfg.baseSlot, "D", "Skt", cfg.eligibility.goalieToken]);
  for (const slot of cfg.slots.order) {
    if (modeled.has(slot)) continue;
    for (const cat of Object.keys(table.skater)) {
      if (!SKATER_CATEGORY_KEYS[cat]) continue;
      const pts = categoryPoints(table.skater, cat, slot);
      const base = categoryPoints(table.skater, cat, cfg.baseSlot);
      if (pts !== base) {
        out.push({ slot, category: cat, points: pts, base });
        break;
      }
    }
  }
  return out;
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
