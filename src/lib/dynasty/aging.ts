/**
 * Aging (§3.4): per-position level curves, the λ-scaled decline, effective
 * age (elite and trajectory shifts) and the phase label.
 *
 * c_F, c_D = level vs age 26 (MoneyPuck 2008-26, conditional delta method),
 * c_G = goalie FP/start multiplier from save% above league. After 26 the
 * skater decline is softened: c̃(a) = c(26)·(c(a)/c(26))^λ, λ = 0.6 (the
 * out-of-sample backtest of aging plus drop-outs, 0.5–0.65).
 */
import type { Curve, DynastyParams } from "./params";
import type { Group, Phase, SeasonLine } from "./types";

/** Raw curve value at a fractional age (linear; geometric past the last age). */
export function curveLevel(c: Curve, age: number): number {
  const v = c.values;
  const lo = c.age0;
  const hi = c.age0 + v.length - 1;
  if (age <= lo) return v[0]!;
  if (age >= hi) return v[v.length - 1]! * Math.pow(v[v.length - 1]! / v[v.length - 2]!, age - hi);
  const a0 = Math.floor(age);
  const f = age - a0;
  return v[a0 - lo]! * (1 - f) + v[a0 - lo + 1]! * f;
}

export type LevelFn = (g: Group, age: number) => number;

/** Raw level function c_g(a). */
export function makeRawLevel(p: DynastyParams): LevelFn {
  return (g, age) => curveLevel(p.curves[g], age);
}

/** λ-scaled level c̃_g(a) (identity for goalies and ages ≤ 26). */
export function makeLevel(p: DynastyParams, lambda = p.lambda.value): LevelFn {
  const raw = makeRawLevel(p);
  const at26 = { F: raw("F", 26), D: raw("D", 26), G: raw("G", 26) };
  return (g, age) => {
    const c = raw(g, age);
    if (g === "G" || age <= 26) return c;
    return at26[g] * Math.pow(c / at26[g], lambda);
  };
}

/**
 * Effective-age shift at age a: elite forwards age a year slower from 31
 * (they retain 0.940 a year vs 0.907 from 33 to 35), plus the trajectory
 * shift; bounded to ±1 year.
 */
export function ageShift(p: DynastyParams, g: Group, age: number, elite: boolean, traj: number): number {
  const e = elite && g === "F" && age >= p.eliteTheta.fromAge ? -1 : 0;
  return Math.max(-1, Math.min(1, e + traj));
}

/** Yearly drift of the persistent level into age a: c̃(a + s) / c̃(a − 1 + s). */
export function drift(level: LevelFn, g: Group, age: number, shift: number): number {
  return level(g, age + shift) / level(g, age - 1 + shift);
}

/** Phase from age alone (the table in params.phasesByAge). */
export function phaseByAge(p: DynastyParams, g: Group, effAge: number): Exclude<Phase, "prospect"> {
  const lo = g === "G" ? 20 : 18;
  const a = Math.max(lo, Math.min(40, Math.floor(effAge)));
  return p.phasesByAge[g][String(a)] ?? "late_career";
}

/** Merge per-team rows of the same season. */
export function mergeSeasons(lines: readonly SeasonLine[]): SeasonLine[] {
  const by = new Map<number, SeasonLine & { toiW: number; toiGp: number }>();
  for (const l of lines) {
    const cur = by.get(l.season) ?? {
      season: l.season,
      gp: 0,
      toi: null,
      goals: 0,
      assists: 0,
      shots: 0,
      hits: 0,
      blocks: 0,
      takeaways: 0,
      toiW: 0,
      toiGp: 0,
    };
    cur.gp += l.gp;
    cur.goals += l.goals;
    cur.assists += l.assists;
    cur.shots += l.shots;
    cur.hits += l.hits;
    cur.blocks += l.blocks;
    cur.takeaways += l.takeaways;
    if (l.toi != null && l.gp > 0) {
      cur.toiW += l.toi * l.gp;
      cur.toiGp += l.gp;
    }
    by.set(l.season, cur);
  }
  return [...by.values()]
    .map(({ toiW, toiGp, ...s }) => ({ ...s, toi: toiGp > 0 ? toiW / toiGp : null }))
    .sort((a, b) => a.season - b.season);
}

/** Realized-style FP/G of a season line (league weights, no OT/HT/SO). */
export function seasonFpg(p: DynastyParams, g: Group, s: SeasonLine): number {
  if (!(s.gp > 0)) return 0;
  const w = p.trajectory.fp;
  let fp = w.goals * s.goals + w.assists * s.assists + w.shots * s.shots + w.hits * s.hits;
  if (g === "D") fp += w.dBlocks * s.blocks + w.dTakeaways * s.takeaways;
  return fp / s.gp;
}

export interface Trajectory {
  shift: -1 | 0 | 1;
  toiDelta: number | null;
  fpgRatio: number | null;
}

/**
 * Trajectory modifier (skaters 24+, last two seasons with ≥ 40 GP each),
 * symmetric so it spots a slowdown as readily as a breakout:
 *   −1 effective year when TOI/GP rose ≥ 90 s or FP/G beat the curve's
 *      expected change by more than 12%, and FP/G did not fall;
 *   +1 when TOI/GP fell ≥ 90 s or FP/G trailed the curve's expected change
 *      by more than 12%, and FP/G did not rise.
 * It shifts future drift and the label, never year 0.
 */
export function trajectoryShift(
  p: DynastyParams,
  level: LevelFn,
  g: Group,
  age0: number,
  history: readonly SeasonLine[] | undefined,
  lastSeason = p.firstSeasonYear - 1,
): Trajectory {
  const none: Trajectory = { shift: 0, toiDelta: null, fpgRatio: null };
  const t = p.trajectory;
  if (g === "G" || age0 < t.minAge || !history?.length) return none;
  const merged = mergeSeasons(history);
  const cur = merged.find((s) => s.season === lastSeason);
  const prev = merged.find((s) => s.season === lastSeason - 1);
  if (!cur || !prev || cur.gp < t.minGp || prev.gp < t.minGp) return none;
  const f1 = seasonFpg(p, g, prev);
  const f2 = seasonFpg(p, g, cur);
  if (!(f1 > 0)) return none;
  const ratio = f2 / f1;
  const expected = level(g, age0 - 1) / level(g, age0 - 2);
  const toiDelta = cur.toi != null && prev.toi != null ? cur.toi - prev.toi : null;
  const falling = f2 < f1;
  const rising = f2 > f1;
  const toiUp = toiDelta != null && toiDelta >= t.toiSec;
  const toiDown = toiDelta != null && toiDelta <= -t.toiSec;
  let shift: -1 | 0 | 1 = 0;
  if ((toiUp || ratio > expected * (1 + t.fpgExcess)) && !falling) shift = -1;
  else if ((toiDown || ratio < expected * (1 - t.fpgExcess)) && !rising) shift = 1;
  return { shift, toiDelta, fpgRatio: ratio };
}
