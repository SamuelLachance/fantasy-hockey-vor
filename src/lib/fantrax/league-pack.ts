/**
 * What only some Fantrax leagues need — a salary cap, per-game lineup locks,
 * points over replacement, a closed fxpa, a dynasty without the cutdown
 * (Slapshot) — handed to the league's provider by that league's OWN shell
 * chunk (`CapLeagueShell`, chosen per league by the server adapter). One
 * dynamic route serves every league, so anything imported by the shared
 * provider or tabs ships with every league's tabs; the pack (words and pieces,
 * synchronous: the prerendered HTML says them) and the model (VOR and the
 * planner's rules, a chunk fetched as the page starts) are how the Captains
 * tabs stay free of Slapshot's rules and words.
 */
import type { ComponentType } from "react";
import type { DynastyRecord } from "@/lib/dynasty/types";
import { canRankByPoints, type FantraxLeagueConfig } from "./config";
import { needsPlanKit, type PlanAlert, type PlanKit } from "./daily-plan";
import type { DynastyMode } from "./dynasty-mode";
import type { NameOf } from "./league-copy";
import type { leagueVor } from "./points-vor";
import type { ColumnKey } from "./table";
import type { ColumnCopy, ColumnCopyCtx } from "./table-copy";

/** The words of such a league (`cap-league-copy.ts`). */
export interface LeagueCopy {
  /** Alerts only it raises (salary-over, fxpa-closed); null for the others. */
  alertText(a: Pick<PlanAlert, "code" | "count" | "limit" | "ids">, name: NameOf): string | null;
  /** Headers it words its own way (Valeur (VOR), the league-season FP, salaries, contract end); null for the others. */
  column(col: ColumnKey, ctx: ColumnCopyCtx): ColumnCopy | null;
  /** The Repêchage note's value sentence (points over replacement). */
  vorBoardNote: string;
  /** The table note's value sentence (points over replacement). */
  vorTableNote: string;
  /** Repêchage: season columns vs dynasty value, without a cutdown. */
  dynastyDraftNote(mode: DynastyMode): string;
}

type Contract = NonNullable<DynastyRecord["contract"]>;

/**
 * Its own pieces (`cap-league-parts.tsx`): the shared tabs render them where
 * the pack has them, so they never name (nor ship) them.
 */
export interface LeagueParts {
  /** Repêchage: « C’EST À TOI » over the panel. */
  DraftCue: ComponentType;
  /** Repêchage: the cap, needs and best-by-position board. */
  DraftBoard: ComponentType;
  /** Repêchage: the method note and the light page's link, under the table. */
  DraftFooter: ComponentType;
  /** Mon équipe: the cap by season and the stash list. */
  TeamCap: ComponentType;
  /** Mon équipe: the method note. */
  MethodNote: ComponentType;
  /** The table's salary cell (a projected contract in italics). */
  SalaryNode: ComponentType<{ m: number; contract: Contract | null; t: number }>;
  /** The table's contract-end cell. */
  ContractEndNode: ComponentType<{ contract: Contract; firstSeason?: number }>;
  /** The table's dynasty legend (the cap charge inside the value). */
  Legend: ComponentType;
}

/** Its words and pieces: synchronous, in its shell chunk (the prerendered HTML says them too). */
export interface LeaguePack {
  copy: LeagueCopy;
  /** Its pieces; absent where only the words are needed (server, tests). */
  parts?: LeagueParts;
}

/**
 * Its models (`cap-league-model.ts`): a chunk its shell fetches as the page
 * starts; the page keeps the baked plan until it is in. The scripts pass
 * `PLAN_KIT` and `leagueVor` directly.
 */
export interface LeagueModel {
  /** Season points over replacement (`points-vor.ts`). */
  leagueVor: typeof leagueVor;
  /** The planner's rules (`plan-kit.ts`). */
  kit: PlanKit;
}

/** The league ranks by points over replacement or plans with rules only the model has. */
export function needsLeagueModel(cfg: FantraxLeagueConfig): boolean {
  return canRankByPoints(cfg) || needsPlanKit(cfg);
}

/**
 * The league's config asks for something only the pack has: then its tabs
 * render inside `CapLeagueShell` (the server adapter's choice), and the
 * provider refuses to run without it rather than show another league's words.
 */
export function needsLeaguePack(cfg: FantraxLeagueConfig): boolean {
  return (
    needsPlanKit(cfg) ||
    canRankByPoints(cfg) ||
    !cfg.features.fxpa ||
    (cfg.features.dynasty && !cfg.features.keeperCutdown)
  );
}
