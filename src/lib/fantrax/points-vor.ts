/**
 * Value over replacement for a Fantrax POINTS league.
 *
 * A points league needs no z-scores: `values.json` already gives each player
 * a season total in the league's own scoring. What it does not give is what
 * that total is worth, and that is entirely a question of how deep the
 * position is — 8 forwards on a 12-team roster and 6 D on a 32-team one are
 * not the same market at all.
 *
 * Method (the same as `src/lib/leagues/category-vor.ts`, on points instead of
 * z units, so the two leagues answer "how scarce is this?" the same way):
 *
 *  1. Seat every team's starters at once, best player first, into the
 *     league-wide seat counts (32 x C4 LW4 RW4 D6 G2 = 640 seats in
 *     Slapshot), with multi-eligibility handled by `fillSlots`: keeping a
 *     player whenever SOME reshuffle of the already-seated ones makes room is
 *     exactly optimal, because "who can all be seated at once" is a
 *     transversal matroid.
 *  2. Fill the reserve seats with the best players left (`maxReserve` per
 *     team), capped at `reserveGoaliesPerTeam` goalies so 32 backup keepers
 *     cannot eat the bench a league really spends on skaters.
 *  3. Replacement for a group = the LAST seat that group holds in the fill:
 *     the weakest starter the league fields who could fill it. That is the
 *     starter you end up with if you spend no pick on the position.
 *  4. Flex chains come free: a seated player counts toward the level of EVERY
 *     group he is eligible in, so a C/LW dual sitting in a C seat lowers the
 *     winger level too — losing a winger is covered by sliding him over.
 *  5. VOR = season points − the level of whichever of his groups replaces him
 *     most cheaply (the seat he would really take).
 *
 * Why the LAST STARTER and not the best free agent. Reading replacement off
 * the untaken pool is right in a shallow league (it is what
 * `category-vor.ts` does for a 12-team Yahoo league, where the waiver pool is
 * deep) and wrong here. Slapshot has 32 teams and 40-man rosters — 1,280
 * roster spots for 1,216 players with a projection — so there is no free-agent
 * market left: on the shipped settings (3 reserve seats a team, at most one of
 * them a goalie) the best untaken goalie is worth 36.9 season points against
 * 73.9 for the goalie on the 64th and last starting seat, and with no bench at
 * all only 18.8. Subtracting that would credit every starting goalie with 37 to
 * 55 points of phantom scarcity and stack 31 goalies into the top 100 of a
 * board where goalies are 2 starting seats out of 20.
 *
 * Both levels are computed and both are reported by
 * `npm run league:report -- --league <slug> --vor`, so the choice is auditable
 * rather than hidden: `replacement` is what VOR subtracts, `rawReplacement` is
 * the untaken reading, `marginalStarter` the weakest starter of each SEAT.
 *
 * Why a naive fill is not good enough: seating each player at his primary
 * position alone put Slapshot's LW replacement at 134.5 season points against
 * 48.4 for RW — a 2.7x gap between two interchangeable wings, which pushed
 * Kaprizov, Boldy, Kyle Connor and Robertson 20 to 40 ranks below their points
 * rank. The optimal fill equalises them (LW 87.5, RW 85.9) because it moves
 * LW/RW duals to the open wing, which is what a real manager does.
 *
 * Only for a league whose slots all score a skater the same way
 * (`unmodeledSlots` empty and no captain slot): with a captain slot a player's
 * value depends on WHICH seat he takes, and a single value ordering is then
 * not the right model. `canRankByPoints` is that gate.
 */
import {
  canRankByPoints,
  eligibleGroups,
  eligibleSlots,
  slotTokens,
  type FantraxGroup,
  type FantraxLeagueConfig,
  type SlotCounts,
  type SlotId,
} from "./config";
import { fillSlots, type SlotSpec } from "../leagues/slot-fill";

/**
 * How many of each team's reserve seats go to a goalie. Fantrax reserve seats
 * carry no position, so this is a behavioural assumption, not a rule: managers
 * keep one spare goalie and spend the rest on skaters.
 *
 * It moves `rawReplacement` ONLY. `replacement` — the level VOR actually
 * subtracts — is read off the starting seats, so it is invariant to the bench:
 * measured on the committed Slapshot values it is {C 64.176, LW 64.176,
 * RW 64.524, D 40.542, G 73.905} for every `reserveGoaliesPerTeam` in {0, 1, 3}
 * and every `reservePerTeam` in {0, 3, 17}, while `rawReplacement.G` swings
 * 72.7 / 36.9 / 18.8 across the same settings. The cap is therefore about
 * reporting an honest untaken level, not about protecting the board —
 * `npm run league:report -- --league <slug> --vor` prints both columns and
 * re-checks that invariance every run.
 */
export const RESERVE_GOALIES_PER_TEAM = 1;

export interface VorPlayer {
  /** Fantrax id. */
  id: string;
  /** Fantrax `eligiblePos`, e.g. "LW,RW". */
  eligiblePos: string;
  /** Season fantasy points in this league's scoring. */
  seasonFp: number;
}

export interface VorRow {
  id: string;
  seasonFp: number;
  vor: number;
  /** The group whose replacement level he is measured against. */
  group: FantraxGroup;
  /** Every group he is eligible in, with his VOR there. */
  byGroup: Partial<Record<FantraxGroup, number>>;
  /** Starting slot he was seated in, or null when the league does not start him. */
  slot: SlotId | null;
  /** Rank by VOR, 1 = best. */
  rank: number;
  /** Rank by VOR among the players of `group`. */
  groupRank: number;
}

export interface PointsVor {
  rows: VorRow[];
  byId: Map<string, VorRow>;
  /**
   * Replacement level (season points) per group: what VOR subtracts. The
   * weakest starter the league fields who is eligible in the group.
   */
  replacement: Partial<Record<FantraxGroup, number>>;
  /**
   * The other reading, for comparison: the best player nobody holds who is
   * eligible in the group. Sane for skaters here, meaningless for goalies
   * (see the header), so it is reported, not used.
   */
  rawReplacement: Partial<Record<FantraxGroup, number>>;
  /** Season points of the LAST player seated in each starting slot. */
  marginalStarter: Partial<Record<SlotId, number>>;
  /** Starting seats, and how many were filled. */
  seats: number;
  seated: number;
  /** Players the league is expected to hold (starters + reserves). */
  taken: number;
  /** Projected players nobody holds: the pool replacement is read from. */
  untaken: number;
}

// Defined with the config (the tabs read it without loading this model).
export { canRankByPoints };

/**
 * Points over replacement by Fantrax id for every projected player of a
 * league, or null for a league the model does not cover. One entry point for
 * the sync's baked plan, the browser's re-run of it and the player table, so
 * the three always rank by the same numbers.
 *
 * Availability is deliberately not a filter: the replacement level is a
 * property of the league's 640 starting seats, so it must not move with every
 * pick made.
 */
export function leagueVor(
  cfg: FantraxLeagueConfig,
  values: Record<string, { e: string; src: string }>,
  seasonPoints: (id: string) => number,
  slotCounts?: SlotCounts,
): Map<string, number> | null {
  if (!canRankByPoints(cfg)) return null;
  const players: VorPlayer[] = Object.entries(values)
    .filter(([, r]) => r.src === "proj")
    .map(([id, r]) => ({ id, eligiblePos: r.e, seasonFp: seasonPoints(id) }));
  const out = pointsVor(cfg, players, slotCounts ? { slotCounts } : {});
  return new Map([...out.byId].map(([id, row]) => [id, row.vor]));
}

/** Starting seats of the whole league, in the config's slot order. */
export function leagueSeats(cfg: FantraxLeagueConfig, counts: SlotCounts = cfg.slots.counts): SlotSpec<SlotId>[] {
  return cfg.slots.order
    .filter((slot) => (counts[slot] ?? 0) > 0)
    .map((slot) => ({
      slot,
      capacity: cfg.teams * (counts[slot] ?? 0),
      accepts: slotTokens(cfg, slot),
    }));
}

interface Seatable {
  id: string;
  positions: readonly string[];
  seasonFp: number;
  groups: readonly FantraxGroup[];
  goalie: boolean;
}

export interface PointsVorOptions {
  /** Slot counts of the synced league.json; the config's by default. */
  slotCounts?: SlotCounts;
  /** Reserve seats per team; `limits.maxReserve` by default. */
  reservePerTeam?: number;
  reserveGoaliesPerTeam?: number;
}

/**
 * Rank a pool of projected players by value over replacement.
 *
 * `players` is every player the league could hold with a positive projected
 * season total — rostered or not. Availability is deliberately NOT a filter:
 * replacement is a property of the league's depth, so it must be read off the
 * same pool whoever currently owns whom, or every pick during a draft would
 * move it.
 */
export function pointsVor(
  cfg: FantraxLeagueConfig,
  players: readonly VorPlayer[],
  opts: PointsVorOptions = {},
): PointsVor {
  const counts = opts.slotCounts ?? cfg.slots.counts;
  const goalieToken = cfg.eligibility.goalieToken;
  const seatable: Seatable[] = players
    .filter((p) => p.seasonFp > 0)
    .map((p) => {
      const slots = eligibleSlots(p.eligiblePos, cfg);
      return {
        id: p.id,
        positions: slots,
        seasonFp: p.seasonFp,
        groups: eligibleGroups(p.eligiblePos, cfg),
        goalie: p.eligiblePos.split(",").some((t) => t.trim() === goalieToken),
      };
    })
    // A player eligible for no slot of this league cannot be seated anywhere,
    // so he has no replacement level to be measured against either.
    .filter((p) => p.positions.length > 0 && p.groups.length > 0)
    // Ties by id so the fill, and every level read off it, is deterministic.
    .sort((a, b) => b.seasonFp - a.seasonFp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const seats = leagueSeats(cfg, counts);
  // `positions` here are this league's slot ids, so a seat accepts a player
  // when its own tokens do — `eligibleSlots` already resolved the tokens.
  const fill = fillSlots<string, Seatable, SlotId>(
    seatable,
    seats.map((s) => ({ ...s, accepts: [s.slot] })),
  );

  // The WEAKEST player in each slot, not the last of the list: `fillSlots`
  // appends players in seating order, and the augmenting-path reshuffle moves
  // an already-seated (so higher-valued) player to the end of another slot's
  // list. Reading the last element reported 142.3 for RW against 65.6 for LW.
  const marginalStarter: Partial<Record<SlotId, number>> = {};
  for (const [slot, list] of fill.bySlot) {
    if (list.length > 0) marginalStarter[slot] = Math.min(...list.map((p) => p.seasonFp));
  }

  // Reserve seats: the best players left, in value order, with a CAP (not a
  // reservation) on goalies — a team keeps at most one spare keeper, and the
  // seats it does not spend on one go to skaters.
  const reservePerTeam = Math.max(0, opts.reservePerTeam ?? cfg.limits.maxReserve);
  const reserveSeats = cfg.teams * reservePerTeam;
  const goalieCap = cfg.teams * Math.min(reservePerTeam, opts.reserveGoaliesPerTeam ?? RESERVE_GOALIES_PER_TEAM);
  const taken = new Set<string>(fill.slotOf.keys());
  let used = 0;
  let usedG = 0;
  for (const p of fill.unassigned) {
    if (used >= reserveSeats) break;
    if (p.goalie && usedG >= goalieCap) continue;
    if (p.goalie) usedG++;
    used++;
    taken.add(p.id);
  }
  const untaken = seatable.filter((p) => !taken.has(p.id));

  // ---- the level VOR subtracts: the weakest STARTER of each group.
  // A seated player counts for every group he is eligible in, so the flex
  // chain is built in: a C/LW seated at C is also the winger the league would
  // slide over, and he lowers the W level accordingly.
  const replacement: Partial<Record<FantraxGroup, number>> = {};
  for (const g of cfg.eligibility.groups) {
    let level = Number.POSITIVE_INFINITY;
    for (const [, list] of fill.bySlot) {
      for (const p of list) if (p.groups.includes(g) && p.seasonFp < level) level = p.seasonFp;
    }
    replacement[g] = Number.isFinite(level) ? level : 0;
  }

  // ---- the other reading: the best untaken player eligible in the group.
  const rawReplacement: Partial<Record<FantraxGroup, number>> = {};
  for (const g of cfg.eligibility.groups) {
    const best = untaken.find((p) => p.groups.includes(g));
    rawReplacement[g] = best ? best.seasonFp : (replacement[g] ?? 0);
  }

  // ---- VOR: the group that replaces him most cheaply is the seat he takes
  const scored = seatable.map((p) => {
    const byGroup: Partial<Record<FantraxGroup, number>> = {};
    let best = Number.NEGATIVE_INFINITY;
    let group = p.groups[0]!;
    for (const g of p.groups) {
      const x = p.seasonFp - (replacement[g] ?? 0);
      byGroup[g] = x;
      if (x > best) {
        best = x;
        group = g;
      }
    }
    return { p, vor: best, group, byGroup };
  });
  scored.sort(
    (a, b) => b.vor - a.vor || b.p.seasonFp - a.p.seasonFp || (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0),
  );

  const groupSeen = new Map<FantraxGroup, number>();
  const rows: VorRow[] = scored.map((x, i) => {
    const n = (groupSeen.get(x.group) ?? 0) + 1;
    groupSeen.set(x.group, n);
    return {
      id: x.p.id,
      seasonFp: x.p.seasonFp,
      vor: x.vor,
      group: x.group,
      byGroup: x.byGroup,
      slot: fill.slotOf.get(x.p.id) ?? null,
      rank: i + 1,
      groupRank: n,
    };
  });

  return {
    rows,
    byId: new Map(rows.map((r) => [r.id, r])),
    replacement,
    rawReplacement,
    marginalStarter,
    seats: seats.reduce((n, s) => n + s.capacity, 0),
    seated: fill.slotOf.size,
    taken: taken.size,
    untaken: untaken.length,
  };
}
