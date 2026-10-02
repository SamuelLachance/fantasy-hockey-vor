/**
 * Roles from one season to the next (§3.5): P(regular next) for skaters and
 * the goalie role next season (starter / tandem / backup / out, logistics on
 * the raw games-started share), the realized-scale
 * rank ladder that feeds them, and P(absent | not regular) by age.
 */
import type { DynastyParams } from "./params";
import { clamp, sigmoid } from "./rng";

export interface Retention {
  /** Percentile of a realized FP/G on the league ladder (1 = best). */
  levelPct(g: "F" | "D", fpg: number): number;
  pRegularNext(g: "F" | "D", age: number, levelPct: number, gpShare: number): number;
  /** P(starter ≥ 50% of starts next season), on the raw games-started share. */
  pStarterNext(age: number, gsShare: number, svRelPts: number): number;
  /**
   * Goalie role next season, cumulative: P(starter), P(at least a tandem),
   * P(present) (each ≥ the previous), on the raw games-started share.
   */
  goalieRoleNext(age: number, gsShare: number, svRelPts: number): { pS: number; pT: number; pP: number };
  /**
   * P(no NHL game next | not a regular next) by age; with this season's
   * games share, the share × age odds multiplier (params games.roleAbsent:
   * a part-timer is out of the league far more often than his age alone says).
   */
  pAbsentIfNotRegular(g: "F" | "D", age: number, share?: number): number;
  /**
   * After a season with no NHL game: P(regular next) and P(any game next),
   * observed by age (null without the table: the logistics then apply).
   */
  afterZero(age: number): { pRegular: number; pAny: number } | null;
}

/** Index of the band `x` falls in: below cuts[0] → 0, …, at or above the last cut → cuts.length. */
const bandOf = (cuts: readonly number[], x: number) => {
  let i = 0;
  while (i < cuts.length && x >= cuts[i]!) i++;
  return i;
};

export function makeRetention(p: DynastyParams): Retention {
  const absent: Record<"F" | "D", Map<number, number>> = { F: new Map(), D: new Map() };
  for (const g of ["F", "D"] as const) {
    for (const r of p.availability[g]) {
      absent[g].set(r.age, clamp((1 - r.pPresentNext) / Math.max(0.05, 1 - r.pRegularNext), 0, 1));
    }
  }
  const ladder = p.ladder;
  const levelPct = (g: "F" | "D", fpg: number) => {
    const m = ladder[g].rows;
    const N = ladder[g].n;
    let rank: number | null = null;
    if (fpg >= m[0]![1]) rank = 1;
    else {
      for (let i = 1; i < m.length; i++) {
        if (fpg >= m[i]![1]) {
          const [ra, aa] = m[i]!;
          const [rb, ab] = m[i - 1]!;
          rank = ra - ((fpg - aa) / (ab - aa)) * (ra - rb);
          break;
        }
      }
      if (rank == null) {
        const [ra, aa] = m[m.length - 1]!;
        const [rb, ab] = m[m.length - 2]!;
        rank = ra + ((aa - fpg) / (ab - aa)) * (ra - rb);
      }
    }
    return clamp(1 - rank / N, 0, 1);
  };
  const betaR = { F: p.retentionLogistic.F, D: p.retentionLogistic.D };
  const betaS = p.starterLogistic.beta;
  const betaT = p.starterLogistic.tandemBeta;
  const betaP = p.starterLogistic.presentBeta;
  const goalieX = (age: number, gsShare: number, svRelPts: number) => [
    1,
    (age - 29) / 5,
    Math.max(0, age - 32) / 3,
    Math.max(0, age - 35) / 2,
    clamp(gsShare, 0, 1),
    clamp(svRelPts, -30, 30) / 10,
    age <= 25 ? (26 - age) / 3 : 0,
  ];
  const lin = (b: readonly number[], x: readonly number[]) => x.reduce((z, xi, i) => z + xi * b[i]!, 0);
  const ra = p.games.roleAbsent ?? null;
  const low = p.games.goalie.lowShare ?? null;
  return {
    levelPct,
    pRegularNext(g, age, lp, gpShare) {
      const x = [
        1,
        (age - 27) / 5,
        Math.max(0, age - 30) / 5,
        Math.max(0, age - 34) / 3,
        lp,
        lp * lp,
        Math.min(1, gpShare),
        (lp * Math.max(0, age - 30)) / 5,
        age <= 22 ? (23 - age) / 3 : 0,
      ];
      let z = 0;
      for (let i = 0; i < x.length; i++) z += x[i]! * betaR[g][i]!;
      return sigmoid(z);
    },
    pStarterNext(age, gsShare, svRelPts) {
      return sigmoid(lin(betaS, goalieX(age, gsShare, svRelPts)));
    },
    goalieRoleNext(age, gsShare, svRelPts) {
      // after (almost) no starts the observed role odds (the logistics, fitted on
      // every share, keep 76-81 % of these goalies present against 16-51 % observed)
      const x = goalieX(age, gsShare, svRelPts);
      // after (almost) no starts, the observed odds multipliers (the logistics, fitted on
      // every share, kept 75-81 % of these goalies present against 16-51 % observed)
      const cell = low && gsShare < low.maxShare && age < low.maxAge ? (gsShare > 0 ? low.low : low.none) : null;
      const m = cell?.[age < low!.ageCut ? 0 : 1] ?? null;
      const at = (b: readonly number[], k: number) => {
        const z = lin(b, x);
        const mk = m ? (m[k] ?? 1) : 1;
        return mk === 1 ? sigmoid(z) : mk > 0 ? sigmoid(z + Math.log(mk)) : 0;
      };
      const pS = at(betaS, 0);
      const pT = Math.max(pS, at(betaT, 1));
      const pP = Math.max(pT, at(betaP, 2));
      return { pS, pT, pP };
    },
    pAbsentIfNotRegular(g, age, share) {
      const a = clamp(Math.round(age), 19, 40);
      const base = absent[g].get(a) ?? 0.3;
      if (!ra || share == null || !(base > 0 && base < 1)) return base;
      const m = ra.oddsMult[bandOf(ra.shareCuts, share)]?.[bandOf(ra.ageCuts, age)] ?? 1;
      const o = (base / (1 - base)) * m;
      return o / (1 + o);
    },
    afterZero(age) {
      if (!ra) return null;
      const i = bandOf(ra.afterZero.ageCuts, age);
      const pRegular = ra.afterZero.pRegular[i];
      const pAny = ra.afterZero.pAny[i];
      return pRegular == null || pAny == null ? null : { pRegular, pAny: Math.max(pRegular, pAny) };
    },
  };
}
