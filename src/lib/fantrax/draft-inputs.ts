/**
 * The small pure pieces of the daily plan that the player table needs too:
 * season values from the projections and the draft helper's inputs (the
 * projected players still available, the need bonus, the plan's odds).
 * Kept apart from `daily-plan.ts` (which re-exports them) so the browser's
 * player table does not ship the lineup optimizer and the rest of the
 * planner a second time.
 */
import { CAPTAINS_DYNASTY, eligibleGroups, eligibleSlots, type FantraxLeagueConfig } from "./config";
import type { PlanLineup } from "./daily-plan";
import type { DraftGroup, DraftPoolPlayer } from "./draft";
import { isRuledOut } from "./points-model";
import type { StateSnapshot, ValueRecord, ValuesSnapshot } from "./snapshot-types";

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

// ------------------------------------------------------------ values

/**
 * A goalie with a projected value per start. `gE` is the discriminator (the
 * sync writes `gE` for goalies and `off`/`dx` for skaters); the token check
 * is belt and braces and uses the league's own goalie token.
 */
export const isGoalieRecord = (r: ValueRecord, cfg: FantraxLeagueConfig = CAPTAINS_DYNASTY) =>
  r.e.split(",").includes(cfg.eligibility.goalieToken) && r.gE !== undefined;

/**
 * Best per-game value outside the Skt slot: `off` in a forward slot,
 * `off + dx` in the D slot.
 *
 * `dx` may be NEGATIVE in a league whose D column pays a category less than the
 * column `off` is measured in — which is exactly what a scoring table like
 * Slapshot's produces under the "Fantrax ignores the per-slot rows" reading
 * (see `ScoringBaseSlot`). A player who can ONLY sit at D then really is worth
 * `off + dx`, so clamping the extra at 0 would over-value him; a player who can
 * also take a forward slot takes the better of the two, which is what "best"
 * means.
 */
export function bestFpg(r: ValueRecord, cfg: FantraxLeagueConfig = CAPTAINS_DYNASTY): number {
  if (isGoalieRecord(r, cfg)) return (r.pS ?? 0) * (r.gE ?? 0);
  const dOk = r.e.split(",").some((t) => cfg.eligibility.defenseTokens.includes(t.trim()));
  if (!dOk) return r.off ?? 0;
  // Slots he can fill, the captain seat aside (it multiplies `off`, so it is
  // never the reason a D-only player is worth more than `off + dx`).
  const dOnly = eligibleSlots(r.e, cfg).every((s) => s === "D" || s === "Skt");
  const dx = r.dx ?? 0;
  return (r.off ?? 0) + (dOnly ? dx : Math.max(0, dx));
}

/** Season value: projected games × best per-game value (starts × E for goalies). */
export function seasonFp(r: ValueRecord, cfg: FantraxLeagueConfig = CAPTAINS_DYNASTY): number {
  if (isGoalieRecord(r, cfg)) return r.gp * (r.gE ?? 0);
  return r.gp * bestFpg(r, cfg);
}

// ------------------------------------------------------------ plan odds

/** Closest the plan's draft odds get to 0 or 1 when the outcome is not sure. */
export const PLAN_ODDS_EPS = 1e-4;

/**
 * Draft odds for the plan: 4 decimals, but never rounded onto a false
 * certainty. Unless nobody picks in between (`sure`), they stay within
 * [0.0001, 0.9999], so the page and the report show `< 1 %` / `> 99 %`
 * rather than `0 %` / `100 %`.
 */
export function planOdds(p: number, sure: boolean): number {
  const r = round(p, 4);
  return sure ? r : Math.min(1 - PLAN_ODDS_EPS, Math.max(PLAN_ODDS_EPS, r));
}

// ------------------------------------------------------------ draft inputs

/**
 * Projected players nobody rosters or has drafted. fxpa lists the top
 * available players by Fantrax's own projection; a player we project who is
 * missing from it is usually hurt, retired or overseas (e.g. Pietrangelo),
 * so he is left out. Without fxpa (no flags at all) everyone projected stays.
 */
export function availableProjected(state: StateSnapshot, values: ValuesSnapshot): string[] {
  const rosteredAnywhere = new Set(Object.values(state.rosters).flatMap((r) => r.map((x) => x.id)));
  const draftedIds = new Set((state.draft?.picks ?? []).map((p) => p.playerId).filter(Boolean) as string[]);
  return Object.keys(values.players).filter(
    (id) =>
      !rosteredAnywhere.has(id) &&
      !draftedIds.has(id) &&
      values.players[id]!.src === "proj" &&
      (!state.fxpaOk || id in state.ros),
  );
}

/** A draft is open while it is not done and a pick is still to be made. */
export function draftIsOpen(state: StateSnapshot): boolean {
  return !!state.draft && state.draft.state !== "done" && state.draft.picks.some((p) => !p.playerId);
}

/** Need bonus weights: the share of empty or dead D / G slots in the per-game lineup. */
export function draftNeed(baseLineup: Pick<PlanLineup, "slots">): Partial<Record<DraftGroup, number>> {
  const need: Partial<Record<DraftGroup, number>> = {};
  for (const g of ["D", "G"] as const) {
    const slots = baseLineup.slots.filter((s) => s.slot === g);
    const empty = slots.filter((s) => !s.id || s.value <= 0).length;
    need[g] = slots.length ? empty / slots.length : 0;
  }
  return need;
}

/**
 * The pool the draft helper ranks (healthy available projected players with
 * a positive season value) and the share of other teams' picks expected to
 * land in it. About half the picks in this dynasty draft are unprojected
 * prospects, who never leave the projected pool: only the observed share of
 * picks spent on pool players (smoothed) counts toward the players expected
 * gone ahead of each of yours.
 */
export function draftPoolInputs(
  state: StateSnapshot,
  values: ValuesSnapshot,
  available: readonly string[] = availableProjected(state, values),
  cfg: FantraxLeagueConfig = CAPTAINS_DYNASTY,
  /** Season points over replacement by Fantrax id, where the league models it. */
  vor: ReadonlyMap<string, number> | null = null,
): { pool: DraftPoolPlayer[]; poolShare: number } {
  const pool: DraftPoolPlayer[] = available
    .filter((id) => !isRuledOut({ team: values.players[id]!.t, icons: state.icons[id] ?? [] }))
    .map((id) => {
      const rec = values.players[id]!;
      // The league's own token vocabulary: reading the group names as tokens
      // left every pure LW / RW in no group, hence with no VONA at all.
      const groups = eligibleGroups(rec.e, cfg);
      const v = vor?.get(id);
      return {
        id,
        groups,
        seasonFp: seasonFp(rec, cfg),
        ...(v !== undefined ? { vor: v } : {}),
        adp: state.adp[id] ?? Number.POSITIVE_INFINITY,
      };
    })
    .filter((p) => p.seasonFp > 0);
  const made = (state.draft?.picks ?? []).filter((p) => p.playerId);
  const fromPool = made.filter((p) => values.players[p.playerId!]?.src === "proj").length;
  return { pool, poolShare: (fromPool + 1) / (made.length + 2) };
}
