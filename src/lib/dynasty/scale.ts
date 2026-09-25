/**
 * Projected → realized scale and replacement levels (§3.1).
 *
 * players.json projections run about 0.85 FP/G above what players realize,
 * so multiplicative aging has to run on the realized scale:
 *   θ̂ = α_g + β_g · x   (F: x = off; D: x = off + max(0, dx); G: identity on gE)
 */
import type { DynastyParams } from "./params";
import type { Group } from "./types";

/** G if he has a goalie value, D if D without C/W, else F (§3.1). */
export function groupOf(e: string, hasGoalieValue: boolean, hint?: Group): Group {
  const t = e.split(",").map((x) => x.trim()).filter(Boolean);
  if (hasGoalieValue) return "G";
  if (!t.length) return hint ?? "F";
  if (t.includes("G") && !t.some((x) => x === "C" || x === "W" || x === "D" || x === "F")) return "G";
  if (t.includes("D") && !t.includes("C") && !t.includes("W")) return "D";
  return "F";
}

/** Realized FP/G from a projected per-game value (goalies: per start). */
export function realized(p: DynastyParams, g: Group, x: number): number {
  if (g === "G") return x;
  const c = p.scale[g];
  return c.a + c.b * x;
}

/** The projected-scale input of the fit: F off, D off + max(0, dx), G gE. */
export function projectedX(g: Group, proj: { off?: number; dx?: number; gE?: number }): number {
  if (g === "G") return proj.gE ?? 0;
  return (proj.off ?? 0) + (g === "D" ? Math.max(0, proj.dx ?? 0) : 0);
}

export interface Replacement {
  /** Skater replacement per game (realized). */
  F: number;
  D: number;
  /** Goalie replacement per season-slot (realized FP), for the current season length. */
  Gseason: number;
  /** Captain reference: realized off of the #24 forward. */
  offRef: number;
}

export function replacement(p: DynastyParams): Replacement {
  return {
    F: realized(p, "F", p.scale.waiverLineProj.F),
    D: realized(p, "D", p.scale.waiverLineProj.D),
    // params hold R_Gs on the 82-game basis (a waiver goalie's ~35 starts × 3.65)
    Gseason: (p.repl.Gseason * p.games.seasonGames) / p.games.projectionBasis,
    offRef: realized(p, "F", p.scale.offRefProj),
  };
}

/** Fantrax integer age → calibration band index (§3.3). */
export function ageBandIndex(age: number): number {
  if (age <= 21) return 0;
  if (age <= 23) return 1;
  if (age <= 26) return 2;
  if (age <= 29) return 3;
  if (age <= 32) return 4;
  if (age <= 35) return 5;
  return 6;
}

/** Half-strength year-0 age calibration of the ML projection (skaters only). */
export function year0Cal(p: DynastyParams, g: Group, age: number): number {
  if (g === "G") return 1;
  return p.year0AgeCal[g][ageBandIndex(age)] ?? 1;
}
