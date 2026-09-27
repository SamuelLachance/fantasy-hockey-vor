/**
 * One `public/fantrax/values.json` row from a matched projection: shared by
 * the network sync (scripts/fantrax-sync.ts) and the offline re-value of the
 * committed snapshot (scripts/fantrax-revalue.ts), so both write the same
 * numbers from the same players.json.
 *
 * Pure: the caller passes the scoring table, the row's Fantrax identity, the
 * matched projection and profile, and the league config (eligibility tokens,
 * the forward scoring column, the priors in the league's own points).
 */
import type { PlayerProfile } from "../profile-types";
import type { GoalieProjection, PlayerProjection, SkaterProjection } from "../types";
import { CAPTAINS_DYNASTY, FANTRAX_NO_TEAM, type FantraxLeagueConfig } from "./config";
import {
  goalieStartShares,
  goalieValueFromProjection,
  isRuledOut,
  priorGoalieValue,
  priorSkaterValue,
  PRIOR_GOALIE_GP,
  skaterValueFromProjection,
  takeawaysPerGame,
} from "./points-model";
import type { ScoringTable } from "./scoring";
import type { ValueRecord } from "./snapshot-types";

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

/** Fantrax identity of a row: display name, team, eligibility, age. */
export type ValueBase = Pick<ValueRecord, "n" | "t" | "e"> & { age?: number };

/**
 * The row for one Fantrax player: projected when a projection matched,
 * else the league-wide prior (`prior: true`). Captains by default, so every
 * existing caller writes the same bytes.
 */
export function valueRecord(
  scoring: ScoringTable,
  base: ValueBase,
  proj: PlayerProjection | undefined,
  profile: PlayerProfile | undefined,
  cfg: FantraxLeagueConfig = CAPTAINS_DYNASTY,
): { record: ValueRecord; prior: boolean } {
  const tokens = base.e.split(",").map((t) => t.trim());
  const { goalieToken, skaterTokens, defenseTokens } = cfg.eligibility;
  const isGoalie = tokens.includes(goalieToken) && !tokens.some((t) => skaterTokens.includes(t));
  if (isGoalie) {
    if (proj?.isGoalie) {
      const p = proj.projection as GoalieProjection;
      const gE = goalieValueFromProjection(
        scoring,
        { gamesPlayed: proj.gamesPlayed, wins: p.wins, shutouts: p.shutouts, saves: p.saves, savePct: p.savePct },
        profile ? { gamesPlayed: profile.careerTotals?.gamesPlayed ?? 0, otLosses: profile.careerTotals?.otLosses, assists: profile.careerTotals?.assists } : null,
      );
      return { record: { ...base, gp: proj.gamesPlayed, gE: round(gE), src: "proj" }, prior: false };
    }
    return {
      record: { ...base, gp: base.t === FANTRAX_NO_TEAM ? 0 : PRIOR_GOALIE_GP, gE: priorGoalieValue(cfg.priors.goalieE), src: "prior" },
      prior: true,
    };
  }
  const dEligible = tokens.some((t) => defenseTokens.includes(t));
  const forwardOnly = skaterTokens.filter((t) => !defenseTokens.includes(t));
  const primaryD = proj
    ? (proj.primaryPosition ?? proj.position) === "D"
    : dEligible && !tokens.some((t) => forwardOnly.includes(t));
  if (proj && !proj.isGoalie) {
    const p = proj.projection as SkaterProjection;
    const tk = dEligible
      ? takeawaysPerGame(
          (profile?.teamHistory ?? []).map((h) => ({
            seasonId: h.seasonId,
            gamesPlayed: h.gamesPlayed,
            takeaways: h.advanced?.takeaways,
          })),
        )
      : undefined;
    const v = skaterValueFromProjection(
      scoring,
      {
        gamesPlayed: proj.gamesPlayed,
        goals: p.goals,
        assists: p.assists,
        shots: p.shots,
        hits: p.hits,
        blocks: p.blocks,
        // Only a league that scores PPP reads it (Slapshot: 0.5 a point).
        powerplayPoints: p.powerplayPoints,
      },
      {
        primaryD,
        dEligible,
        takeawaysPerGame: tk,
        // Shorthanded goals are not projected: his career rate, shrunk.
        career: profile
          ? { gamesPlayed: profile.careerTotals?.gamesPlayed ?? 0, shorthandedGoals: profile.careerTotals?.shorthandedGoals }
          : null,
        baseSlot: cfg.baseSlot,
      },
    );
    return { record: { ...base, gp: proj.gamesPlayed, off: round(v.off), dx: round(v.dx), src: "proj" }, prior: false };
  }
  const v = priorSkaterValue(primaryD, cfg.priors.fpg);
  return { record: { ...base, gp: 0, off: v.off, dx: dEligible ? v.dx : 0, src: "prior" }, prior: true };
}

/**
 * Goalie start shares within each NHL club (`pS`), injured / minors goalies
 * removed; `icons` gives a player's Fantrax status icons.
 */
export function attachGoalieStartShares(
  players: Record<string, ValueRecord>,
  icons: (id: string) => string[] | undefined,
): void {
  const shares = goalieStartShares(
    Object.entries(players)
      .filter(([, r]) => r.gE !== undefined)
      .map(([id, r]) => ({ id, team: r.t, gp: r.gp, healthy: !isRuledOut({ team: r.t, icons: icons(id) }) })),
  );
  for (const [id, p] of shares) players[id]!.pS = round(p);
}
