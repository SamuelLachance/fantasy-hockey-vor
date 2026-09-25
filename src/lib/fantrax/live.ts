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
  /** Null when getDraftResults failed: the baked draft stays. */
  draft: DraftState | null;
  /** Latest picks first (live only; the snapshot carries no pick times). */
  recent: RecentPick[];
}

export function rostersFromFxea(r: FxeaTeamRosters): StateSnapshot["rosters"] {
  return Object.fromEntries(
    Object.entries(r.rosters ?? {}).map(([teamId, t]) => [
      teamId,
      (t.rosterItems ?? []).map((it) => ({ id: it.id, slot: it.position, status: it.status })),
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
  return {
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    rosterPeriod: rosters.period ?? rosterPeriod,
    rosters: rostersFromFxea(rosters),
    draft: draft ? draftFromFxea(draft) : null,
    recent: draft ? recentPicks(draft) : [],
  };
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
