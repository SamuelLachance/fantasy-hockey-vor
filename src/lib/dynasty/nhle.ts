/**
 * NHL-equivalency (NHLe) prospect model (dynasty v7, 2026-10-02).
 *
 * The draft slot alone ranks a class (Spearman ~0.3 with what the players
 * later produced); the scoring a prospect posts in junior, college, Europe
 * or the AHL, translated to NHL points per game and read against his age,
 * says much more. This module is pure (no fs): the league translation
 * factors and the fitted coefficients come in as data
 * (src/data/dynasty/prospect-model.json, fitted by
 * scripts/dynasty-fit-prospects.ts on public NHL player landings, walk-forward
 * in the backtest).
 *
 *  - League factors: the season-pair method. For every player with 20+ GP in
 *    league L in season t and 20+ GP in league M in season t + 1, the ratio of
 *    points per game (harmonic-GP weights); L → NHL directly and through one
 *    intermediate league (OHL → AHL → NHL), combined on the log scale by pair
 *    count and shrunk toward a prior table with 30 pseudo-pairs.
 *  - Features at a date (start year Y0, seasons < Y0 only): ln draft pick,
 *    defence, age on Oct 1, completed seasons since the draft, the NHLe
 *    points per game of the last two seasons (games-weighted, shrunk toward
 *    a prior at 30 GP), pro league last season, NHL games so far, height.
 *  - Outputs: P(200 NHL GP within 7 seasons) (logistic), prime FP/G at 25
 *    if he makes it (OLS on the league-1 realized scale) and the expected
 *    first regular season (OLS on the lag), the ProspectModel the
 *    simulation already takes (pMake, prime, ETA).
 */
import type { ProspectModel } from "./prospect";

export interface LandingSeason {
  /** e.g. 20232024 */
  season: number;
  league: string;
  /** 2 regular season, 3 playoffs */
  gt: number;
  gp: number;
  g?: number;
  a?: number;
  p?: number;
  team?: string;
}

/** International tournaments, cups and showcases: never a league season. */
const EXCLUDE =
  /WJC|WHC|Hlinka|^WC|^OG|4 Nations|Cup|Invitational|Tournament|Challenge|Classic|Memorial|International|Spengler|Champions HL|^EHT|YOG|EYOF|CWG|Prospects|TV-Pucken|^WSI|Olymp|OGC|OGQ|WJAC|Macs|JCWC|WCCC|ACC-|Continental|^WJ18|^U-1[78]$|^M-Cup/;

/** Older or alternative labels of the same league. */
const ALIAS: Record<string, string> = {
  Sweden: "SHL",
  SEL: "SHL",
  "Swe-Jr.": "J20 Nationell",
  "J20 SuperElit": "J20 Nationell",
  "Sweden-2": "HockeyAllsvenskan",
  Allsvenskan: "HockeyAllsvenskan",
  Finland: "Liiga",
  SM: "Liiga",
  "SM-liiga": "Liiga",
  "Fin-Jr.": "U20 SM-sarja",
  "U20 SM-liiga": "U20 SM-sarja",
  "Finland-2": "Mestis",
  CzRep: "Czechia",
  "CzRep-Jr.": "Czechia U20",
  Russia: "KHL",
  "Russia-Jr.": "MHL",
  "Russia2": "VHL",
  Swiss: "NL",
  NLA: "NL",
  Germany: "DEL",
  WCHA: "NCAA",
  "H-East": "NCAA",
  ECAC: "NCAA",
  CCHA: "NCAA",
  NCHC: "NCAA",
  "Big Ten": "NCAA",
  "B1G": "NCAA",
  AHA: "NCAA",
  CHA: "NCAA",
  NTDP: "USDP",
  "USNTDP": "USDP",
  EBEL: "ICEHL",
  "Austria": "ICEHL",
};

export const PRO_LEAGUES = new Set(["NHL", "AHL", "KHL", "SHL", "Liiga", "NL", "DEL", "Czechia", "ICEHL", "HockeyAllsvenskan", "VHL", "Mestis", "ECHL", "Slovakia", "EIHL", "DEL2"]);

export function normalizeLeague(label: string): string | null {
  if (!label || EXCLUDE.test(label)) return null;
  return ALIAS[label] ?? label;
}

export interface SeasonRow {
  /** Start year (2023 for 2023-24). */
  year: number;
  league: string;
  gp: number;
  pts: number;
}

/**
 * Regular-season rows per (start year, league), start year < `before`:
 * team rows of the same label summed; labels that alias to one league (a
 * conference row next to the NCAA total) keep the one with the most games.
 */
export function seasonRows(seasons: readonly LandingSeason[], before = Number.POSITIVE_INFINITY): SeasonRow[] {
  const byLabel = new Map<string, { year: number; label: string; league: string; gp: number; pts: number }>();
  for (const s of seasons) {
    if (s.gt !== 2 || !(s.gp > 0)) continue;
    const league = normalizeLeague(s.league);
    if (!league) continue;
    const year = Math.floor(s.season / 10000);
    if (!(year < before)) continue;
    const k = `${year}|${s.league}`;
    const r = byLabel.get(k) ?? { year, label: s.league, league, gp: 0, pts: 0 };
    r.gp += s.gp;
    r.pts += s.p ?? (s.g ?? 0) + (s.a ?? 0);
    byLabel.set(k, r);
  }
  const out = new Map<string, SeasonRow>();
  for (const r of byLabel.values()) {
    const k = `${r.year}|${r.league}`;
    const cur = out.get(k);
    if (!cur || r.gp > cur.gp) out.set(k, { year: r.year, league: r.league, gp: r.gp, pts: r.pts });
  }
  return [...out.values()].sort((a, b) => a.year - b.year || b.gp - a.gp);
}

/** Prior translation factors (public NHLe literature), shrinkage targets. */
export const PRIOR_FACTORS: Record<string, number> = {
  NHL: 1,
  AHL: 0.47,
  KHL: 0.6,
  SHL: 0.55,
  Liiga: 0.45,
  NL: 0.45,
  DEL: 0.4,
  Czechia: 0.4,
  ICEHL: 0.3,
  VHL: 0.3,
  HockeyAllsvenskan: 0.3,
  Mestis: 0.2,
  ECHL: 0.2,
  NCAA: 0.35,
  OHL: 0.27,
  WHL: 0.27,
  QMJHL: 0.24,
  USHL: 0.2,
  USDP: 0.2,
  MHL: 0.16,
  "J20 Nationell": 0.14,
  "U20 SM-sarja": 0.12,
  "Czechia U20": 0.1,
  BCHL: 0.1,
  AJHL: 0.07,
  NAHL: 0.08,
  OJHL: 0.06,
  "USHS-Prep": 0.05,
  "USHS-MN": 0.05,
  Slovakia: 0.25,
};
/** Fallback for youth / minor leagues missing from the fit and the prior. */
const YOUTH = /U1[3-8]|U20|1[3-8]U|AAA|Prep|USHS|Mini|MNHP|HPHL|T1EHL|CSSHL|GTHL|AYHL|NAPHL|ETAHL|Midget|MMHL|QM1|J18|Div\.|High-|Minor|AMBHL|AMHL|QAAA|QMAAA|PW/;
export function fallbackFactor(league: string): number {
  return PRIOR_FACTORS[league] ?? (YOUTH.test(league) ? 0.04 : 0.12);
}

export interface LeagueFactor {
  f: number;
  /** Pairs behind it (direct + chains). */
  n: number;
}
export type LeagueFactors = Record<string, LeagueFactor>;

const CHAIN_VIA = ["AHL", "KHL", "SHL", "Liiga", "NCAA", "NL", "DEL", "Czechia", "HockeyAllsvenskan", "VHL", "OHL", "WHL", "QMJHL", "USHL", "MHL"];

/**
 * Season-pair translation factors from every player's rows, using only
 * pairs whose second season starts before `before` (walk-forward).
 */
export function fitLeagueFactors(players: ReadonlyArray<readonly LandingSeason[]>, before: number, minGp = 20, pseudo = 30): LeagueFactors {
  const acc = new Map<string, { n: number; a: number; b: number }>();
  for (const seasons of players) {
    const rows = seasonRows(seasons, before).filter((r) => r.gp >= minGp);
    const by = new Map<number, SeasonRow[]>();
    for (const r of rows) (by.get(r.year) ?? by.set(r.year, []).get(r.year)!).push(r);
    for (const r of rows) {
      for (const n of by.get(r.year + 1) ?? []) {
        if (n.league === r.league) continue;
        const k = `${r.league}>${n.league}`;
        const w = 2 / (1 / r.gp + 1 / n.gp);
        const e = acc.get(k) ?? { n: 0, a: 0, b: 0 };
        e.n++;
        e.a += (r.pts / r.gp) * w;
        e.b += (n.pts / n.gp) * w;
        acc.set(k, e);
      }
    }
  }
  const pair = (L: string, M: string) => {
    const e = acc.get(`${L}>${M}`);
    return e && e.n >= 8 && e.a > 0 && e.b > 0 ? { f: e.b / e.a, n: e.n } : null;
  };
  const leagues = new Set<string>();
  for (const k of acc.keys()) leagues.add(k.split(">")[0]!);
  const direct = (L: string) => pair(L, "NHL");
  const out: LeagueFactors = { NHL: { f: 1, n: 1e6 } };
  for (const L of leagues) {
    if (L === "NHL") continue;
    const cands: Array<{ f: number; n: number }> = [];
    const d = direct(L);
    if (d) cands.push(d);
    for (const M of CHAIN_VIA) {
      if (M === L) continue;
      const a = pair(L, M);
      const b = direct(M);
      if (a && b) cands.push({ f: a.f * b.f, n: Math.min(a.n, b.n) });
    }
    if (!cands.length) continue;
    const W = cands.reduce((s, c) => s + c.n, 0);
    const lf = cands.reduce((s, c) => s + c.n * Math.log(c.f), 0) / W;
    const prior = Math.log(fallbackFactor(L));
    const w = W / (W + pseudo);
    out[L] = { f: Math.exp(w * lf + (1 - w) * prior), n: W };
  }
  return out;
}

export function factorOf(fs: LeagueFactors, league: string): number {
  return fs[league]?.f ?? fallbackFactor(league);
}

export interface SeasonNhle {
  year: number;
  /** Games outside the NHL. */
  gp: number;
  /** Translated points per game (games-weighted over leagues; NHL games at factor 1). */
  ppg: number;
  pro: boolean;
  nhlGp: number;
}

/** One translated row per start year (every league that season, NHL included, games-weighted). */
export function nhleBySeason(rows: readonly SeasonRow[], fs: LeagueFactors): SeasonNhle[] {
  const by = new Map<number, { gp: number; pts: number; proGp: number; nhlGp: number; minorGp: number }>();
  for (const r of rows) {
    const e = by.get(r.year) ?? { gp: 0, pts: 0, proGp: 0, nhlGp: 0, minorGp: 0 };
    e.gp += r.gp;
    e.pts += r.pts * factorOf(fs, r.league);
    if (PRO_LEAGUES.has(r.league)) e.proGp += r.gp;
    if (r.league === "NHL") e.nhlGp += r.gp;
    else e.minorGp += r.gp;
    by.set(r.year, e);
  }
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, e]) => ({ year, gp: e.minorGp, ppg: e.gp > 0 ? e.pts / e.gp : 0, pro: e.proGp >= e.gp / 2, nhlGp: e.nhlGp }));
}

export interface ProspectFeatureInput {
  pos: "F" | "D";
  pick: number;
  draftYear: number;
  /** Age on Oct 1 of the start year. */
  age: number;
  heightIn: number | null;
  seasons: readonly LandingSeason[];
}

export interface ProspectFeatures {
  lnPick: number;
  d: number;
  age: number;
  ysd: number;
  /** ln NHLe PPG, last season (shrunk toward the prior at `shrinkGp` games). */
  lnNhle1: number;
  /** ln NHLe PPG, the season before. */
  lnNhle2: number;
  pro1: number;
  nhlGp: number;
  /** NHL games last season. */
  nhlGp1: number;
  height: number;
  /** Games behind the last season's NHLe (0: no season). */
  gp1: number;
}

/** Shrinkage of a season's NHLe: toward `prior` PPG with `k` pseudo-games. */
export const NHLE_SHRINK = { k: 20, prior: { F: 0.12, D: 0.07 } } as const;

/** `shrinkK`: pseudo-games of the NHLe shrinkage (NHLE_SHRINK.k; other values only in the sensitivity runs of scripts/dynasty-prospect-eval.ts). */
export function prospectFeatures(x: ProspectFeatureInput, y0: number, fs: LeagueFactors, shrinkK: number = NHLE_SHRINK.k): ProspectFeatures {
  const rows = seasonRows(x.seasons, y0);
  const by = nhleBySeason(rows, fs);
  const prior = NHLE_SHRINK.prior[x.pos];
  const at = (y: number) => {
    const s = by.find((r) => r.year === y);
    const gp = s ? s.gp + s.nhlGp : 0;
    const ppg = s ? s.ppg : prior;
    return { ln: Math.log(Math.max(0.01, (ppg * gp + prior * shrinkK) / (gp + shrinkK))), gp, pro: s?.pro ? 1 : 0 };
  };
  const s1 = at(y0 - 1);
  const s2 = at(y0 - 2);
  const nhlGp = by.reduce((a, r) => a + r.nhlGp, 0);
  return {
    lnPick: Math.log(Math.max(1, x.pick)),
    d: x.pos === "D" ? 1 : 0,
    age: x.age,
    ysd: Math.max(0, y0 - x.draftYear),
    lnNhle1: s1.ln,
    lnNhle2: s2.ln,
    pro1: s1.pro,
    nhlGp: Math.min(100, nhlGp),
    nhlGp1: by.find((r) => r.year === y0 - 1)?.nhlGp ?? 0,
    height: x.heightIn ?? 73,
    gp1: s1.gp,
  };
}

/** Design vector of the make-it logistic (and the prime / lag regressions). */
export function design(f: ProspectFeatures): number[] {
  const ageC = f.age - 19.5;
  return [
    1,
    f.lnPick,
    f.d,
    ageC,
    f.lnNhle1,
    f.lnNhle2,
    f.lnNhle1 * ageC,
    f.pro1,
    Math.log1p(f.nhlGp),
    Math.log1p(f.nhlGp1),
    (f.height - 73) / 2,
    Math.min(f.ysd, 6),
    f.d * f.lnNhle1,
  ];
}
export const DESIGN_NAMES = ["1", "lnPick", "D", "age-19.5", "lnNHLe1", "lnNHLe2", "lnNHLe1*age", "pro1", "ln(1+nhlGp)", "ln(1+nhlGp1)", "height", "ysd", "D*lnNHLe1"];

export interface ProspectModelV2 {
  version: string;
  /** Logistic coefficients (design()). */
  make: number[];
  /** Prime FP/G at 25 if he makes it: OLS coefficients and residual sd. */
  prime: { coef: number[]; sd: number };
  /** Lag (start years) from the date to the first regular season if he makes it. */
  lag: { coef: number[]; min: number; max: number };
  factors: LeagueFactors;
  /** Odds multiplier on P(make it) (calibration of the simulated value, 1 = none). */
  oddsCal?: number;
}

const sig = (z: number) => 1 / (1 + Math.exp(-z));
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

/** The simulation's prospect inputs from the v2 model at start year y0. */
export function predictProspect(m: ProspectModelV2, f: ProspectFeatures, y0: number, primeFloor = 0.6): ProspectModel {
  const x = design(f);
  let pMake = sig(dot(x, m.make));
  if (m.oddsCal != null && m.oddsCal !== 1) {
    const o = (pMake / (1 - pMake)) * m.oddsCal;
    pMake = o / (1 + o);
  }
  const mu = Math.max(primeFloor, dot(x, m.prime.coef));
  const lag = Math.min(m.lag.max, Math.max(m.lag.min, Math.round(dot(x, m.lag.coef))));
  return { pMake: Math.min(0.995, Math.max(0.001, pMake)), pi: { mu, sd: m.prime.sd }, eta: y0 + lag };
}

// ------------------------------------------------------------------ fitting (pure)

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let i = 0; i < n; i++) {
    let mx = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r]![i]!) > Math.abs(M[mx]![i]!)) mx = r;
    [M[i], M[mx]] = [M[mx]!, M[i]!];
    const piv = M[i]![i]!;
    if (Math.abs(piv) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r]![i]! / piv;
      if (f === 0) continue;
      for (let c = i; c <= n; c++) M[r]![c]! -= f * M[i]![c]!;
    }
  }
  return M.map((r, i) => (Math.abs(r[i]!) < 1e-12 ? 0 : r[n]! / r[i]!));
}

/** Ridge-penalized logistic regression (Newton), intercept unpenalized. */
export function fitLogistic(X: readonly number[][], y: readonly number[], l2 = 1, w?: readonly number[]): number[] {
  const p = X[0]!.length;
  let b = new Array<number>(p).fill(0);
  for (let it = 0; it < 60; it++) {
    const g = new Array<number>(p).fill(0);
    const H = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    for (let i = 0; i < X.length; i++) {
      const xi = X[i]!;
      const pr = sig(dot(xi, b));
      const wi = w?.[i] ?? 1;
      const v = wi * pr * (1 - pr);
      for (let k = 0; k < p; k++) {
        g[k]! += wi * (y[i]! - pr) * xi[k]!;
        for (let l = k; l < p; l++) H[k]![l]! += v * xi[k]! * xi[l]!;
      }
    }
    for (let k = 0; k < p; k++) for (let l = 0; l < k; l++) H[k]![l] = H[l]![k]!;
    for (let k = 1; k < p; k++) {
      g[k]! -= l2 * b[k]!;
      H[k]![k]! += l2;
    }
    const step = solve(H, g);
    b = b.map((x, k) => x + step[k]!);
    if (Math.max(...step.map(Math.abs)) < 1e-7) break;
  }
  return b;
}

/** Ridge OLS (intercept unpenalized); returns coefficients and residual sd. */
export function fitOls(X: readonly number[][], y: readonly number[], l2 = 1, w?: readonly number[]): { coef: number[]; sd: number } {
  const p = X[0]!.length;
  const A = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const b = new Array<number>(p).fill(0);
  let W = 0;
  for (let i = 0; i < X.length; i++) {
    const wi = w?.[i] ?? 1;
    W += wi;
    for (let k = 0; k < p; k++) {
      b[k]! += wi * X[i]![k]! * y[i]!;
      for (let l = 0; l < p; l++) A[k]![l]! += wi * X[i]![k]! * X[i]![l]!;
    }
  }
  for (let k = 1; k < p; k++) A[k]![k]! += l2;
  const coef = solve(A, b);
  let ss = 0;
  for (let i = 0; i < X.length; i++) ss += (w?.[i] ?? 1) * (y[i]! - dot(X[i]!, coef)) ** 2;
  return { coef, sd: Math.sqrt(ss / Math.max(1, W - p)) };
}
