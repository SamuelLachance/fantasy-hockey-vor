/**
 * Minors eligibility and the offseason cutdown (§3.9).
 *
 * Eligible at a cutdown ⇔ age on that date < 25 and career GP < 100 (skater)
 * or < 55 (goalie). The strict Fantrax reading applies: exactly 100 GP is not
 * eligible. The cutdown date is not published; params assume Sep 17.
 */
import type { DynastyParams } from "./params";
import type { Group } from "./types";

const YEAR_MS = 365.25 * 86_400_000;

export function birthMs(birthDate: string | null | undefined): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const t = Date.parse(`${birthDate}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

/** Fractional age at a UTC instant. */
export function ageAt(birth: number, atMs: number): number {
  return (atMs - birth) / YEAR_MS;
}

/** Oct 1 of the first season (the age anchor of every record). */
export function seasonAnchorMs(p: DynastyParams): number {
  return Date.UTC(p.firstSeasonYear, 9, 1);
}

/** The cutdown before season t (t ≥ 1): Sep 17 of 2026 + t by default. */
export function cutdownMs(p: DynastyParams, t: number): number {
  return Date.UTC(p.firstSeasonYear + t, p.cutdown.month - 1, p.cutdown.day);
}

/**
 * Whole-years age on a date (birthday rule): the day before the 25th birthday
 * is 24, the birthday itself is 25.
 */
export function completedYears(birthDate: string, atMs: number): number {
  const [y, m, d] = birthDate.split("-").map(Number) as [number, number, number];
  const at = new Date(atMs);
  let age = at.getUTCFullYear() - y;
  const md = at.getUTCMonth() + 1 - m;
  if (md < 0 || (md === 0 && at.getUTCDate() < d)) age--;
  return age;
}

export function gpLimit(p: DynastyParams, g: Group): number {
  return g === "G" ? p.eligibility.goalieGp : p.eligibility.skaterGp;
}

/** Eligible at a cutdown given the age then and the career GP accumulated. */
export function isEligible(p: DynastyParams, g: Group, ageAtCutdown: number, careerGp: number): boolean {
  return ageAtCutdown < p.eligibility.age && careerGp < gpLimit(p, g);
}

/**
 * Age at the cutdown before season t, used in the path simulation. With a
 * birth date it is exact to the day (completed years, then the fraction);
 * without one, age on Oct 1 minus two weeks.
 */
export function cutdownAge(p: DynastyParams, birthDate: string | null, age0: number, t: number): number {
  const b = birthMs(birthDate);
  const at = cutdownMs(p, t);
  if (b == null) return age0 + t - 0.04;
  const whole = completedYears(birthDate!, at);
  const frac = ageAt(b, at);
  // Keep the birthday rule exact even where the 365.25-day year drifts.
  return Math.min(Math.max(frac, whole), whole + 0.9999);
}

/** Does the 25th birthday fall inside the assumed cutdown window of year Y? */
export function birthdayInWindow(p: DynastyParams, birthDate: string | null, year: number): boolean {
  if (!birthDate) return false;
  const [y, m, d] = birthDate.split("-").map(Number) as [number, number, number];
  if (y + p.eligibility.age !== year) return false;
  const md = `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return md >= p.cutdown.window[0] && md <= p.cutdown.window[1];
}
