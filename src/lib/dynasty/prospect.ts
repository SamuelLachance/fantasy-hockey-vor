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

/** Piecewise-linear lookup in [x, y] pairs sorted by x, flat past the ends. */
export function interpPairs(pairs: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (!pairs.length) return 0;
  if (x <= pairs[0]![0]) return pairs[0]![1];
  for (let i = 1; i < pairs.length; i++) {
    const [x1, y1] = pairs[i]!;
    if (x <= x1) {
      const [x0, y0] = pairs[i - 1]!;
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pairs[pairs.length - 1]![1];
}

/**
 * The draft-slot model's P(make it) for pick `pick` of the draft an
 * undrafted player of `age0` (Oct 1 of `season`) went through unpicked: the
 * one in the year he turned 18, so as many completed post-draft seasons
 * (no-arrival decay) as a drafted player of his age.
 */
export function lateSlotPMake(p: DynastyParams, g: Group, age0: number, pick: number, season = p.firstSeasonYear): number {
  const draftYear = season - Math.max(0, Math.floor(age0) - 18);
  return slotProspect(p, g, { year: draftYear, pick }, season).pMake;
}

/**
 * Undrafted fallback (params.prospect.undrafted, fitted on the repo's
 * history by scripts/fit-undrafted-prospects.ts): an undrafted player with
 * no research record and no NHL role, in an NHL organisation, under 20 NHL
 * games (segment.ts). P(make it) by his age on Oct 1 (a 22-year-old signing
 * is worth more than a 26-year-old one, as the no-arrival decay does for
 * draft picks), never above the draft-slot model's for a late-round pick
 * (`capPick`) of his age (verifier 2026-09-28: the fitted odds, 0.15-0.34
 * at 20-26, put undrafted AHL players above real 2nd-round picks of their
 * age, 0.03-0.06, and inside Slapshot's roster line); the prime FP/G of the
 * undrafted skaters who made it, and his first regular season after the
 * median lag at his age. Null without the params block.
 */
export function undraftedProspect(p: DynastyParams, g: Group, age0: number, season = p.firstSeasonYear): ProspectModel | null {
  const u = p.prospect.undrafted;
  if (!u) return null;
  let pMake = Math.max(0, Math.min(1, interpPairs(u.pMake[g], age0)));
  if (u.capPick != null) pMake = Math.min(pMake, lateSlotPMake(p, g, age0, u.capPick, season));
  const lag = Math.max(0, Math.round(interpPairs(u.etaLag, age0)));
  const pi = g === "G" ? { ...p.prospect.slotPrime.G } : { ...u.prime[g] };
  return { pMake, pi, eta: season + lag };
}

/** From a frozen research record. */
export function recordProspect(r: ProspectRecord): ProspectModel {
  return { pMake: r.pMake, pi: { mu: r.fpgIfMake.mu, sd: r.fpgIfMake.sd }, eta: r.eta ?? 2028 };
}
