"use client";

/**
 * What the Captains Dynasty tabs read from the league provider. Kept apart
 * from `FantraxLeagueProvider.tsx` so the tab bodies, the header and the
 * player table never import the provider's module (the planner, the live
 * Fantrax reads): they only need this context.
 */
import { createContext, useContext } from "react";
import type { RosterLimits } from "@/lib/fantrax/config";
import type { DailyPlan } from "@/lib/fantrax/daily-plan";
import type { DynastyMode } from "@/lib/fantrax/dynasty-mode";
import type { LeagueSnapshotBundle } from "@/lib/fantrax/league-client";
import type { LiveOverlay } from "@/lib/fantrax/live";
import type { StateSnapshot } from "@/lib/fantrax/snapshot-types";
import type { PlayerLookup } from "./LeagueCard";

export type LoadState = "loading" | "ready" | "error";

export interface FantraxLeagueValue {
  teams: Array<{ id: string; name: string }>;
  leagueName: string;
  /** Roster limits of the league (Actifs / Réserve / blessés / mineures). */
  limits: RosterLimits;
  defaultTeamId: string;
  teamId: string;
  chooseTeam: (teamId: string) => void;
  /** Browser re-run for the chosen team once the snapshot is in; the baked plan until then (default team only). */
  plan: DailyPlan | null;
  bundle: LeagueSnapshotBundle | null;
  bundleState: LoadState;
  /** Rosters and draft picks: the snapshot's, with the live Fantrax read over them (null until the snapshot is in). */
  state: StateSnapshot | null;
  live: LiveOverlay | null;
  liveState: LoadState;
  /** A request really in flight (the refresh button's aria-busy). */
  busy: boolean;
  /** Current time, from effects only (null in the prerendered HTML). */
  nowMs: number | null;
  refresh: () => void;
  player: PlayerLookup;
  teamName: (id: string) => string;
  /** The build saw `public/fantrax/dynasty.json` (else it is never fetched). */
  hasDynasty: boolean;
  /** Dynasty value mode of every Captains tab (`?mode=`, Équilibré by default). */
  mode: DynastyMode;
  chooseMode: (mode: DynastyMode) => void;
}

export const FantraxLeagueContext = createContext<FantraxLeagueValue | null>(null);

export function useFantraxLeague(): FantraxLeagueValue {
  const v = useContext(FantraxLeagueContext);
  if (!v) throw new Error("useFantraxLeague outside FantraxLeagueProvider");
  return v;
}
