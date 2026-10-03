/**
 * Walk-forward check of the prospect model's parts (NHLe v2 vs the
 * committed draft-slot route): at each start year Y0, the model fitted on
 * what was known before Y0 (scripts/dynasty-prospect-fit.ts) and the slot
 * route (src/lib/dynasty/prospect.ts slotProspect, the params in
 * src/data/dynasty/params.json) both predict, for every drafted skater of
 * classes Y0 − 6 … Y0 under 100 NHL GP and 25:
 *  - P(200 NHL GP by the end of Y0 + 6): AUC, log loss, Σ predicted / Σ made;
 *  - the first season with 10+ NHL GP of those who made it (ETA): mean
 *    error and mean absolute error in seasons (prediction + the arrival
 *    jitter mean, the simulation's expected arrival);
 *  - prime FP/G (ages 24-26, league-1 scoring, 40+ GP, seasons ≤ 2025): MAE.
 * 90 % intervals: cluster bootstrap by player (a draftee appears at up to
 * seven start years; resampling his rows together keeps the intervals
 * honest), 400 replicates. Also by NHL games before the start year (0 and
 * 1-99: the population the earlier research scored from « NHL GP so far »).
 *
 * Sensitivity (the choices tuned on the 2015-2023 backtest, scripts/dynasty-
 * backtest.ts): --l2 <ridge> (2), --pseudo <league-factor pseudo pairs> (30),
 * --shrinkK <NHLe shrinkage pseudo-games> (20) refit every start year with
 * another value.
 *
 * Run: npx tsx scripts/dynasty-prospect-eval.ts --hist <hist.json> --cache <dir> [--years 2013,…,2019]
 *        [--l2 2] [--pseudo 30] [--shrinkK 20]
 */
import { readFileSync } from "fs";
import { join } from "path";
import { predictProspect, prospectFeatures, seasonRows } from "../src/lib/dynasty/nhle";
import { parseParams } from "../src/lib/dynasty/params";
import { slotProspect } from "../src/lib/dynasty/prospect";
import { ageOn, fpgCaptains, lcg, loadHist, loadProspectHistory, q } from "./dynasty-backtest-lib";
import { fitProspectModel } from "./dynasty-prospect-fit";

const args = process.argv.slice(2);
const arg = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const HIST = arg("--hist") ?? process.env.DYNASTY_HIST;
const CACHE = arg("--cache") ?? process.env.DYNASTY_CACHE;
if (!HIST || !CACHE) {
  console.error("dynasty-prospect-eval: --hist <file> and --cache <dir> are required");
  process.exit(2);
}
const YEARS = (arg("--years") ?? "2013,2014,2015,2016,2017,2018,2019").split(",").map(Number);
const num = (k: string) => (arg(k) != null ? Number(arg(k)) : undefined);
const OPTS = { l2: num("--l2"), pseudo: num("--pseudo"), shrinkK: num("--shrinkK") };
const H = loadHist(HIST);
const PH = loadProspectHistory(CACHE);

interface E {
  id: number;
  y0: number;
  nhlBefore: number;
  made: number;
  pNew: number;
  pSlot: number;
  pick: number;
  etaNew: number;
  etaSlot: number;
  arrival: number | null;
  primeNew: number;
  primeSlot: number;
  prime: number | null;
}
const rows: E[] = [];
for (const y0 of YEARS) {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "src", "data", "dynasty", "params.json"), "utf8"));
  raw.firstSeasonYear = y0;
  const p = parseParams(raw);
  const m = fitProspectModel(H, PH, p, y0, OPTS);
  const jit = p.prospect.etaJitter.reduce((a, [d, w]) => a + d * w, 0);
  for (const d of PH.picks) {
    if (d.pos === "G" || d.year < y0 - 6 || d.year > y0 || d.id == null) continue;
    const land = PH.landing.get(d.id);
    if (!land?.birthDate) continue;
    const g = d.pos === "D" ? "D" : "F";
    const age = ageOn(land.birthDate, y0)!;
    if (age >= 25) continue;
    const nhl = seasonRows(land.seasonTotals).filter((r) => r.league === "NHL");
    const before = nhl.filter((r) => r.year < y0).reduce((a, r) => a + r.gp, 0);
    if (before >= 100) continue;
    const made = nhl.filter((r) => r.year <= y0 + 6).reduce((a, r) => a + r.gp, 0) >= 200 ? 1 : 0;
    const arrival = made ? (nhl.filter((r) => r.year >= y0 && r.gp >= 10).map((r) => r.year).sort()[0] ?? null) : null;
    const f = prospectFeatures({ pos: g, pick: d.pick, draftYear: d.year, age, heightIn: d.height ?? land.heightInInches ?? null, seasons: land.seasonTotals }, y0, m.factors, OPTS.shrinkK);
    const pn = predictProspect(m, f, y0, p.prospect.primeFloor[g]);
    const ps = slotProspect(p, g, { year: d.year, pick: d.pick }, y0);
    let prime: number | null = null;
    const hp = H.players[String(d.id)];
    if (made && hp) {
      let num = 0;
      let den = 0;
      for (const [ys, sk] of Object.entries(hp.sk)) {
        const a = ageOn(land.birthDate, Number(ys))!;
        if (a < 23.5 || a >= 26.5 || sk.gp < 20) continue;
        num += fpgCaptains(p, g, Number(ys), sk) * sk.gp;
        den += sk.gp;
      }
      if (den >= 40) prime = num / den;
    }
    rows.push({ id: d.id, y0, nhlBefore: before, pick: d.pick, made, pNew: pn.pMake, pSlot: ps.pMake, etaNew: pn.eta + jit, etaSlot: ps.eta + jit, arrival, primeNew: pn.pi.mu, primeSlot: ps.pi.mu, prime });
  }
}

function auc(p: number[], y: number[]): number {
  const idx = p.map((x, i) => [x, y[i]!] as const).sort((a, b) => a[0] - b[0]);
  let rank = 0;
  let sumPos = 0;
  let nPos = 0;
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (idx[k]![1]) {
      sumPos += r;
      nPos++;
    }
    rank = j + 1;
    i = j + 1;
  }
  const nNeg = rank - nPos;
  return nPos && nNeg ? (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg) : 0.5;
}
const ll = (p: number[], y: number[]) => -p.reduce((a, x, i) => a + (y[i] ? Math.log(Math.max(1e-6, x)) : Math.log(Math.max(1e-6, 1 - x))), 0) / p.length;
type Stat = (rs: E[]) => number;
const stats: Record<string, Stat> = {
  "AUC new": (rs) => auc(rs.map((r) => r.pNew), rs.map((r) => r.made)),
  "AUC slot": (rs) => auc(rs.map((r) => r.pSlot), rs.map((r) => r.made)),
  /** NHL games so far (draft slot as tie-break): the « NHL GP so far » signal alone. */
  "AUC nhlGP": (rs) => auc(rs.map((r) => Math.log1p(r.nhlBefore) - 1e-3 * Math.log(r.pick)), rs.map((r) => r.made)),
  "logloss new": (rs) => ll(rs.map((r) => r.pNew), rs.map((r) => r.made)),
  "logloss slot": (rs) => ll(rs.map((r) => r.pSlot), rs.map((r) => r.made)),
  "Σp/Σmade new": (rs) => rs.reduce((a, r) => a + r.pNew, 0) / Math.max(1, rs.reduce((a, r) => a + r.made, 0)),
  "Σp/Σmade slot": (rs) => rs.reduce((a, r) => a + r.pSlot, 0) / Math.max(1, rs.reduce((a, r) => a + r.made, 0)),
  "ETA bias new": (rs) => mean(rs.filter((r) => r.arrival != null).map((r) => r.etaNew - r.arrival!)),
  "ETA bias slot": (rs) => mean(rs.filter((r) => r.arrival != null).map((r) => r.etaSlot - r.arrival!)),
  "ETA MAE new": (rs) => mean(rs.filter((r) => r.arrival != null).map((r) => Math.abs(r.etaNew - r.arrival!))),
  "ETA MAE slot": (rs) => mean(rs.filter((r) => r.arrival != null).map((r) => Math.abs(r.etaSlot - r.arrival!))),
  "prime MAE new": (rs) => mean(rs.filter((r) => r.prime != null).map((r) => Math.abs(r.primeNew - r.prime!))),
  "prime MAE slot": (rs) => mean(rs.filter((r) => r.prime != null).map((r) => Math.abs(r.primeSlot - r.prime!))),
};
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0;
}
const rnd = lcg(42);
const clusters = [...Map.groupBy(rows, (r) => r.id).values()];
const players = clusters.length;
/** Cluster bootstrap: draw players with replacement, keep all their start-year rows. */
const resample = (): E[] => {
  const out: E[] = [];
  for (let i = 0; i < players; i++) out.push(...clusters[Math.floor(rnd() * players)]!);
  return out;
};
const reps = Array.from({ length: 400 }, resample);
console.log(`prospects ${rows.length} rows, ${players} players (made ${rows.filter((r) => r.made).length}), start years ${YEARS.join(",")}${Object.values(OPTS).some((v) => v != null) ? `, options ${JSON.stringify(OPTS)}` : ""}`);
const groups: Array<[string, (r: E) => boolean]> = [
  ["all", () => true],
  ["0 NHL GP", (r) => r.nhlBefore === 0],
  ["1-99 NHL GP", (r) => r.nhlBefore > 0],
];
for (const [g, keep] of groups) {
  const sub = rows.filter(keep);
  console.log(`
-- ${g}: ${sub.length} rows, made ${sub.filter((r) => r.made).length}`);
  for (const [name, f] of Object.entries(stats)) {
    if (g !== "all" && !/^(AUC|logloss|Σp)/.test(name)) continue;
    const bs = reps.map((rs) => f(rs.filter(keep)));
    console.log(`${name.padEnd(16)} ${f(sub).toFixed(3)}  90% [${q(bs, 0.05).toFixed(3)}, ${q(bs, 0.95).toFixed(3)}]`);
  }
  // paired difference new − slot on the same replicates
  for (const [a, b] of [["AUC new", "AUC slot"], ["logloss new", "logloss slot"]] as const) {
    const ds = reps.map((rs) => {
      const x = rs.filter(keep);
      return stats[a]!(x) - stats[b]!(x);
    });
    console.log(`Δ ${a.split(" ")[0]} new − slot`.padEnd(16) + ` ${(stats[a]!(sub) - stats[b]!(sub)).toFixed(3)}  90% [${q(ds, 0.05).toFixed(3)}, ${q(ds, 0.95).toFixed(3)}]`);
  }
}
