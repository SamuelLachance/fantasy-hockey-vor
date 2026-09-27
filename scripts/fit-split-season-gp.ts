/**
 * Fit the split-season GP rule (src/lib/split-season-gp.ts) on history and
 * write src/data/ml/split-season-gp.json with its walk-forward backtest.
 *
 * Sample: every skater season t, 2008-09 → 2024-25, whose season t was a
 * split season (NHL games plus SPLIT_SEASON_MIN_OTHER_GAMES+ club games in
 * another league) or an away season (no NHL game in t, that many club games
 * elsewhere, NHL games in t-1 or t-2), with his NHL games in t+1 scaled to
 * 82 (0 when he played none) as the target. NHL games come from the game
 * logs (src/data/ml/durability.json, every NHL player since 2005-06), the
 * other leagues, TOI, birth date and draft from src/data/league-seasons.json
 * (`npm run collect:leagues`): the same files the rule reads at inference.
 *
 * Model: weighted ridge (λ = 1 on standardized features, recency weight
 * e^(−RECENCY · seasons back)), one per kind. The 2012-13 and 2020-21
 * seasons are left out (EXCLUDED_SEASONS). Each model also carries the
 * probit scale of its walk-forward errors (`roleSd`: P(ROLE_GP+ games) =
 * Φ((prediction − ROLE_GP) / roleSd)), which the dynasty route reads.
 *
 * Backtest, walk-forward (train on seasons before the test season), against
 *  - "pipeline": the current pipeline, emulated: its v2 model GP is a ridge on
 *    the GP signals the v2 heads see (market GP, lag-1, EWMA, game-log
 *    availability, age, draft, TOI, career) fitted on the committed board's
 *    modelGamesPlayed, then the committed isotonic curve (players.json
 *    gpCalibration); skaters without a 10-game season take the contextual
 *    path's 10 → curve;
 *  - "lag1": his NHL games of the season (the injury reading).
 *
 * Run: npm run gp:split-fit [-- --dry] (--dry: report only, nothing written)
 */
import { readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { SPLIT_SEASON_MIN_OTHER_GAMES } from "../src/lib/split-season";
import { predictIsotonic, type IsotonicPoint } from "../src/lib/gp-calibration";
import { loadLeagueSeasonsSync } from "../src/lib/league-seasons";
import {
  durabilityKey,
  loadDurabilityRegistrySync,
  type DurabilityRecord,
} from "../src/lib/ml/gamelog-durability";
import {
  featureVector,
  predictLinearGp,
  ROLE_GP,
  scheduledGames,
  SPLIT_SEASON_GP_PATH,
  splitSeasonInput,
  type LinearGpModel,
  type SplitFeatureName,
  type SplitKind,
  type SplitSeasonGpParams,
  type SplitSeasonInput,
  type SplitSeasonSources,
} from "../src/lib/split-season-gp";
import { loadMoneyPuckSkaterRegistrySync, skaterSeasonKey } from "../src/lib/moneypuck-skaters";
import { normalCdf } from "../src/lib/fantrax/draft";
import type { ProjectionsDataset } from "../src/lib/types";

const FIRST_PROJECTION = 20092010; // t = 2008-09 (TOI and game logs complete)
const LAST_PROJECTION = 20252026; // t = 2024-25, t+1 = 2025-26
const FIRST_TEST = 20152016;
const LAMBDA = 1;
/**
 * Recency decay per season back, as the v2 meta (0.3 and 0.6 backtest the
 * same: the next-season games of split seasons hold at ~20-26 every season
 * but 2012-13).
 */
const RECENCY = Number(process.env.SPLIT_RECENCY ?? 0.15);
/**
 * Seasons whose splits are not call-ups: the 2012-13 lockout sent young
 * regulars to the AHL until January, and in the fall of 2020 many were loaned
 * to European clubs before a 56-game season.
 */
const EXCLUDED_SEASONS = new Set([20122013, 20202021]);
const FLOOR = 0;
const CEILING = 80;
/**
 * Predictions from here up realize a plateau: the linear rule keeps rising
 * with pedigree while games cannot pass ~70 on average for a player coming
 * off a split season, so the rule's ceiling is the realized mean of its
 * walk-forward predictions at TOP_BAND+ (≥ 30 of them).
 */
const TOP_BAND = 60;

const SPECS: Record<SplitKind, SplitFeatureName[]> = {
  split: [
    "nhlShare",
    "toi",
    "isD",
    "toiD",
    "finished",
    "finishedToi",
    "finishedShare",
    "age",
    "ageOver24",
    "draftLog",
    "undrafted",
    "college",
    "chl",
    "europe",
    "career",
    "debut",
    "gameScorePg",
    "prospectFinished",
    "prospectAge",
    "prospectDraftLog",
    "prospectToi",
    "finishedYouth",
    "youthDraftLog",
    "prospectSentBack",
    "prospectSentBackYouth",
  ],
  away: ["nhlShare", "toi", "isD", "age", "ageOver24", "draftLog", "undrafted", "europe", "career", "twoAway", "gameScorePg"],
};

// ---------------------------------------------------------------------------
// Data

const durability = loadDurabilityRegistrySync();
const leagues = loadLeagueSeasonsSync();
if (!durability || !leagues) {
  console.error("Needs src/data/ml/durability.json and src/data/league-seasons.json (npm run collect:leagues)");
  process.exit(1);
}
const moneypuck = loadMoneyPuckSkaterRegistrySync();
const sources: SplitSeasonSources = {
  durability: (id, s) => durability.byKey[durabilityKey(id, s)],
  leagues: (id) => leagues.players[String(id)],
  moneypuck: (id, s) => moneypuck?.byKey[skaterSeasonKey(id, s)],
};
const byPlayer = new Map<number, Map<number, DurabilityRecord>>();
for (const [key, rec] of Object.entries(durability.byKey)) {
  const [id, s] = key.split(":").map(Number);
  const m = byPlayer.get(id) ?? new Map<number, DurabilityRecord>();
  m.set(s, rec);
  byPlayer.set(id, m);
}

interface Sample {
  id: number;
  projectionSeasonId: number;
  x: SplitSeasonInput;
  y: number;
  pipeline: number;
}

// ---------------------------------------------------------------------------
// Ridge

function solve(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    [M[c], M[piv]] = [M[piv]!, M[c]!];
    const d = M[c]![c]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let j = c; j <= n; j++) M[c]![j]! /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]!;
      if (f === 0) continue;
      for (let j = c; j <= n; j++) M[r]![j]! -= f * M[c]![j]!;
    }
  }
  return M.map((r) => r[n]!);
}

/** Weighted ridge on standardized columns; returns [intercept, ...slopes]. */
function fitRidge(X: number[][], y: number[], w: number[], lambda = LAMBDA): number[] {
  const n = X.length;
  const p = X[0]!.length;
  const sw = w.reduce((a, b) => a + b, 0);
  const mu = new Array<number>(p).fill(0);
  const sd = new Array<number>(p).fill(0);
  for (let j = 0; j < p; j++) for (let i = 0; i < n; i++) mu[j]! += (w[i]! * X[i]![j]!) / sw;
  for (let j = 0; j < p; j++) {
    for (let i = 0; i < n; i++) sd[j]! += (w[i]! * (X[i]![j]! - mu[j]!) ** 2) / sw;
    sd[j] = Math.sqrt(sd[j]!) || 1;
  }
  const ym = y.reduce((s, v, i) => s + w[i]! * v, 0) / sw;
  const A = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const b = new Array<number>(p).fill(0);
  for (let i = 0; i < n; i++) {
    const z = X[i]!.map((v, j) => (v - mu[j]!) / sd[j]!);
    for (let j = 0; j < p; j++) {
      b[j]! += w[i]! * z[j]! * (y[i]! - ym);
      for (let k = 0; k < p; k++) A[j]![k]! += w[i]! * z[j]! * z[k]!;
    }
  }
  for (let j = 0; j < p; j++) A[j]![j]! += lambda;
  const beta = solve(A, b).map((v, j) => v / sd[j]!);
  return [ym - beta.reduce((s, v, j) => s + v * mu[j]!, 0), ...beta];
}

const recency = (projectionSeasonId: number, anchor: number) =>
  Math.exp(-RECENCY * ((anchor - projectionSeasonId) / 10001));

function fitModel(kind: SplitKind, rows: Sample[], anchor: number): LinearGpModel {
  const withFinish = rows.filter((r) => r.x.finished != null);
  const finishedMean =
    withFinish.length > 0 ? withFinish.filter((r) => r.x.finished).length / withFinish.length : 0.5;
  const mpGames = rows.reduce((s, r) => s + r.x.mpGames, 0);
  const gameScorePrior = mpGames > 0 ? rows.reduce((s, r) => s + r.x.gameScore, 0) / mpGames : 0;
  const base: LinearGpModel = {
    features: SPECS[kind],
    intercept: 0,
    coef: [],
    finishedMean,
    gameScorePrior,
    floor: FLOOR,
    ceiling: CEILING,
  };
  const coef = fitRidge(
    rows.map((r) => featureVector(base, r.x)),
    rows.map((r) => r.y),
    rows.map((r) => recency(r.projectionSeasonId, anchor)),
  );
  return { ...base, intercept: coef[0]!, coef: coef.slice(1) };
}

// ---------------------------------------------------------------------------
// The current pipeline, emulated (see the header)

const players = JSON.parse(
  readFileSync(join(process.cwd(), "src", "data", "players.json"), "utf8"),
) as ProjectionsDataset;
const curve: IsotonicPoint[] = (players.gpCalibration?.skaterCurve ?? []) as IsotonicPoint[];

interface GpSignals {
  eligible: number;
  lag1: number;
  marketGp: number;
  durSig: number;
}

/** The v2 GP signals of a player whose last NHL season is `lastNhl`. */
function gpSignals(id: number, lastNhl: number): GpSignals {
  const seasons = [...(byPlayer.get(id) ?? new Map<number, DurabilityRecord>()).entries()]
    .filter(([s]) => s <= lastNhl)
    .sort((a, b) => a[0] - b[0]);
  const elig = seasons
    .filter(([, r]) => r.played >= 10)
    .map(([s, r]) => Math.min(82, (r.played * 82) / scheduledGames(s)));
  const last3 = elig.slice(-3);
  const lag1 = last3.length ? last3[last3.length - 1]! : 60;
  const wts = [0.5, 0.3, 0.2];
  let ew = 0;
  let ws = 0;
  for (let i = 0; i < last3.length; i++) {
    ew += last3[last3.length - 1 - i]! * wts[i]!;
    ws += wts[i]!;
  }
  const ewma = ws ? ew / ws : lag1;
  const mean3 = last3.length ? last3.reduce((a, b) => a + b, 0) / last3.length : 60;
  const marketGp = last3.length ? Math.min(82, 0.55 * ewma + 0.3 * lag1 + 0.15 * mean3) : 60;
  // dataset-view durabilityGpSignal, without its late-rest adjustment
  let winSum = 0;
  let teamSum = 0;
  let playedSum = 0;
  let w = 1;
  const recs = seasons.map(([, r]) => r);
  for (let i = recs.length - 1; i >= 0 && recs.length - i <= 5; i--) {
    const d = recs[i]!;
    if (d.teamGames > 0) {
      winSum += w * d.window;
      teamSum += w * d.teamGames;
      playedSum += w * d.played;
    }
    w *= 0.75;
  }
  let durSig = marketGp;
  if (teamSum > 0) {
    durSig = 82 * ((winSum + 0.94 * 30) / (teamSum + 30)) * ((playedSum + 0.95 * 30) / (winSum + 30));
    const d = recs[recs.length - 1];
    if (d && (d.fullSeason === 1 || (d.streak >= 40 && d.tail === 0))) {
      const iron = Math.min(1, d.streak / 82);
      durSig = durSig * (1 - 0.25 * iron) + 81 * 0.25 * iron;
    }
    durSig = Math.max(10, Math.min(82, durSig));
  }
  return { eligible: elig.length, lag1, marketGp, durSig };
}

function emulatorRow(sig: GpSignals, x: SplitSeasonInput): number[] {
  const young = sig.eligible <= 2 ? 1 : 0;
  return [
    sig.marketGp,
    sig.lag1,
    sig.durSig,
    young,
    young * sig.marketGp,
    x.age,
    x.age * x.age,
    Math.log(x.draftPick ?? 300),
    x.toiMinutes,
    x.isDefense ? 1 : 0,
    Math.min(x.careerGpBefore, 400) / 100,
    x.nhlGp82,
  ];
}

const lastNhlOf = (x: SplitSeasonInput) => x.seasonId - x.seasonsAway * 10001;

// Fit on the committed board: 2025-26 split / away skaters and every other
// v2 skater with 2025-26 NHL games (their signals, as-if inputs).
const emuX: number[][] = [];
const emuY: number[] = [];
const emuSplit: Array<{ row: number[]; model: number }> = [];
for (const p of players.players) {
  if (p.isGoalie || p.projectionMethod !== "ml" || p.modelGamesPlayed == null) continue;
  const lp = leagues.players[String(p.id)];
  if (!lp) continue;
  const x = splitSeasonInput(p.id, 20262027, sources);
  const probe: SplitSeasonInput =
    x ??
    ({
      kind: "split",
      seasonId: 20252026,
      isDefense: lp.pos === "D",
      age: 0,
      draftPick: lp.draft,
      nhlGp82: 0,
      toiMinutes: 0,
      otherGames: 0,
      league: "ahl",
      finished: null,
      careerGpBefore: 0,
      seasonsAway: 0,
      gameScore: 0,
      mpGames: 0,
    } satisfies SplitSeasonInput);
  if (!x) {
    const rec = durability.byKey[durabilityKey(p.id, 20252026)];
    const line = lp.seasons.find((l) => l[0] === 20252026 && l[1] === "NHL");
    const birth = /^(\d{4})-(\d{2})-(\d{2})/.exec(lp.birth);
    if (!rec || !line || !birth) continue;
    probe.age = (Date.UTC(2026, 9, 1) - Date.UTC(+birth[1]!, +birth[2]! - 1, +birth[3]!)) / (365.25 * 86_400_000);
    probe.nhlGp82 = Math.min(82, rec.played);
    probe.toiMinutes = (line[3] ?? 0) / 60;
    probe.careerGpBefore = lp.seasons.filter((l) => l[1] === "NHL" && l[0] < 20252026).reduce((s, l) => s + l[2], 0);
  }
  const sig = gpSignals(p.id, lastNhlOf(probe));
  if (sig.eligible === 0) continue;
  const row = emulatorRow(sig, probe);
  emuX.push(row);
  emuY.push(p.modelGamesPlayed);
  if (x) emuSplit.push({ row, model: p.modelGamesPlayed });
}
const emuCoef = fitRidge(emuX, emuY, emuY.map(() => 1));
const emuPredict = (row: number[]) => emuCoef[0]! + row.reduce((s, v, j) => s + v * emuCoef[j + 1]!, 0);
const published = (model: number) =>
  Math.max(1, Math.min(80, Math.round(curve.length ? predictIsotonic(curve, model) : model)));

function pipelineGp(id: number, x: SplitSeasonInput): number {
  const sig = gpSignals(id, lastNhlOf(x));
  if (sig.eligible === 0) return published(10);
  return published(Math.max(10, Math.min(82, emuPredict(emulatorRow(sig, x)))));
}

// ---------------------------------------------------------------------------
// Samples

const samples: Sample[] = [];
for (const idStr of Object.keys(leagues.players)) {
  const id = Number(idStr);
  for (let proj = FIRST_PROJECTION; proj <= LAST_PROJECTION; proj += 10001) {
    const x = splitSeasonInput(id, proj, sources);
    if (!x || EXCLUDED_SEASONS.has(x.seasonId)) continue;
    const next = durability.byKey[durabilityKey(id, proj)];
    const y = next ? Math.min(82, (next.played * 82) / scheduledGames(proj)) : 0;
    samples.push({ id, projectionSeasonId: proj, x, y, pipeline: pipelineGp(id, x) });
  }
}

// ---------------------------------------------------------------------------
// Walk-forward backtest

interface Metrics {
  n: number;
  meanActual: number;
  rmse: number;
  mae: number;
  bias: number;
}
function metrics(y: number[], yh: number[]): Metrics {
  const n = y.length;
  let se = 0;
  let ae = 0;
  let e = 0;
  for (let i = 0; i < n; i++) {
    const d = yh[i]! - y[i]!;
    se += d * d;
    ae += Math.abs(d);
    e += d;
  }
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    n,
    meanActual: r(y.reduce((a, b) => a + b, 0) / Math.max(1, n)),
    rmse: r(Math.sqrt(se / Math.max(1, n))),
    mae: r(ae / Math.max(1, n)),
    bias: r(e / Math.max(1, n)),
  };
}

const SEGMENTS: Record<string, (s: Sample) => boolean> = {
  all: () => true,
  "finished the season in the NHL": (s) => s.x.finished === true,
  "sent down / out before the end": (s) => s.x.finished === false,
  "debut after NCAA / CHL / Europe": (s) => s.x.careerGpBefore === 0 && s.x.league !== "ahl",
  "…and finished in the NHL at 16+ min (Hutson-like)": (s) =>
    s.x.careerGpBefore === 0 && s.x.league !== "ahl" && s.x.finished === true && s.x.toiMinutes >= 16,
  "…and sent back before the end": (s) =>
    s.x.careerGpBefore === 0 && s.x.league !== "ahl" && s.x.finished === false,
  "…sent back, drafted top 20 (Brady Martin-like)": (s) =>
    s.x.careerGpBefore === 0 && s.x.league !== "ahl" && s.x.finished === false && (s.x.draftPick ?? 999) <= 20,
  "AHL / ECHL call-up": (s) => s.x.league === "ahl",
  "NHL games < 10": (s) => s.x.nhlGp82 < 10,
  "NHL games 40+": (s) => s.x.nhlGp82 >= 40,
  "age ≤ 22": (s) => s.x.age < 23,
  "age 28+": (s) => s.x.age >= 28,
};

function walkForward(kind: SplitKind) {
  const rows = samples.filter((s) => s.x.kind === kind);
  const tested: Array<Sample & { rule: number }> = [];
  for (let test = FIRST_TEST; test <= LAST_PROJECTION; test += 10001) {
    const train = rows.filter((s) => s.projectionSeasonId < test);
    const tst = rows.filter((s) => s.projectionSeasonId === test);
    if (tst.length === 0 || train.length < 50) continue;
    const model = fitModel(kind, train, test);
    for (const s of tst) tested.push({ ...s, rule: predictLinearGp(model, s.x) });
  }
  const top = tested.filter((s) => s.rule >= TOP_BAND);
  const ceiling =
    top.length >= 30
      ? Math.min(CEILING, Math.round(top.reduce((a, s) => a + s.y, 0) / top.length))
      : CEILING;
  const capped = tested.map((s) => ({ ...s, raw: s.rule, rule: Math.min(ceiling, s.rule) }));
  const out: Record<string, { rule: Metrics; pipeline: Metrics; lag1: Metrics }> = {};
  for (const [name, pred] of Object.entries(SEGMENTS)) {
    const sub = capped.filter(pred);
    if (sub.length < 10) continue;
    const y = sub.map((s) => s.y);
    out[name] = {
      rule: metrics(y, sub.map((s) => s.rule)),
      pipeline: metrics(y, sub.map((s) => s.pipeline)),
      lag1: metrics(y, sub.map((s) => s.x.nhlGp82)),
    };
  }
  // Calibration: realized games per band of the rule's raw prediction.
  const bands: Array<{ band: string; n: number; predicted: number; actual: number }> = [];
  for (let lo = 0; lo < 80; lo += 10) {
    const sub = capped.filter((s) => s.raw >= lo && (lo === 70 ? s.raw <= 80 : s.raw < lo + 10));
    if (sub.length === 0) continue;
    const mean = (a: number[]) => Math.round((a.reduce((x, v) => x + v, 0) / a.length) * 10) / 10;
    bands.push({ band: `${lo}-${lo + 10}`, n: sub.length, predicted: mean(sub.map((s) => s.raw)), actual: mean(sub.map((s) => s.y)) });
  }
  return { segments: out, calibration: bands, ceiling, roleSd: fitRoleSd(capped), roleShares: roleShares(capped) };
}

/**
 * Probit scale of the realized games around the prediction: the s that
 * maximizes the likelihood of "played ROLE_GP+ games" under
 * P = Φ((prediction − ROLE_GP) / s), on a 0.5-GP grid.
 */
function fitRoleSd(rows: Array<{ rule: number; y: number }>): number {
  let best = { s: 20, ll: -Infinity };
  for (let s = 5; s <= 50; s += 0.5) {
    let ll = 0;
    for (const r of rows) {
      const q = Math.min(1 - 1e-6, Math.max(1e-6, normalCdf((r.rule - ROLE_GP) / s)));
      ll += r.y >= ROLE_GP ? Math.log(q) : Math.log(1 - q);
    }
    if (ll > best.ll) best = { s, ll };
  }
  return best.s;
}

/** Realized share of ROLE_GP+ seasons per 10-game band of the prediction (reported). */
function roleShares(rows: Array<{ rule: number; y: number }>) {
  const out: Array<{ band: string; n: number; share: number }> = [];
  for (let lo = 0; lo < 80; lo += 10) {
    const sub = rows.filter((r) => r.rule >= lo && r.rule < lo + 10);
    if (sub.length === 0) continue;
    out.push({ band: `${lo}-${lo + 10}`, n: sub.length, share: Math.round((sub.filter((r) => r.y >= ROLE_GP).length / sub.length) * 100) / 100 });
  }
  return out;
}

const fmt = (m: Metrics) =>
  `n ${String(m.n).padStart(4)} actual ${m.meanActual.toFixed(1).padStart(5)} | RMSE ${m.rmse.toFixed(1).padStart(5)} MAE ${m.mae.toFixed(1).padStart(5)} bias ${m.bias.toFixed(1).padStart(6)}`;

const backtest: Record<string, unknown> = {
  method: `walk-forward, test seasons ${FIRST_TEST} → ${LAST_PROJECTION} (trained on earlier seasons); target = next-season NHL games scaled to 82`,
  pipelineEmulator: {
    note: "v2 model GP emulated by a ridge on its GP signals, fitted on the committed board's modelGamesPlayed, then the committed isotonic curve",
    boardFit: metrics(emuY, emuX.map(emuPredict)),
    splitSkatersFit: metrics(emuSplit.map((r) => r.model), emuSplit.map((r) => emuPredict(r.row))),
  },
};
const ceilings: Record<SplitKind, number> = { split: CEILING, away: CEILING };
const roleSds: Record<SplitKind, number> = { split: 22, away: 22 };
for (const kind of ["split", "away"] as const) {
  const res = walkForward(kind);
  backtest[kind] = res;
  console.log(`\n== ${kind} seasons (walk-forward)`);
  for (const [seg, m] of Object.entries(res.segments)) {
    console.log(`${seg}`);
    console.log(`   rule     ${fmt(m.rule)}`);
    console.log(`   pipeline ${fmt(m.pipeline)}`);
    console.log(`   lag-1    ${fmt(m.lag1)}`);
  }
  console.log(
    `calibration (raw predicted band: n, mean predicted → realized): ${res.calibration.map((b) => `${b.band}: ${b.n}, ${b.predicted} → ${b.actual}`).join(" · ")}; ceiling ${res.ceiling}`,
  );
  console.log(
    `P(${ROLE_GP}+ games) per predicted band: ${res.roleShares.map((b) => `${b.band}: ${b.share} (n ${b.n})`).join(" · ")}; probit scale ${res.roleSd}`,
  );
  ceilings[kind] = res.ceiling;
  roleSds[kind] = res.roleSd;
}
const emu = backtest.pipelineEmulator as { boardFit: Metrics; splitSkatersFit: Metrics };
console.log(
  `\nPipeline emulator: model-GP RMSE ${emu.boardFit.rmse} on the board (n ${emu.boardFit.n}), ${emu.splitSkatersFit.rmse} on its split / away skaters (n ${emu.splitSkatersFit.n})`,
);

// ---------------------------------------------------------------------------
// Final fit on every season, recency-weighted toward the projected season

const anchor = LAST_PROJECTION + 10001;
const params: SplitSeasonGpParams = {
  version: 1,
  fittedAt: new Date().toISOString(),
  source: `durability.json (${durability.builtAt}) + league-seasons.json (${leagues.builtAt}); ${samples.length} skater seasons ${FIRST_PROJECTION - 10001}→${LAST_PROJECTION - 10001}`,
  minOtherGames: SPLIT_SEASON_MIN_OTHER_GAMES,
  split: { ...fitModel("split", samples.filter((s) => s.x.kind === "split"), anchor), ceiling: ceilings.split, roleSd: roleSds.split },
  away: { ...fitModel("away", samples.filter((s) => s.x.kind === "away"), anchor), ceiling: ceilings.away, roleSd: roleSds.away },
  backtest,
};
const round4 = (m: LinearGpModel): LinearGpModel => ({
  ...m,
  intercept: Math.round(m.intercept * 1e4) / 1e4,
  coef: m.coef.map((c) => Math.round(c * 1e4) / 1e4),
  finishedMean: Math.round(m.finishedMean * 1e4) / 1e4,
  gameScorePrior: Math.round(m.gameScorePrior * 1e4) / 1e4,
});
params.split = round4(params.split);
params.away = round4(params.away);
for (const kind of ["split", "away"] as const) {
  const m = params[kind];
  console.log(
    `\n${kind}: ${samples.filter((s) => s.x.kind === kind).length} seasons; GP = ${m.intercept} ${m.features.map((f, i) => `${m.coef[i]! >= 0 ? "+" : "−"} ${Math.abs(m.coef[i]!)}·${f}`).join(" ")} (clamped ${m.floor}–${m.ceiling})`,
  );
}
if (process.argv.includes("--dry")) {
  console.log("\n--dry: nothing written");
} else {
  writeFileAtomic(SPLIT_SEASON_GP_PATH, `${JSON.stringify(params, null, 2)}\n`);
  console.log(`\nWrote ${SPLIT_SEASON_GP_PATH}`);
}
