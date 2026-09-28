/**
 * The cap league's models in one chunk (Slapshot): points over replacement
 * (`points-vor.ts`, its seat fill) and the planner's own rules (`plan-kit.ts`:
 * the salary cap over the counted spots, per-game locks). `CapLeagueShell`
 * fetches it with `import()` as the page starts, alongside the snapshot; the
 * page keeps the baked plan until both are in.
 */
import type { LeagueModel } from "./league-pack";
import { PLAN_KIT } from "./plan-kit";
import { leagueVor } from "./points-vor";

export const CAP_LEAGUE_MODEL: LeagueModel = { leagueVor, kit: PLAN_KIT };
