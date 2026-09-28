/**
 * « C’EST À TOI » outside the page: the browser tab's title (the one
 * channel a background tab has) and, only for a user who asked for it, a
 * system notification and a short sound. Pure helpers; the component that
 * drives them is `DraftTurnWatcher.tsx`.
 */

export const TURN_PREFIX = "C’EST À TOI · ";

/** `title` with the cue on or off; idempotent (Next rewrites the title on every tab change). */
export function withTurnPrefix(title: string, on: boolean): string {
  let bare = title;
  while (bare.startsWith(TURN_PREFIX)) bare = bare.slice(TURN_PREFIX.length);
  return on ? `${TURN_PREFIX}${bare}` : bare;
}

/**
 * How old the last live read of the draft may be and still say « it is your
 * turn »: three polls, at least two minutes. Past that, and always on the
 * draft baked into the build, the cue stays off.
 */
export function turnCueMaxAgeMs(pollMs: number): number {
  return Math.max(3 * pollMs, 120_000);
}

/** localStorage key of the opt-in (per league: two drafts may run at once). */
export const turnAlertKey = (slug: string) => `fantrax-turn-alert:${slug}`;
