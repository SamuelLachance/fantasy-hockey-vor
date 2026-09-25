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
  pAbsentIfNotRegular(g: "F" | "D", age: number): number;
}

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
      const x = goalieX(age, gsShare, svRelPts);
      const pS = sigmoid(lin(betaS, x));
      const pT = Math.max(pS, sigmoid(lin(betaT, x)));
      const pP = Math.max(pT, sigmoid(lin(betaP, x)));
      return { pS, pT, pP };
    },
    pAbsentIfNotRegular(g, age) {
      const a = clamp(Math.round(age), 19, 40);
      return absent[g].get(a) ?? 0.3;
    },
  };
}
