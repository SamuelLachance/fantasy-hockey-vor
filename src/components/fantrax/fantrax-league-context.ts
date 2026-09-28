"use client";

/**
 * What a Fantrax points league's tabs read from the league provider. Kept
 * apart from `FantraxLeagueProvider.tsx` so the tab bodies, the header and the
 * player table never import the provider's module (the planner, the live
 * Fantrax reads): they only need this context.
 */
import { createContext, useContext } from "react";
import type { FantraxLeagueConfig, RosterLimits } from "@/lib/fantrax/config";
import type { DailyPlan } from "@/lib/fantrax/daily-plan";
import type { DynastyMode } from "@/lib/fantrax/dynasty-mode";
import type { LeagueSnapshotBundle } from "@/lib/fantrax/league-client";
import type { DraftFreshness, LiveOverlay } from "@/lib/fantrax/live";
import type { StateSnapshot } from "@/lib/fantrax/snapshot-types";
import type { PlayerLookup } from "./LeagueCard";

export type LoadState = "loading" | "ready" | "error";

export interface FantraxLeagueValue {
  /**
   * Engine config of the league being shown. Everything league-specific reads
   * it: the slot table, the eligibility tokens, the scoring base slot, which
   * features exist. Never assume the Captains one.
   */
  config: FantraxLeagueConfig;
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
  /** A salary-cap league's contracts.json (read apart from the bundle); "ready" in a league without a cap. */
  contractsState: LoadState;
  /** Rosters and draft picks: the snapshot's, with the live Fantrax read over them (null until the snapshot is in). */
  state: StateSnapshot | null;
  live: LiveOverlay | null;
  liveState: LoadState;
  /**
   * The draft on screen: from the latest live read, from an older one (the
   * last read's draft half failed: « données du dernier succès à … »), or the
   * build's. « C’EST À TOI » only shows on a live one (`cue`).
   */
  draftLive: DraftFreshness;
  /** A request really in flight (the refresh button's aria-busy). */
  busy: boolean;
  /**
   * Season points over the replacement level of each position, by Fantrax id
   * (`leagueVor`): what the draft board and « Valeur » rank by. Null for a
   * league the model does not cover (one with a captain slot) and until the
   * snapshot is in. Built once here so the plan, the draft panel and the
   * player table all rank by the same numbers.
   */
  vor: ReadonlyMap<string, number> | null;
  /** Current time, from effects only (null in the prerendered HTML). */
  nowMs: number | null;
  refresh: () => void;
  player: PlayerLookup;
  teamName: (id: string) => string;
  /**
   * The build saw this league's `dynasty.json`. Always false for a league
   * whose config has no keeper model: its columns, filters, presets and home
   * line must never appear.
   */
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
