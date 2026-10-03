/**
 * Fit of the NHLe prospect model (src/lib/dynasty/nhle.ts) at a date: only
 * what was known before start year `y0`.
 *
 * Training rows: every drafted skater with a landing, at every snapshot s
 * from his draft year to draft year + 6 with fewer than 100 NHL GP before s
 * and an age under 25, whose 7-season outcome window s … s + 6 ended before
 * y0 (s ≤ y0 − 7). Features from the seasons before s.
 *  - make: 200+ career NHL GP by the end of s + 6 (NHL rows of the landing);
 *  - lag (makers): first season from s with 10+ NHL GP, minus s, less the
 *    simulation's arrival jitter mean;
 *  - prime (makers): GP-weighted league-1 FP/G at ages 24-26 (seasons with
 *    20+ GP, all before y0, NHL history), each season rescaled to the
 *    scoring level of y0 − 1 (mean FP/G of 40+ GP skaters by group).
 * League factors: season pairs whose second season started before y0.
 */
import { fpgCaptains, ageOn, type Hist, type ProspectHistory } from "./dynasty-backtest-lib";
import { design, fitLeagueFactors, fitLogistic, fitOls, prospectFeatures, seasonRows, type ProspectModelV2 } from "../src/lib/dynasty/nhle";
import type { DynastyParams } from "../src/lib/dynasty/params";

export interface TrainRow {
  id: number;
  s: number;
  x: number[];
  make: number;
  lag: number | null;
  prime: number | null;
}

export function trainingRows(H: Hist, PH: ProspectHistory, p: DynastyParams, y0: number, factors: ProspectModelV2["factors"], shrinkK?: number): TrainRow[] {
  // scoring level per season and group (40+ GP skaters)
  const lvl = new Map<string, number>();
  for (let y = 2008; y < y0; y++) {
    for (const g of ["F", "D"] as const) {
      let a = 0;
      let n = 0;
      for (const pl of Object.values(H.players)) {
        const s = pl.sk[y];
        if (pl.pos !== g || !s || s.gp < 40) continue;
        a += fpgCaptains(p, g, y, s) * s.gp;
        n += s.gp;
      }
      if (n > 0) lvl.set(`${g}${y}`, a / n);
    }
  }
  const out: TrainRow[] = [];
  for (const d of PH.picks) {
    if (d.id == null || d.pos === "G") continue;
    const land = PH.landing.get(d.id);
    if (!land) continue;
    const g = d.pos === "D" ? "D" : "F";
    const birth = land.birthDate ?? null;
    const nhlByYear = new Map<number, number>();
    for (const r of seasonRows(land.seasonTotals)) if (r.league === "NHL") nhlByYear.set(r.year, (nhlByYear.get(r.year) ?? 0) + r.gp);
    const hp = H.players[String(d.id)];
    for (let s = d.year; s <= d.year + 6 && s <= y0 - 7; s++) {
      const age = ageOn(birth, s);
      if (age == null || age >= 25) continue;
      let before = 0;
      for (const [y, gp] of nhlByYear) if (y < s) before += gp;
      if (before >= 100) continue;
      let through = before;
      for (const [y, gp] of nhlByYear) if (y >= s && y <= s + 6) through += gp;
      const make = through >= 200 ? 1 : 0;
      let lag: number | null = null;
      if (make) {
        for (let y = s; y <= s + 6; y++) if ((nhlByYear.get(y) ?? 0) >= 10) {
          lag = y - s;
          break;
        }
      }
      let prime: number | null = null;
      if (make && hp && birth) {
        let num = 0;
        let den = 0;
        for (const [ys, sk] of Object.entries(hp.sk)) {
          const y = Number(ys);
          if (y >= y0 || sk.gp < 20) continue;
          const a = ageOn(birth, y)!;
          if (a < 23.5 || a >= 26.5) continue;
          const ref = lvl.get(`${g}${y0 - 1}`);
          const cur = lvl.get(`${g}${y}`);
          if (!ref || !cur) continue;
          num += fpgCaptains(p, g, y, sk) * (ref / cur) * sk.gp;
          den += sk.gp;
        }
        if (den >= 40) prime = num / den;
      }
      const f = prospectFeatures({ pos: g, pick: d.pick, draftYear: d.year, age, heightIn: d.height ?? land.heightInInches ?? null, seasons: land.seasonTotals }, s, factors, shrinkK);
      out.push({ id: d.id, s, x: design(f), make, lag, prime });
    }
  }
  return out;
}

/**
 * `opts` (defaults: the shipped choices, tuned on the 2015-2023 backtest): l2 ridge of the
 * make-it logistic (prime and lag: 5 × l2), pseudo pairs of the league-factor shrinkage, NHLe
 * shrinkage pseudo-games. Other values only for the sensitivity runs (scripts/dynasty-prospect-eval.ts).
 */
export function fitProspectModel(H: Hist, PH: ProspectHistory, p: DynastyParams, y0: number, opts: { l2?: number; pseudo?: number; shrinkK?: number } = {}): ProspectModelV2 {
  const players = [...PH.landing.values()].map((l) => l.seasonTotals);
  const factors = fitLeagueFactors(players, y0, 20, opts.pseudo ?? 30);
  const rows = trainingRows(H, PH, p, y0, factors, opts.shrinkK);
  const l2 = opts.l2 ?? 2;
  const make = fitLogistic(rows.map((r) => r.x), rows.map((r) => r.make), l2);
  const pr = rows.filter((r) => r.prime != null);
  const prime = fitOls(pr.map((r) => r.x), pr.map((r) => r.prime!), l2 * 5);
  const lr = rows.filter((r) => r.lag != null);
  const lagFit = fitOls(lr.map((r) => r.x), lr.map((r) => r.lag!), l2 * 5);
  const jit = p.prospect.etaJitter.reduce((a, [d, w]) => a + d * w, 0);
  lagFit.coef[0]! -= jit;
  return {
    version: `nhle-v2@${y0}`,
    make,
    prime: { coef: prime.coef, sd: prime.sd },
    lag: { coef: lagFit.coef, min: 0, max: 6 },
    factors,
    oddsCal: 1,
    // diagnostics
    ...({ n: { rows: rows.length, makers: rows.filter((r) => r.make).length, prime: pr.length, lag: lr.length } } as object),
  };
}
