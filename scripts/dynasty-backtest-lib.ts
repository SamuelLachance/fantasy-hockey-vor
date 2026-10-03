/**
 * Shared pieces of the dynasty walk-forward backtests (scripts/dynasty-backtest.ts,
 * scripts/dynasty-fit-prospects.ts): the history files, the point-in-time
 * inputs of a start year Y0 (only seasons < Y0), the realized values in each
 * league's scoring and the scorecard statistics.
 *
 * History (not committed; rebuilt by the scripts named in each file):
 *  - hist: NHL skater/goalie season totals 2008-09 … 2025-26 (MoneyPuck
 *    season CSVs, situation all), bios and draftees (2026-10-02 audit cache,
 *    dynasty-hist-skaters-goalies-2008-2025.json);
 *  - cache: draft-index.json + landing/<nhlId>.json from
 *    scripts/dynasty-fetch-history.ts (every pick's junior / college /
 *    European / AHL seasons).
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { seasonFpgLeague } from "../src/lib/dynasty/growth";
import type { LandingSeason } from "../src/lib/dynasty/nhle";
import type { DynastyParams } from "../src/lib/dynasty/params";
import type { SeasonLine } from "../src/lib/dynasty/types";

export const LAST_SEASON = 2025;
const SG: Record<number, number> = { 2012: 48, 2019: 70, 2020: 56 };
/** NHL regular-season games of a start year (lockout and COVID seasons). */
export const seasonGames = (y: number) => SG[y] ?? 82;

export type Sk = { gp: number; g: number; a1: number; a2: number; s: number; h: number; b: number; tk: number; toi: number | null };
export interface HistPlayer {
  n: string;
  pos: "F" | "D" | "G";
  birth?: string | null;
  draft?: { year: number; pick: number };
  sk: Record<string, Sk>;
}
export interface Draftee {
  year: number;
  pick: number;
  pos: string;
  name: string;
  id: number | null;
  birth: string | null;
  height?: number | null;
  weight?: number | null;
}
export interface Hist {
  players: Record<string, HistPlayer>;
  draftees: Draftee[];
}

export function loadHist(path: string): Hist {
  return JSON.parse(readFileSync(path, "utf8")) as Hist;
}

export interface LandingLite {
  playerId: number;
  firstName?: string;
  lastName?: string;
  position?: string;
  birthDate?: string;
  heightInInches?: number;
  weightInPounds?: number;
  draftDetails?: { year: number; overallPick: number } | null;
  seasonTotals: LandingSeason[];
  error?: number;
}

export interface ProspectHistory {
  /** Draft picks (skaters) with their NHL id when found. */
  picks: Array<{ year: number; pick: number; pos: string; name: string; height: number | null; weight: number | null; league: string | null; id: number | null }>;
  landing: Map<number, LandingLite>;
}

/**
 * draft-index.json + the landings it names (scripts/dynasty-fetch-history.ts).
 * Without the index (a fetch still running), it is rebuilt from the cached
 * draft classes and the landings whose draftDetails name the pick.
 */
export function loadProspectHistory(cache: string): ProspectHistory {
  const landing = new Map<number, LandingLite>();
  const dir = join(cache, "landing");
  const byPick = new Map<string, number>();
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    const j = JSON.parse(readFileSync(join(dir, f), "utf8")) as LandingLite;
    if (j.error) continue;
    landing.set(j.playerId, j);
    if (j.draftDetails) byPick.set(`${j.draftDetails.year}-${j.draftDetails.overallPick}`, j.playerId);
  }
  let picks: ProspectHistory["picks"];
  const idxPath = join(cache, "draft-index.json");
  if (existsSync(idxPath)) picks = (JSON.parse(readFileSync(idxPath, "utf8")) as { picks: ProspectHistory["picks"] }).picks;
  else {
    picks = [];
    const ddir = join(cache, "draft");
    for (const f of existsSync(ddir) ? readdirSync(ddir).sort() : []) {
      const year = Number(/(\d{4})/.exec(f)?.[1]);
      const d = JSON.parse(readFileSync(join(ddir, f), "utf8")) as {
        picks: Array<{ positionCode: string; overallPick: number; firstName?: { default?: string }; lastName?: { default?: string }; height?: number; weight?: number; amateurLeague?: string }>;
      };
      for (const pk of d.picks) {
        if (pk.positionCode === "G") continue;
        picks.push({
          year,
          pick: pk.overallPick,
          pos: pk.positionCode,
          name: `${pk.firstName?.default ?? ""} ${pk.lastName?.default ?? ""}`.trim(),
          height: pk.height ?? null,
          weight: pk.weight ?? null,
          league: pk.amateurLeague ?? null,
          id: byPick.get(`${year}-${pk.overallPick}`) ?? null,
        });
      }
    }
  }
  return { picks, landing };
}

export const line = (y: number, s: Sk): SeasonLine => ({
  season: y,
  gp: s.gp,
  toi: s.toi,
  goals: s.g,
  assists: s.a1 + s.a2,
  shots: s.s,
  hits: s.h,
  blocks: s.b,
  takeaways: s.tk,
});

/** League-1 (Captains Dynasty) FP/G of a season (the simulator's realized scale). */
export const fpgCaptains = (p: DynastyParams, g: "F" | "D", y: number, s: Sk) => seasonFpgLeague(p, g, [line(y, s)])?.fpg ?? 0;

/**
 * Slapshot FP/G of a season: G 3.5, A 2.5, SOG 0.25, Hit 0.15, SB 0.3, plus
 * PPP 0.5 and SHG 1 from fixed shares of points / goals (the history has no
 * power-play split: PPP ≈ 0.30 of points, SHG ≈ 0.028 / 0.021 of goals).
 */
export function fpgSlapshot(g: "F" | "D", s: Sk): number {
  if (!(s.gp > 0)) return 0;
  const a = s.a1 + s.a2;
  const pts = s.g + a;
  const fp = 3.5 * s.g + 2.5 * a + 0.25 * s.s + 0.15 * s.h + 0.3 * s.b + 0.5 * 0.3 * pts + (g === "F" ? 0.0283 : 0.0205) * s.g;
  return fp / s.gp;
}

export const ageOn = (birth: string | null | undefined, y: number) =>
  birth ? (Date.UTC(y, 9, 1) - Date.parse(`${birth}T00:00:00Z`)) / (365.25 * 86400000) : null;

// ------------------------------------------------------------------ statistics

export function ranks(x: readonly number[]): number[] {
  const s = x.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(x.length);
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1]![0] === s[i]![0]) j++;
    for (let k = i; k <= j; k++) r[s[k]![1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}
export function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  if (n < 3) return 0;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    ab += (a[i]! - ma) * (b[i]! - mb);
    aa += (a[i]! - ma) ** 2;
    bb += (b[i]! - mb) ** 2;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}
export const spearman = (a: readonly number[], b: readonly number[]) => pearson(ranks(a), ranks(b));

/** |top-N by prediction ∩ top-N by realized| / N (ties broken by index). */
export function topNPrecision(pred: readonly number[], real: readonly number[], N: number): number {
  const top = (x: readonly number[]) => new Set(x.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, N).map((e) => e[1]));
  const a = top(pred);
  const b = top(real);
  let k = 0;
  for (const i of a) if (b.has(i)) k++;
  return k / Math.min(N, pred.length);
}

/** Σ realized of the model's N best / Σ of the N best realized. */
export function capture(pred: readonly number[], real: readonly number[], N: number): number {
  const ip = pred.map((x, i) => [x, i] as const).sort((a, b) => b[0] - a[0]).slice(0, N).map((x) => x[1]);
  const best = [...real].sort((a, b) => b - a).slice(0, N).reduce((s, x) => s + x, 0);
  return best > 0 ? ip.reduce((s, i) => s + real[i]!, 0) / best : 0;
}

/** OLS slope of realized on predicted (1 = calibrated spread). */
export function calSlope(pred: readonly number[], real: readonly number[]): number {
  const n = pred.length;
  const mp = pred.reduce((s, x) => s + x, 0) / n;
  const mr = real.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (pred[i]! - mp) * (real[i]! - mr);
    den += (pred[i]! - mp) ** 2;
  }
  return den > 0 ? num / den : 0;
}

/** Deterministic LCG for the bootstraps. */
export function lcg(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
}

/** Quantile of a sorted array. */
export const q = (xs: readonly number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
};
