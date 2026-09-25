/**
 * Prospects (§3.7): the draft-slot fallback for players missing from the
 * frozen prospect model. (Young NHL players no longer converge toward a
 * pedigree prior: the conditional growth model, growth.ts, carries pedigree
 * and production together.)
 */
import type { DynastyParams } from "./params";
import { sigmoid } from "./rng";
import type { Group, ProspectRecord } from "./types";

export interface ProspectModel {
  /** P(make it): 200 NHL GP, or one 40-start season for goalies. */
  pMake: number;
  /** Prime (age 25) FP/G if he makes it, realized scale. */
  pi: { mu: number; sd: number };
  /** First regular season (start year) if he makes it. */
  eta: number;
}

/** Prime FP/G prior from the draft slot (undrafted: flat prior). */
export function slotPrime(p: DynastyParams, g: Group, pick: number | null): { mu: number; sd: number } {
  const s = p.prospect.slotPrime;
  if (g === "G") return { ...s.G };
  if (pick == null || !(pick > 0)) return { mu: p.prospect.undraftedPrior[g], sd: s[g].sd };
  return { mu: s[g].a + s[g].b * Math.log(pick), sd: s[g].sd };
}

/** Draft-slot P(make it) before the no-arrival decay. */
export function slotPMakeRaw(p: DynastyParams, g: Group, pick: number): number {
  if (g === "G") {
    for (const [maxPick, v] of p.prospect.slotPMake.G) if (pick <= maxPick) return v;
    return p.prospect.slotPMake.G[p.prospect.slotPMake.G.length - 1]![1];
  }
  const c = p.prospect.slotPMake[g];
  return sigmoid(c.a + c.b * Math.log(pick));
}

/**
 * Draft-slot fallback (§3.7b): pMake from the slot, odds multiplied by the
 * no-arrival decay for completed post-draft seasons; prime from the slot;
 * ETA = draft year + lag by pick band (goalies + 5).
 */
export function slotProspect(
  p: DynastyParams,
  g: Group,
  draft: { year: number; pick: number },
  season = p.firstSeasonYear,
): ProspectModel {
  const yrs = Math.max(0, season - draft.year);
  const decay = p.prospect.decay[Math.min(p.prospect.decay.length - 1, yrs)]!;
  const raw = slotPMakeRaw(p, g, draft.pick);
  const odds = (raw / (1 - raw)) * decay;
  const pMake = odds / (1 + odds);
  let lag = p.prospect.etaLag[p.prospect.etaLag.length - 1]![1];
  if (g === "G") lag = p.prospect.etaLagGoalie;
  else for (const [maxPick, l] of p.prospect.etaLag) if (draft.pick <= maxPick) { lag = l; break; }
  return { pMake, pi: slotPrime(p, g, draft.pick), eta: Math.max(season, draft.year + lag) };
}

/** From a frozen research record. */
export function recordProspect(r: ProspectRecord): ProspectModel {
  return { pMake: r.pMake, pi: { mu: r.fpgIfMake.mu, sd: r.fpgIfMake.sd }, eta: r.eta ?? 2028 };
}
