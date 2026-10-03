/**
 * The NHL days of a fantasy week: which clubs play each day (league time,
 * America/Toronto) and which of them played the night before. Reads the
 * season schedule the Fantrax leagues already publish
 * (`public/fantrax/schedule-<season>.json`: [startUTC, away, home] per game).
 * Pure.
 */
import type { SimDay } from "./simulate";

export type ScheduleGame = readonly [string, string, string];

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" });

/** YYYY-MM-DD of an instant, league time. */
export function leagueDate(iso: string | number | Date): string {
  return fmt.format(new Date(iso));
}

/** Clubs playing per league date. */
export function clubsByDate(games: readonly ScheduleGame[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [start, away, home] of games) {
    const d = leagueDate(start);
    const s = out.get(d) ?? new Set<string>();
    s.add(away);
    s.add(home);
    out.set(d, s);
  }
  return out;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week (Monday-Sunday, Yahoo's weeks) holding `date`. */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

/** The days `from` … `to` (inclusive) with their clubs and back-to-backs. */
export function weekDays(byDate: ReadonlyMap<string, ReadonlySet<string>>, from: string, to: string): SimDay[] {
  const out: SimDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const teams = byDate.get(d) ?? new Set<string>();
    const prev = byDate.get(addDays(d, -1));
    const b2b = new Set([...teams].filter((t) => prev?.has(t)));
    out.push({ date: d, teams, b2b });
  }
  return out;
}

/** Games of each club over some days. */
export function gamesPerClub(days: readonly SimDay[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of days) for (const t of d.teams) out.set(t, (out.get(t) ?? 0) + 1);
  return out;
}
