import { impliedShotsAgainst } from "../goalie-impact";
import type {
  GoalieProjection,
  PlayerProjection,
  Position,
  SkaterCategory,
  SkaterProjection,
} from "../types";
import { softCapCategoryZ } from "../vor";
import { startingSlotsInFillOrder } from "./profile";
import { fillSlots, type SlotSpec } from "./slot-fill";
import type {
  CategoryLeagueProfile,
  LeagueCategory,
  LeagueGoalieCategory,
  StartingSlot,
} from "./types";

/**
 * Category VOR for an arbitrary H2H-categories profile (the main board's
 * `applyVor` stays hard-wired to `DEFAULT_LEAGUE`; this is the parameterised
 * path, and it never touches `players.json`).
 *
 * Same building blocks as the main engine — z-scores against the draftable
 * pool, equal weight per category (each is one matchup point), the tanh soft
 * cap on hits/blocks, volume-weighted goalie ratio stats — plus what this
 * kind of league needs:
 * - only the profile's categories are scored (e.g. no PIM/FOW),
 * - GAA as goals-against prevented,
 * - replacement from an optimal seat-by-seat fill of every team's lineup
 *   including F/Util flex and multi-eligibility, then bench depth,
 * - a goalie weight derived from matchup leverage instead of a hand anchor.
 */

export type SkaterGroup = "F" | "D";
export type BenchSlot = "BN";
export type ModelSlot = StartingSlot | BenchSlot;

export type LeaguePoolPlayer = Pick<
  PlayerProjection,
  | "id"
  | "name"
  | "team"
  | "position"
  | "positions"
  | "isGoalie"
  | "gamesPlayed"
  | "projection"
> & { primaryPosition?: Position };

export interface SkaterScale {
  /** Common centre (mean over the reference skaters, F and D together). */
  mean: number;
  groupMeans: Record<SkaterGroup, number>;
  /** Pooled within-group SD — the category's z unit. */
  sd: number;
}

export interface GoalieScale {
  mean: number;
  sd: number;
}

export interface GoalieBaseline {
  savePct: number;
  goalsAgainstPerGame: number;
  /**
   * Shutouts per "quality game" of the reference goalies:
   * ΣSO ÷ Σ(GP × e^(−GA/GP)). Scales the structural shutout estimate
   * (see `smoothedShutouts`) to the pool's actual shutout total.
   */
  shutoutsPerQualityGame: number;
}

export interface CategoryScales {
  skater: Partial<Record<SkaterCategory, SkaterScale>>;
  goalie: Partial<Record<LeagueGoalieCategory, GoalieScale>>;
  /** Shots-weighted SV% and GA per game of the reference goalies. */
  goalieBaseline: GoalieBaseline;
}

export interface GoalieWeightBreakdown {
  /** Multiplier applied to a goalie's summed category z. */
  weight: number;
  /** Mean goalie-category leverage ÷ mean skater-category leverage. */
  leverageRatio: number;
  /**
   * Mean goalie predictability ÷ mean skater predictability, with the
   * per-category factor 0.75 + 0.25·R² taken *unshrunk* (a modelling choice,
   * see `deriveGoalieWeight`).
   */
  predictabilityRatio: number;
  /**
   * The same ratio after the main board's half-shrink toward 1
   * (`stat-difficulty.ts`, SCARCITY_TILT = 0.5) applied across all the
   * league's categories — the softer alternative, reported for sensitivity.
   */
  predictabilityRatioShrunk: number;
  /** Per-category leverage: z unit ÷ weekly-noise SD of a team's total. */
  leverage: Partial<Record<LeagueCategory, number>>;
  /** Average team's goalie appearances per week used for goalie noise. */
  goalieAppearancesPerWeek: number;
}

export interface ScoredLeaguePlayer {
  id: number;
  name: string;
  team: string;
  positions: Position[];
  isGoalie: boolean;
  group: SkaterGroup | "G";
  gamesPlayed: number;
  /** Projected stat per category in display units (GAA, SV% as rates). */
  stats: Partial<Record<LeagueCategory, number>>;
  /** Goalie raw volumes needed to aggregate team GAA / SV%. */
  goalieRaw?: { saves: number; goalsAgainst: number };
  /** Per-category z in value units (soft-capped, before goalie weight). */
  z: Partial<Record<LeagueCategory, number>>;
  /** Σ z (skaters) or goalieWeight × Σ z (goalies). */
  value: number;
  vor: number;
  vorPosition: Position;
  vorByPosition: Partial<Record<Position, number>>;
  rank: number;
  /** Rank among players eligible at each position (by that position's VOR); F = forwards. */
  positionRanks: Partial<Record<Position | "F", number>>;
  /** Where the model's league-wide fill seats him (null = undrafted). */
  modelSlot: ModelSlot | null;
}

export interface AverageTeam {
  /** Mean per-category z of the players the fill seats in each starting slot. */
  slotZ: Partial<Record<StartingSlot, Partial<Record<LeagueCategory, number>>>>;
  /**
   * Mean projected line per seat: skater categories for skater slots; goalie
   * volumes (wins, shutouts, saves, goalsAgainst, gamesPlayed) for G.
   */
  slotStats: Partial<Record<StartingSlot, Record<string, number>>>;
  /** League-average team's summed z per category (starters only). */
  zTotals: Partial<Record<LeagueCategory, number>>;
  /** League-average team's projected category line (display units). */
  totals: Partial<Record<LeagueCategory, number>>;
}

export interface CategoryVorResult {
  players: ScoredLeaguePlayer[];
  scales: CategoryScales;
  goalieWeight: GoalieWeightBreakdown;
  /** Value of the best undrafted player eligible at each slot. */
  replacementLevels: Partial<Record<Position | "F" | "Util", number>>;
  averageTeam: AverageTeam;
  /** Ids the model drafts (starters + bench), in value order. */
  draftedIds: number[];
}

export interface CategoryVorOptions {
  /**
   * Holdout R² per category from the projection models (the main dataset's
   * `categoryWeights[*][cat].r2`). Feeds the goalie predictability ratio.
   */
  r2?: Partial<Record<string, number | null>>;
  /** Pin the goalie weight instead of deriving it (tests / what-ifs). */
  goalieWeight?: number;
  /**
   * Bench goalies per team. The 4-appearance weekly minimum is roughly two
   * starters' output (~2 starts each), so a third goalie is standard to cover
   * light weeks; a fourth rarely sees a G slot. Default 1.
   */
  benchGoaliesPerTeam?: number;
}

const FORWARDS: readonly Position[] = ["C", "LW", "RW"];
const SKATER_POSITIONS: readonly Position[] = ["C", "LW", "RW", "D"];
const ALL_POSITIONS: readonly Position[] = ["C", "LW", "RW", "D", "G"];

/**
 * Per-category predictability factor, the same formula the main board starts
 * from (`stat-difficulty.ts` skillFactor): a category whose projections
 * explain holdout variance well is trusted more, floored at 0.75 so a model
 * miss can't zero a category. (The main board then shrinks it halfway toward
 * 1 *within* the skater and goalie groups; it never compares the groups —
 * see `deriveGoalieWeight` for how this path uses it.)
 */
export function predictability(r2: number | null | undefined): number {
  if (r2 == null || !Number.isFinite(r2)) return 1;
  return 0.75 + 0.25 * Math.max(0, Math.min(1, r2));
}

/** The main board's shrink toward 1 (`stat-difficulty.ts` SCARCITY_TILT). */
export const PREDICTABILITY_SHRINK = 0.5;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function sampleSd(values: number[]): number {
  if (values.length < 2) return 1;
  const m = mean(values);
  const v = values.reduce((s, x) => s + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v) || 1;
}

export function skaterGroup(p: Pick<LeaguePoolPlayer, "primaryPosition" | "position" | "positions">): SkaterGroup {
  const primary = p.primaryPosition ?? p.position ?? p.positions[0];
  return primary === "D" ? "D" : "F";
}

function eligiblePositions(p: Pick<LeaguePoolPlayer, "positions" | "position">): Position[] {
  const list = p.positions.length > 0 ? p.positions : [p.position];
  return [...new Set(list)];
}

interface GoalieVolumes {
  gp: number;
  saves: number;
  shots: number;
  goalsAgainst: number;
  wins: number;
  shutouts: number;
}

/**
 * Weight of the projection's own (integer-rounded) shutout count in the
 * smoothed value; the rest is the structural estimate. players.json rounds
 * shutouts to 1–4, and rounding alone (SD ≈ 0.29) is ~0.36 z — larger than
 * the real gaps inside the dense goalie tier — while the shutout model's
 * holdout R² is below zero, so the rounded count carries little signal of
 * its own.
 */
export const SHUTOUT_PROJECTION_SHARE = 0.5;

/**
 * Shutouts as a smooth function of workload and quality: half the projected
 * count, half GP × P(no goal in a game) with P = e^(−GA/GP) (Poisson), scaled
 * to the reference pool's shutout total.
 */
export function smoothedShutouts(
  raw: { gp: number; goalsAgainst: number; shutouts: number },
  base: Pick<GoalieBaseline, "shutoutsPerQualityGame">,
): number {
  if (!(raw.gp > 0) || !(base.shutoutsPerQualityGame > 0)) return raw.shutouts;
  const structural = base.shutoutsPerQualityGame * raw.gp * Math.exp(-raw.goalsAgainst / raw.gp);
  return SHUTOUT_PROJECTION_SHARE * raw.shutouts + (1 - SHUTOUT_PROJECTION_SHARE) * structural;
}

/**
 * Goalie volumes. With `base`, `shutouts` is the smoothed value every
 * consumer (z, display, team totals, leverage) uses; without it (only while
 * computing the baseline itself) the raw projection.
 */
function goalieVolumes(p: LeaguePoolPlayer, base?: GoalieBaseline): GoalieVolumes {
  const proj = p.projection as GoalieProjection;
  const shots = impliedShotsAgainst(proj);
  const raw = {
    gp: p.gamesPlayed,
    saves: proj.saves,
    shots,
    goalsAgainst: Math.max(0, shots - proj.saves),
    wins: proj.wins,
    shutouts: proj.shutouts,
  };
  return base ? { ...raw, shutouts: smoothedShutouts(raw, base) } : raw;
}

function goalieBaseline(reference: LeaguePoolPlayer[]): GoalieBaseline {
  let saves = 0;
  let shots = 0;
  let ga = 0;
  let gp = 0;
  let so = 0;
  let qualityGames = 0;
  for (const p of reference) {
    if (!p.isGoalie) continue;
    const v = goalieVolumes(p);
    saves += v.saves;
    shots += v.shots;
    ga += v.goalsAgainst;
    gp += v.gp;
    so += v.shutouts;
    if (v.gp > 0) qualityGames += v.gp * Math.exp(-v.goalsAgainst / v.gp);
  }
  return {
    savePct: shots > 0 ? saves / shots : 0,
    goalsAgainstPerGame: gp > 0 ? ga / gp : 0,
    shutoutsPerQualityGame: qualityGames > 0 ? so / qualityGames : 0,
  };
}

/**
 * Goalie category value in *team-contribution* units.
 * - SV%: saves above what a league-average goalie stops on the same shots —
 *   team SV% is Σsaves ÷ Σshots, so impact scales with workload.
 * - GAA: goals against prevented vs the league-average rate over the same
 *   games. Team GAA is ΣGA × 60 ÷ Σminutes; with minutes ≈ 60 × GP the
 *   goalie's pull on it is (lg GA/GP × GP − GA). GA = shots − saves, shots =
 *   saves ÷ SV%, so it rewards both stopping pucks and facing fewer of them.
 */
function goalieScoringValue(
  v: GoalieVolumes,
  cat: LeagueGoalieCategory,
  base: GoalieBaseline,
): number {
  switch (cat) {
    case "wins":
      return v.wins;
    case "shutouts":
      return v.shutouts;
    case "savePct":
      return v.saves - base.savePct * v.shots;
    case "goalsAgainstAverage":
      return base.goalsAgainstPerGame * v.gp - v.goalsAgainst;
  }
}

function goalieDisplayValue(v: GoalieVolumes, cat: LeagueGoalieCategory): number {
  switch (cat) {
    case "wins":
      return v.wins;
    case "shutouts":
      return v.shutouts;
    case "savePct":
      return v.shots > 0 ? v.saves / v.shots : 0;
    case "goalsAgainstAverage":
      return v.gp > 0 ? v.goalsAgainst / v.gp : 0;
  }
}

/**
 * Z scales over a reference pool (the draftable pool after pass 1).
 *
 * Skaters: z = (x − common mean) / pooled within-group SD, with F and D as the
 * groups. The *unit* is within-group because every team starts a fixed
 * 7F/4D core, so what separates teams is which forward / which defenseman
 * they start (the main engine's argument, `vor.ts` withinPositionStats). The
 * *centre* is common rather than per-group because Util (any skater) makes D
 * and F compete for the same seat: a D's blocks and an F's goals must land on
 * one value scale for the flex fill to compare them. C/LW/RW are one group —
 * without faceoffs their category profiles barely differ, and F/Util make
 * them interchangeable anyway.
 */
export function computeCategoryScales(
  profile: Pick<CategoryLeagueProfile, "categories">,
  reference: LeaguePoolPlayer[],
): CategoryScales {
  const skaters = reference.filter((p) => !p.isGoalie);
  const goalies = reference.filter((p) => p.isGoalie);
  const scales: CategoryScales = {
    skater: {},
    goalie: {},
    goalieBaseline: goalieBaseline(goalies),
  };

  for (const cat of profile.categories.skater) {
    const byGroup: Record<SkaterGroup, number[]> = { F: [], D: [] };
    for (const p of skaters) {
      const x = (p.projection as SkaterProjection)[cat] ?? 0;
      if (Number.isFinite(x)) byGroup[skaterGroup(p)].push(x);
    }
    const groupMeans = { F: mean(byGroup.F), D: mean(byGroup.D) };
    let ssq = 0;
    let n = 0;
    for (const g of ["F", "D"] as const) {
      for (const x of byGroup[g]) ssq += (x - groupMeans[g]) ** 2;
      n += byGroup[g].length;
    }
    const groupsUsed = (byGroup.F.length > 0 ? 1 : 0) + (byGroup.D.length > 0 ? 1 : 0);
    const sd = n > groupsUsed ? Math.sqrt(ssq / (n - groupsUsed)) || 1 : 1;
    scales.skater[cat] = {
      mean: mean([...byGroup.F, ...byGroup.D]),
      groupMeans,
      sd,
    };
  }

  for (const cat of profile.categories.goalie) {
    const values = goalies.map((p) =>
      goalieScoringValue(goalieVolumes(p, scales.goalieBaseline), cat, scales.goalieBaseline),
    );
    scales.goalie[cat] = { mean: mean(values), sd: sampleSd(values) };
  }

  return scales;
}

/**
 * Per-category z for one player.
 *
 * Skaters: group offset + soft-capped deviation from the group mean. The
 * tanh cap (same 2.75 cap as the main board, hits/blocks only) must see the
 * deviation from *position peers*: measured from the common centre, an
 * ordinary defenseman's blocks already sit ~+2 and the cap would flatten
 * every D instead of only the 200-block outliers it exists for.
 */
export function categoryZ(
  profile: Pick<CategoryLeagueProfile, "categories">,
  player: LeaguePoolPlayer,
  scales: CategoryScales,
): Partial<Record<LeagueCategory, number>> {
  const z: Partial<Record<LeagueCategory, number>> = {};
  if (player.isGoalie) {
    const v = goalieVolumes(player, scales.goalieBaseline);
    for (const cat of profile.categories.goalie) {
      const s = scales.goalie[cat];
      if (!s) continue;
      z[cat] = (goalieScoringValue(v, cat, scales.goalieBaseline) - s.mean) / s.sd;
    }
    return z;
  }
  const group = skaterGroup(player);
  for (const cat of profile.categories.skater) {
    const s = scales.skater[cat];
    if (!s) continue;
    const x = (player.projection as SkaterProjection)[cat] ?? 0;
    const offset = (s.groupMeans[group] - s.mean) / s.sd;
    const deviation = (x - s.groupMeans[group]) / s.sd;
    z[cat] = offset + softCapCategoryZ(cat, deviation);
  }
  return z;
}

function displayStats(
  profile: Pick<CategoryLeagueProfile, "categories">,
  player: LeaguePoolPlayer,
  base: GoalieBaseline,
): Partial<Record<LeagueCategory, number>> {
  const stats: Partial<Record<LeagueCategory, number>> = {};
  if (player.isGoalie) {
    const v = goalieVolumes(player, base);
    for (const cat of profile.categories.goalie) stats[cat] = goalieDisplayValue(v, cat);
  } else {
    for (const cat of profile.categories.skater) {
      stats[cat] = (player.projection as SkaterProjection)[cat] ?? 0;
    }
  }
  return stats;
}

function sumZ(z: Partial<Record<LeagueCategory, number>>): number {
  let s = 0;
  for (const v of Object.values(z)) if (Number.isFinite(v)) s += v as number;
  return s;
}

export interface Valued {
  player: LeaguePoolPlayer;
  id: number;
  positions: Position[];
  z: Partial<Record<LeagueCategory, number>>;
  zSum: number;
  value: number;
}

function valuePool(
  profile: Pick<CategoryLeagueProfile, "categories">,
  players: LeaguePoolPlayer[],
  scales: CategoryScales,
  goalieWeight: number,
): Valued[] {
  return players.map((player) => {
    const z = categoryZ(profile, player, scales);
    const zSum = sumZ(z);
    return {
      player,
      id: player.id,
      positions: eligiblePositions(player),
      z,
      zSum,
      value: player.isGoalie ? zSum * goalieWeight : zSum,
    };
  });
}

function byValueDesc(a: Valued, b: Valued): number {
  return b.value - a.value || a.id - b.id;
}

export interface LeagueFill {
  starters: Map<StartingSlot, Valued[]>;
  bench: Valued[];
  slotOf: Map<number, ModelSlot>;
  drafted: Valued[];
  undrafted: Valued[];
}

/**
 * Seat all teams' starters optimally (see `fillSlots`), then bench depth:
 * `benchGoaliesPerTeam` goalies per team plus the best remaining skaters for
 * the other BN seats. Everyone left is the waiver pool.
 */
function fillLeague(
  profile: CategoryLeagueProfile,
  valued: Valued[],
  benchGoaliesPerTeam: number,
): LeagueFill {
  const ordered = [...valued].sort(byValueDesc);
  const slots: SlotSpec<StartingSlot>[] = startingSlotsInFillOrder(profile).map(
    (slot) => ({
      slot,
      capacity: profile.teams * profile.roster[slot],
      accepts: profile.slotEligibility[slot],
    }),
  );
  const fill = fillSlots(ordered, slots);
  const slotOf = new Map<number, ModelSlot>(fill.slotOf);

  const benchPerTeam = profile.roster.BN ?? 0;
  const benchGoalies = Math.min(benchPerTeam, benchGoaliesPerTeam) * profile.teams;
  const benchSkaters = benchPerTeam * profile.teams - benchGoalies;
  const bench: Valued[] = [];
  let g = 0;
  let s = 0;
  for (const v of fill.unassigned) {
    if (v.player.isGoalie ? g >= benchGoalies : s >= benchSkaters) continue;
    if (v.player.isGoalie) g++;
    else s++;
    bench.push(v);
    slotOf.set(v.id, "BN");
  }

  const drafted = ordered.filter((v) => slotOf.has(v.id));
  const undrafted = ordered.filter((v) => !slotOf.has(v.id));
  return { starters: fill.bySlot, bench, slotOf, drafted, undrafted };
}

/**
 * Exchange rate between goalie and skater z units.
 *
 * In H2H a category is won week by week, so a stat's worth is how far it
 * moves P(win) of that week's category: ∂P/∂x ∝ 1 / SD(weekly team total).
 * One z unit is `sd_c` season units, so its leverage is
 *   λ_c = sd_c / √Var(average team's season total_c)
 * (weeks cancel between categories). Noise model: every counting stat
 * (goals … blocks, wins, shutouts, goals against) Poisson; SV% binomial per
 * shot faced, in saves units.
 * The average team's goalie volume is floored at the league's weekly
 * appearance minimum — teams stream to reach it.
 *
 * Two goalies carry a team's whole goalie line while twelve skaters share the
 * skater line, and that is what λ captures: each goalie z unit is a bigger
 * slice of a smaller weekly total. Within a group the categories stay
 * equally weighted (one matchup point each, like the main board); only the
 * *mean* leverage crosses groups. The mean is arithmetic on purpose: a
 * player's value is an unweighted sum of his category z, so the leverage of
 * "one z unit, spread over the group's categories" is the arithmetic mean
 * (HIT, the most volatile-relative-to-noise skater category, does pull it up
 * — that is real: a hitter moves weekly HIT more reliably than a scorer
 * moves G).
 *
 * The result is then scaled by a predictability ratio: goalie projections
 * barely beat a flat mean out of sample while skater ones explain ~75–85 %.
 * This cross-group discount is a *modelling choice*, not a rule the main
 * board applies (it discounts goalies with its own hand-set factor): it uses
 * the per-category factor 0.75 + 0.25·R² unshrunk. The main board's
 * half-shrink applied across all ten categories would give a softer ratio;
 * it is reported as `predictabilityRatioShrunk` for sensitivity.
 */
export function deriveGoalieWeight(
  profile: CategoryLeagueProfile,
  scales: CategoryScales,
  starters: Map<StartingSlot, Valued[]>,
  r2: CategoryVorOptions["r2"] = {},
): GoalieWeightBreakdown {
  const teams = profile.teams;
  const leverage: Partial<Record<LeagueCategory, number>> = {};

  const skaterStarters: Valued[] = [];
  const goalieStarters: Valued[] = [];
  for (const [slot, list] of starters) {
    (slot === "G" ? goalieStarters : skaterStarters).push(...list);
  }

  for (const cat of profile.categories.skater) {
    const total =
      skaterStarters.reduce(
        (s, v) => s + ((v.player.projection as SkaterProjection)[cat] ?? 0),
        0,
      ) / teams;
    const sd = scales.skater[cat]?.sd ?? 1;
    leverage[cat] = total > 0 ? sd / Math.sqrt(total) : 0;
  }

  const vol = goalieStarters.map((v) => goalieVolumes(v.player, scales.goalieBaseline));
  const teamGp = vol.reduce((s, v) => s + v.gp, 0) / teams;
  const floorGp = profile.minGoalieAppearancesPerWeek * profile.matchupWeeks;
  const scale = teamGp > 0 ? Math.max(1, floorGp / teamGp) : 1;
  const team = {
    gp: teamGp * scale,
    wins: (vol.reduce((s, v) => s + v.wins, 0) / teams) * scale,
    shutouts: (vol.reduce((s, v) => s + v.shutouts, 0) / teams) * scale,
    shots: (vol.reduce((s, v) => s + v.shots, 0) / teams) * scale,
    ga: (vol.reduce((s, v) => s + v.goalsAgainst, 0) / teams) * scale,
  };
  const sv = scales.goalieBaseline.savePct;
  const variance: Record<LeagueGoalieCategory, number> = {
    // Poisson, not binomial-per-start: the number of starts in a week
    // varies too (2–6), and Bernoulli wins over a Poisson start count
    // compound to exactly Poisson — same treatment as skater counts.
    wins: team.wins,
    shutouts: team.shutouts,
    savePct: team.shots * sv * (1 - sv),
    goalsAgainstAverage: team.ga,
  };
  for (const cat of profile.categories.goalie) {
    const sd = scales.goalie[cat]?.sd ?? 1;
    leverage[cat] = variance[cat] > 0 ? sd / Math.sqrt(variance[cat]) : 0;
  }

  const skaterLev = mean(profile.categories.skater.map((c) => leverage[c] ?? 0));
  const goalieLev = mean(profile.categories.goalie.map((c) => leverage[c] ?? 0));
  const leverageRatio = skaterLev > 0 ? goalieLev / skaterLev : 1;

  // GAA has no model of its own: it is built from saves and SV%, so it is
  // only as predictable as the weaker of the two.
  const goalieR2 = (cat: LeagueGoalieCategory): number | null | undefined =>
    cat === "goalsAgainstAverage"
      ? Math.min(r2.saves ?? Infinity, r2.savePct ?? Infinity)
      : r2[cat];
  const skaterPred = mean(profile.categories.skater.map((c) => predictability(r2[c])));
  const goaliePred = mean(
    profile.categories.goalie.map((c) => {
      const v = goalieR2(c);
      return predictability(v === Infinity ? null : v);
    }),
  );
  const predictabilityRatio = skaterPred > 0 ? goaliePred / skaterPred : 1;

  // Sensitivity: the main board's half-shrink toward 1, normalised over all
  // of this league's categories (so the two groups become comparable).
  const nSk = profile.categories.skater.length;
  const nG = profile.categories.goalie.length;
  const allMean = (skaterPred * nSk + goaliePred * nG) / Math.max(1, nSk + nG);
  const shrink = (x: number) => 1 + PREDICTABILITY_SHRINK * (allMean > 0 ? x / allMean - 1 : 0);
  const predictabilityRatioShrunk = shrink(skaterPred) > 0 ? shrink(goaliePred) / shrink(skaterPred) : 1;

  return {
    weight: leverageRatio * predictabilityRatio,
    leverageRatio,
    predictabilityRatio,
    predictabilityRatioShrunk,
    leverage,
    goalieAppearancesPerWeek: team.gp / profile.matchupWeeks,
  };
}

/**
 * Replacement value per position and flex slot.
 *
 * Raw level = the best undrafted player eligible there (F = best undrafted
 * forward, Util = best undrafted skater). A position's *effective* level
 * also follows flex chains: when a flex slot S that accepts P seats at least
 * one P-eligible player league-wide, losing a P starter is covered by moving
 * that player from S into the P seat and refilling S from waivers — so P is
 * replaced at S's level, not at the best undrafted P. (Here: centres sit in
 * F and Util, so C is replaced at the F level; no D sits in Util, so D keeps
 * its own level.) Player VOR, slot VOR and the published board all use the
 * effective levels.
 */
function replacementLevels(
  profile: CategoryLeagueProfile,
  undrafted: Valued[],
  drafted: Valued[],
  starters: Map<StartingSlot, Valued[]>,
): CategoryVorResult["replacementLevels"] {
  const raw: Partial<Record<Position, number>> = {};
  for (const pos of ALL_POSITIONS) {
    const best = undrafted.find((v) => v.positions.includes(pos));
    if (best) {
      raw[pos] = best.value;
      continue;
    }
    // Pool exhausted (tiny test pools only): the weakest drafted player at
    // the position is the marginal one.
    const eligible = drafted.filter((v) => v.positions.includes(pos));
    raw[pos] = eligible.length > 0 ? Math.min(...eligible.map((v) => v.value)) : 0;
  }
  const bestOf = (list: readonly Position[]) =>
    Math.max(...list.map((p) => raw[p] ?? -Infinity));

  const flexLevel = new Map<StartingSlot, number>();
  for (const slot of Object.keys(profile.slotEligibility) as StartingSlot[]) {
    const accepts = profile.slotEligibility[slot];
    if (accepts.length > 1) flexLevel.set(slot, bestOf(accepts));
  }

  const levels: CategoryVorResult["replacementLevels"] = {};
  for (const pos of ALL_POSITIONS) {
    let level = raw[pos] ?? 0;
    for (const [slot, flex] of flexLevel) {
      if (!profile.slotEligibility[slot].includes(pos)) continue;
      const seatsOne = (starters.get(slot) ?? []).some((v) => v.positions.includes(pos));
      if (seatsOne && flex > level) level = flex;
    }
    levels[pos] = level;
  }
  levels.F = bestOf(FORWARDS);
  levels.Util = bestOf(SKATER_POSITIONS);
  return levels;
}

function averageTeam(
  profile: CategoryLeagueProfile,
  starters: Map<StartingSlot, Valued[]>,
  base: GoalieBaseline,
): AverageTeam {
  const cats: LeagueCategory[] = [
    ...profile.categories.skater,
    ...profile.categories.goalie,
  ];
  const slotZ: AverageTeam["slotZ"] = {};
  const slotStats: AverageTeam["slotStats"] = {};
  const zTotals: AverageTeam["zTotals"] = {};
  for (const [slot, list] of starters) {
    const perCat: Partial<Record<LeagueCategory, number>> = {};
    for (const cat of cats) {
      const vals = list.map((v) => v.z[cat]).filter((x): x is number => x != null);
      if (vals.length === 0) continue;
      perCat[cat] = mean(vals);
      zTotals[cat] = (zTotals[cat] ?? 0) + perCat[cat]! * (profile.roster[slot] ?? 0);
    }
    slotZ[slot] = perCat;
    if (slot === "G") {
      const vol = list.map((v) => goalieVolumes(v.player, base));
      slotStats[slot] = {
        wins: mean(vol.map((v) => v.wins)),
        shutouts: mean(vol.map((v) => v.shutouts)),
        saves: mean(vol.map((v) => v.saves)),
        goalsAgainst: mean(vol.map((v) => v.goalsAgainst)),
        gamesPlayed: mean(vol.map((v) => v.gp)),
      };
    } else {
      const line: Record<string, number> = {};
      for (const cat of profile.categories.skater) {
        line[cat] = mean(
          list.map((v) => (v.player.projection as SkaterProjection)[cat] ?? 0),
        );
      }
      slotStats[slot] = line;
    }
  }

  const totals: AverageTeam["totals"] = {};
  const teams = profile.teams;
  const skaters = [...starters].filter(([s]) => s !== "G").flatMap(([, l]) => l);
  for (const cat of profile.categories.skater) {
    totals[cat] =
      skaters.reduce(
        (s, v) => s + ((v.player.projection as SkaterProjection)[cat] ?? 0),
        0,
      ) / teams;
  }
  const g = (starters.get("G") ?? []).map((v) => goalieVolumes(v.player, base));
  const sum = (f: (v: GoalieVolumes) => number) => g.reduce((s, v) => s + f(v), 0);
  for (const cat of profile.categories.goalie) {
    if (cat === "wins") totals.wins = sum((v) => v.wins) / teams;
    if (cat === "shutouts") totals.shutouts = sum((v) => v.shutouts) / teams;
    if (cat === "savePct") {
      const shots = sum((v) => v.shots);
      totals.savePct = shots > 0 ? sum((v) => v.saves) / shots : base.savePct;
    }
    if (cat === "goalsAgainstAverage") {
      const gp = sum((v) => v.gp);
      totals.goalsAgainstAverage =
        gp > 0 ? sum((v) => v.goalsAgainst) / gp : base.goalsAgainstPerGame;
    }
  }
  return { slotZ, slotStats, zTotals, totals };
}

/**
 * Two passes, like `applyVor`: pass 1 scores against the whole pool only to
 * find who a 12-team league actually drafts; pass 2 re-centres and re-scales
 * every category on that drafted pool (hundreds of near-zero fringe players
 * would otherwise set the means and SDs), then fills the league again and
 * reads replacement off the waiver pool.
 */
export function applyCategoryVor(
  profile: CategoryLeagueProfile,
  players: LeaguePoolPlayer[],
  options: CategoryVorOptions = {},
): CategoryVorResult {
  const benchGoalies = options.benchGoaliesPerTeam ?? 1;

  // Pass 1. The goalie weight cannot change who is drafted — goalie and
  // skater seats never overlap, bench composition is fixed — so 1 is fine.
  const passOneScales = computeCategoryScales(profile, players);
  const passOne = fillLeague(
    profile,
    valuePool(profile, players, passOneScales, 1),
    benchGoalies,
  );
  const reference = passOne.drafted.map((v) => v.player);

  // Pass 2.
  const scales = computeCategoryScales(profile, reference);
  const unweighted = fillLeague(
    profile,
    valuePool(profile, players, scales, 1),
    benchGoalies,
  );
  const derived = deriveGoalieWeight(profile, scales, unweighted.starters, options.r2);
  const goalieWeight: GoalieWeightBreakdown =
    options.goalieWeight != null ? { ...derived, weight: options.goalieWeight } : derived;

  const valued = valuePool(profile, players, scales, goalieWeight.weight);
  const league = fillLeague(profile, valued, benchGoalies);
  const replacement = replacementLevels(profile, league.undrafted, league.drafted, league.starters);

  const scored = valued.map((v) => {
    const vorByPosition: Partial<Record<Position, number>> = {};
    let vor = -Infinity;
    let vorPosition: Position = v.positions[0] ?? v.player.position;
    for (const pos of v.positions) {
      const x = v.value - (replacement[pos] ?? 0);
      vorByPosition[pos] = x;
      if (x > vor) {
        vor = x;
        vorPosition = pos;
      }
    }
    return {
      v,
      vor: Number.isFinite(vor) ? vor : 0,
      vorPosition,
      vorByPosition,
    };
  });
  scored.sort((a, b) => b.vor - a.vor || b.v.value - a.v.value || a.v.id - b.v.id);

  const positionRanks = new Map<number, Partial<Record<Position | "F", number>>>();
  const rankBy = (
    key: Position | "F",
    eligible: (s: (typeof scored)[number]) => boolean,
    score: (s: (typeof scored)[number]) => number,
  ) => {
    scored
      .filter(eligible)
      .sort((a, b) => score(b) - score(a) || a.v.id - b.v.id)
      .forEach((s, i) => {
        const entry = positionRanks.get(s.v.id) ?? {};
        entry[key] = i + 1;
        positionRanks.set(s.v.id, entry);
      });
  };
  for (const pos of ALL_POSITIONS) {
    rankBy(
      pos,
      (s) => s.v.positions.includes(pos),
      (s) => s.vorByPosition[pos] ?? -Infinity,
    );
  }
  rankBy(
    "F",
    (s) => s.v.positions.some((p) => FORWARDS.includes(p)),
    (s) =>
      Math.max(...FORWARDS.map((p) => s.vorByPosition[p] ?? -Infinity)),
  );

  const players_: ScoredLeaguePlayer[] = scored.map((s, index) => {
    const p = s.v.player;
    const vol = p.isGoalie ? goalieVolumes(p, scales.goalieBaseline) : null;
    return {
      id: p.id,
      name: p.name,
      team: p.team,
      positions: s.v.positions,
      isGoalie: p.isGoalie,
      group: p.isGoalie ? "G" : skaterGroup(p),
      gamesPlayed: p.gamesPlayed,
      stats: displayStats(profile, p, scales.goalieBaseline),
      ...(vol ? { goalieRaw: { saves: vol.saves, goalsAgainst: vol.goalsAgainst } } : {}),
      z: s.v.z,
      value: s.v.value,
      vor: s.vor,
      vorPosition: s.vorPosition,
      vorByPosition: s.vorByPosition,
      rank: index + 1,
      positionRanks: positionRanks.get(p.id) ?? {},
      modelSlot: league.slotOf.get(p.id) ?? null,
    };
  });

  return {
    players: players_,
    scales,
    goalieWeight,
    replacementLevels: replacement,
    averageTeam: averageTeam(profile, league.starters, scales.goalieBaseline),
    draftedIds: league.drafted.map((v) => v.id),
  };
}
