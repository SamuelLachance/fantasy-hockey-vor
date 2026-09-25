/**
 * Fantrax period and Eastern-time helpers. Fantrax timestamps carry a
 * compact offset (`2026-09-30T19:29:59.0-0400`) that V8 parses but other
 * engines may not, so the sync converts them to ISO once and everything
 * downstream works in epoch ms or ISO strings.
 *
 * "Today" is always the America/Toronto calendar date: the NHL schedule and
 * the Fantrax lineup periods both roll over on Eastern time, and NHL
 * `schedule/now` rolls over late, so never trust the host clock's date.
 */
import type { FxeaPeriod } from "./api-types";
import { LEAGUE_TIME_ZONE } from "./config";

export interface IsoPeriod {
  number: number;
  /** ISO 8601 UTC, inclusive. */
  start: string;
  /** ISO 8601 UTC, inclusive (Fantrax ends periods at :59.0). */
  end: string;
}

const FANTRAX_DATE =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([+-])(\d{2}):?(\d{2})$/;

/** `2026-09-30T19:29:59.0-0400` → `2026-09-30T23:29:59.000Z`. ISO input passes through. */
export function fantraxDateToIso(value: string): string {
  const m = FANTRAX_DATE.exec(value.trim());
  if (m) {
    const [, day, hh, mm, ss, frac = "0", sign, oh, om] = m;
    const ms = Math.round(Number(`0.${frac}`) * 1000);
    const local = Date.UTC(
      Number(day!.slice(0, 4)),
      Number(day!.slice(5, 7)) - 1,
      Number(day!.slice(8, 10)),
      Number(hh),
      Number(mm),
      Number(ss),
      ms,
    );
    const offsetMin = (Number(oh) * 60 + Number(om)) * (sign === "-" ? -1 : 1);
    return new Date(local - offsetMin * 60_000).toISOString();
  }
  const t = Date.parse(value);
  if (!Number.isFinite(t)) throw new Error(`Unparseable Fantrax date: ${value}`);
  return new Date(t).toISOString();
}

export function toIsoPeriods(periods: FxeaPeriod[]): IsoPeriod[] {
  return periods
    .map((p) => ({
      number: p.number,
      start: fantraxDateToIso(p.startDate),
      end: fantraxDateToIso(p.endDate),
    }))
    .sort((a, b) => a.number - b.number);
}

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: LEAGUE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const weekdayFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: LEAGUE_TIME_ZONE,
  weekday: "short",
});

/** Eastern calendar date `YYYY-MM-DD` of an instant. */
export function torontoDate(ms: number): string {
  return dateFmt.format(new Date(ms));
}

/** 0 = Sunday … 6 = Saturday, in Eastern time. */
export function torontoWeekday(ms: number): number {
  const w = weekdayFmt.format(new Date(ms));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(w);
}

/** Pure calendar arithmetic on `YYYY-MM-DD` (no time zone involved). */
export function addDays(date: string, days: number): string {
  const t = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)) + days,
  );
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

/**
 * The lineup period to set now: the first one whose start (its first puck
 * drop) is still ahead. Null once the season's last period has started.
 */
export function targetRosterPeriod<P extends IsoPeriod>(periods: P[], nowMs: number): P | null {
  for (const p of periods) if (Date.parse(p.start) > nowMs) return p;
  return null;
}

export function periodContaining<P extends IsoPeriod>(periods: P[], ms: number): P | null {
  for (const p of periods) {
    if (Date.parse(p.start) <= ms && ms <= Date.parse(p.end)) return p;
  }
  return null;
}

/**
 * Scoring period that an instant belongs to; before the season it is the
 * first period, after the season null.
 */
export function scoringPeriodAt<P extends IsoPeriod>(periods: P[], ms: number): P | null {
  if (periods.length === 0) return null;
  if (ms < Date.parse(periods[0]!.start)) return periods[0]!;
  return periodContaining(periods, ms);
}

/** Roster (daily lineup) periods that start inside a scoring period. */
export function rosterPeriodsIn<P extends IsoPeriod>(rosterPeriods: P[], scoring: IsoPeriod): P[] {
  const s = Date.parse(scoring.start);
  const e = Date.parse(scoring.end);
  return rosterPeriods.filter((p) => {
    const t = Date.parse(p.start);
    return t >= s && t <= e;
  });
}

/**
 * Start of the current claim week: the latest Monday 00:00 Eastern at or
 * before `nowMs` (claims reset Monday; FA and WW claims share the 5).
 */
export function claimWeekStart(nowMs: number): string {
  const today = torontoDate(nowMs);
  const back = (torontoWeekday(nowMs) + 6) % 7; // Mon → 0 … Sun → 6
  return addDays(today, -back);
}

/** Eastern date string of a Fantrax/ISO timestamp. */
export function torontoDateOfIso(iso: string): string {
  return torontoDate(Date.parse(iso));
}
