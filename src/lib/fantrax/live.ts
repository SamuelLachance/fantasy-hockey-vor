/**
 * Live fxea overlay. The public API (CORS `*`, no login) re-reads rosters
 * and draft picks between syncs; the sync, the report's `--live` flag and
 * the /league page all map those payloads here, so a roster read live and
 * one baked at sync time are interchangeable inputs to `buildDailyPlan`.
 *
 * Everything else in the snapshot (caps, icons, Ros%, claims, waivers) only
 * comes from fxpa at sync time and is kept as baked.
 */
import type { FxeaDraftResults, FxeaTeamRosters } from "./api-types";
import type { StateSnapshot } from "./snapshot-types";

export type DraftState = NonNullable<StateSnapshot["draft"]>;

export interface RecentPick {
  pick: number;
  round: number;
  teamId: string;
  playerId: string;
  /** Epoch ms the pick was made. */
  time: number;
}

export interface LiveOverlay {
  /** When the browser (or CLI) read fxea, ISO. */
  fetchedAt: string;
  /** Lineup period the rosters were read for. */
  rosterPeriod: number;
  rosters: StateSnapshot["rosters"];
  /**
   * Null when getDraftResults failed and no earlier live read had it (the
   * baked draft then stays, flagged as such by `draftAt`).
   */
  draft: DraftState | null;
  /**
   * When `draft` was read from Fantrax, ISO: `fetchedAt` when this read got
   * it, earlier when getDraftResults failed and the last good live draft was
   * carried over (`carryLiveDraft`), null when there is no live draft at all.
   */
  draftAt: string | null;
  /** Latest picks first (live only; the snapshot carries no pick times). */
  recent: RecentPick[];
}

export function rostersFromFxea(r: FxeaTeamRosters): StateSnapshot["rosters"] {
  return Object.fromEntries(
    Object.entries(r.rosters ?? {}).map(([teamId, t]) => [
      teamId,
      (t.rosterItems ?? []).map((it) => ({
        id: it.id,
        slot: it.position,
        status: it.status,
        ...(it.salary && it.salary > 0 ? { sal: Math.round(it.salary / 1e4) / 100 } : {}),
      })),
    ]),
  );
}

export function draftFromFxea(d: FxeaDraftResults): DraftState {
  return {
    state: d.draftState,
    picks: (d.draftPicks ?? []).map((p) => ({
      pick: p.pick,
      round: p.round,
      teamId: p.teamId,
      ...(p.playerId ? { playerId: p.playerId } : {}),
    })),
  };
}

/** The `n` most recent picks, newest first. */
export function recentPicks(d: FxeaDraftResults, n = 8): RecentPick[] {
  return (d.draftPicks ?? [])
    .filter((p): p is typeof p & { playerId: string } => !!p.playerId)
    .sort((a, b) => b.pick - a.pick)
    .slice(0, n)
    .map((p) => ({ pick: p.pick, round: p.round, teamId: p.teamId, playerId: p.playerId, time: p.time }));
}

export function liveOverlay(
  rosters: FxeaTeamRosters,
  draft: FxeaDraftResults | null,
  fetchedAtMs: number,
  rosterPeriod: number,
): LiveOverlay {
  const fetchedAt = new Date(fetchedAtMs).toISOString();
  return {
    fetchedAt,
    rosterPeriod: rosters.period ?? rosterPeriod,
    rosters: rostersFromFxea(rosters),
    draft: draft ? draftFromFxea(draft) : null,
    draftAt: draft ? fetchedAt : null,
    recent: draft ? recentPicks(draft) : [],
  };
}

/**
 * A read whose getDraftResults failed (rosters fine) keeps the previous
 * LIVE draft and its latest picks, dated by their own read: falling back to
 * the draft baked into the build would jump several picks back in a draft
 * that moves every few minutes, and present that as live.
 */
export function carryLiveDraft(prev: LiveOverlay | null | undefined, next: LiveOverlay): LiveOverlay {
  if (next.draft || !prev?.draft) return next;
  return { ...next, draft: prev.draft, draftAt: prev.draftAt ?? prev.fetchedAt, recent: prev.recent };
}

/** How the draft on screen was read. */
export interface DraftFreshness {
  /** From the latest live read, which succeeded. */
  current: boolean;
  /** When the draft shown was read live (ISO), null when it is the build's. */
  at: string | null;
  /**
   * Recent enough to say « it is your turn » (within `maxAgeMs` of now, or
   * from the latest read): never on the baked draft.
   */
  cue: boolean;
}

export function draftFreshness(
  live: LiveOverlay | null,
  liveState: "loading" | "ready" | "error",
  nowMs: number | null,
  maxAgeMs: number,
): DraftFreshness {
  const at = live?.draft ? (live.draftAt ?? null) : null;
  const current = !!at && liveState === "ready" && at === live!.fetchedAt;
  const age = at && nowMs !== null ? nowMs - Date.parse(at) : null;
  return { current, at, cue: !!at && (current || (age !== null && age <= maxAgeMs)) };
}

/** The pick on the clock: the first one without a player (null once the draft is over). */
export function pickOnTheClock(draft: DraftState | null | undefined): DraftState["picks"][number] | null {
  let cur: DraftState["picks"][number] | null = null;
  for (const p of draft?.picks ?? []) if (!p.playerId && (!cur || p.pick < cur.pick)) cur = p;
  return cur;
}

/**
 * Baked state with live rosters / draft swapped in. A live read with no
 * rosters at all (Fantrax hiccup) keeps the baked rosters rather than
 * emptying every team.
 */
export function withLiveOverlay(state: StateSnapshot, live: LiveOverlay | null): StateSnapshot {
  if (!live) return state;
  const hasRosters = Object.keys(live.rosters).length > 0;
  return {
    ...state,
    ...(hasRosters ? { rosters: live.rosters, rosterPeriod: live.rosterPeriod } : {}),
    ...(live.draft ? { draft: live.draft } : {}),
  };
}
