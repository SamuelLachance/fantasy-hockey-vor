/**
 * Draft helper: value over next available (VONA) for the user's next pick,
 * on a probabilistic board.
 *
 * Availability. Before one of my picks, other teams make `m` picks; a share
 * `s` of them (`poolShare`, estimated from the picks made so far) lands on
 * players in the projected pool, the rest on prospects outside it. So the
 * number of pool players taken is N ~ Binomial(m, s), mean λ = s·m.
 *
 * Pool players go roughly in ADP order. A player whose Fantrax ADP rank
 * among the still-available pool players is r gets an "effective rank" ρ
 * with log-normal noise:
 *
 *   ln(ρ + c) = ln(r + c) + τ·Z,   Z ~ Normal(0, 1),  τ = 0.6,  c = 15
 *
 * so drafts stray from ADP by a lot (the ADP is Fantrax-wide and mostly
 * redraft; these are dynasty drafts): τ and c are fitted on the two real
 * drafts (see `ADP_LOG_SIGMA`). ρ can never go below 0: a player 300 deep
 * has little chance of going in the next few picks. (Additive noise ε with
 * σ proportional to r gave every deep player the same floor, P(ε < −r),
 * which added up to phantom players gone in every pick window.) ADPs of
 * `ADP_SATURATED` and up are Fantrax's ceiling, not an order: unranked.
 *
 * The N pool players taken are the N smallest effective ranks. Rather than
 * the exact order statistics, each player is gone when ln(ρ + c) falls
 * below a common cut-off u_n:
 *
 *   P(gone | N = n) = Φ((u_n − ln(r + c)) / τ)
 *
 * with u_n solved (bisection) so these add up to exactly n over the whole
 * available pool, i.e. the expected number of players gone is n, no more.
 * u_n rises with n, so P(gone | n) rises with n and falls with r. Then
 *
 *   P(gone) = Σ_n Binom(n; m, s) · P(gone | N = n)
 *
 * sums to s·m over the pool, keeps the spread in how many pool players
 * actually go, and is exactly 0 when nobody picks in between (m = 0 or
 * s = 0); since Binomial(m + 1, s) dominates Binomial(m, s), it also only
 * rises with m. Players without a Fantrax ADP rank behind all the ranked
 * ones, so they share rank R + 1 (R = ranked players still available): never
 * more at risk than the deepest ranked player.
 * Availability = 1 − P(gone). Everything is closed-form: no sampling.
 *
 * Expected best. A position's candidates sorted by value v_1 ≥ v_2 ≥ …, with
 * availability a_i: the best one left is i with probability
 * a_i · Π_{j<i}(1 − a_j), availabilities taken as independent (an
 * approximation: one player going makes the next one a bit safer), so
 *
 *   E_best = Σ_i v_i · a_i · Π_{j<i}(1 − a_j)  +  v_K · Π_{j≤K}(1 − a_j)
 *
 * the last term flooring the leftover mass at the deepest candidate K
 * considered. E_best never exceeds the best value.
 *
 *   VONA(pos)    = E_best(pos, my next pick) − E_best(pos, my following pick)
 *   VONA(player) = value − E_best(g, my following pick), g = the group of his
 *                  whose expected replacement is weakest (where he would play)
 *
 * A player's VONA is what passing on him now costs if you take the best
 * expected at his position next time: about 0 when he will likely still be
 * there, negative when someone better there should last.
 *
 * Pick numbers, rounds and the team on the clock come straight from
 * `draftPicks` (fxea `getDraftResults`), so the draft's ORDER is whatever
 * Fantrax says it is: a fixed order in Captains, a pure snake in Slapshot
 * (round 1 = draftOrder, round 2 reversed, verified over all 1,216 picks).
 * Nothing here assumes either.
 *
 * Value = season points above replacement (`DraftPoolPlayer.vor`) where the
 * league models it, else season FP plus up to +50% when the roster has empty
 * D / G slots. Both are redraft numbers; age and Ros% ride along as dynasty
 * hints only.
 */

import { CAPTAINS_DYNASTY, FANTRAX_GROUPS, type FantraxGroup } from "./config";

/** A position group of the pool (see `FantraxGroup`). */
export type DraftGroup = FantraxGroup;
/**
 * The group vocabulary ACROSS leagues. A board is ranked in the groups of the
 * league it belongs to (`DraftOutlookOptions.groups`, i.e.
 * `config.eligibility.groups`): Slapshot's wings are LW and RW, Captains' is
 * one W. Iterate the league's list, not this one.
 */
export const DRAFT_GROUPS: readonly DraftGroup[] = FANTRAX_GROUPS;

export interface DraftPickInfo {
  pick: number;
  round: number;
  pickInRound?: number;
  teamId: string;
  playerId?: string;
}

export interface DraftPoolPlayer {
  id: string;
  groups: readonly DraftGroup[];
  seasonFp: number;
  /**
   * Season points above the replacement level of his position
   * (`points-vor.ts`), where the league's slots all score a skater alike.
   * Absent for a league the model does not cover (one with a captain slot).
   */
  vor?: number;
  /** Lower = drafted earlier across Fantrax; Infinity when unranked. */
  adp: number;
}

export interface DraftBoardRow {
  id: string;
  value: number;
  seasonFp: number;
  groups: readonly DraftGroup[];
  /**
   * Value − expected best at his group by my following pick (can be
   * negative); null on my last pick.
   */
  vona: number | null;
  /** The group his VONA is measured in. */
  vonaGroup: DraftGroup | null;
  /** Probability (0..1) he is still there at my next pick. */
  available: number;
  /** `available` < 0.5. */
  likelyGone: boolean;
}

export interface DraftGroupOutlook {
  /** Most likely best available at the position at my next pick. */
  bestId: string | null;
  /** Probability `bestId` is the best one left then. */
  bestP: number;
  /** Expected best value at my next pick. */
  now: number;
  /** Most likely best available at the position at my following pick. */
  laterId: string | null;
  laterP: number;
  /** Expected best value at my following pick (0 without one). */
  later: number;
  /** now − later; null on my last pick. */
  vona: number | null;
}

export interface DraftOutlook {
  state: "not-started" | "running" | "done";
  made: number;
  total: number;
  current: DraftPickInfo | null;
  next: DraftPickInfo | null;
  following: DraftPickInfo | null;
  /** Picks other teams make before `next`. */
  picksBefore: number;
  /** Picks other teams make before `following` (null without one). */
  picksBeforeFollowing: number | null;
  /** Share (0..1) of other teams' picks expected to land on pool players. */
  poolShare: number;
  remaining: DraftPickInfo[];
  /**
   * One entry per group of the LEAGUE (`DraftOutlookOptions.groups`), not per
   * `DRAFT_GROUPS`: read it with the same list the league's config gives, and
   * guard a missing key — a baked snapshot older than a vocabulary change has
   * the previous groups.
   */
  vona: Record<DraftGroup, DraftGroupOutlook>;
  board: DraftBoardRow[];
}

/** 0..1 share of a position's active slots that are empty or dead. */
export type NeedWeights = Partial<Record<DraftGroup, number>>;

export const NEED_BONUS = 0.5;

/**
 * What the board ranks by.
 *
 * With points over replacement in hand, that IS the value: it already says how
 * scarce the position is, so adding the empty-slot bonus on top would count the
 * same scarcity twice — and badly. In Slapshot's scoring a starting goalie is
 * worth ~330 raw season points against ~410 for the best centre (0.25 a save
 * over ~1,400 saves), and the bonus then multiplied every goalie by 1.5 on a
 * roster with two empty goalie slots: the top of the board came out as eight
 * goalies in a row. Against the real goalie replacement level (73.9 season
 * points, the 64th and last starting seat) the same goalie is worth 255 and the
 * centre 347, which is the true order.
 *
 * Without it (Captains, where a captain slot makes one value per player the
 * wrong model) the need bonus is unchanged, and so is every number it produced.
 */
export function draftValue(p: DraftPoolPlayer, need: NeedWeights): number {
  if (p.vor !== undefined) return p.vor;
  const w = Math.max(0, ...p.groups.map((g) => need[g] ?? 0));
  return p.seasonFp * (1 + NEED_BONUS * w);
}

// ------------------------------------------------------------ availability

/**
 * ADP noise τ: standard deviation of ln(effective rank + c). Fitted with c
 * and `ADP_SATURATED` by replaying `draftOutlook` after every pick of the two
 * real drafts (Captains 224 picks, Slapshot 1,216: scripts/test-fantrax-vona.ts
 * keeps the replay; `npx tsx scripts/draft-calibration.ts` re-runs the grid).
 * The first guess, τ 0.35 / c 5 with every ADP ranked, called players gone
 * who stayed: predicted 0-10 % still there, 65 % (Slapshot) and 62 %
 * (Captains) actually were. Brier / log loss, Captains then Slapshot:
 *   τ 0.35, c 5, all ranked:    0.0810 / 0.405   0.1815 / 1.004
 *   τ 1.0,  c 25, all ranked:   0.0593 / 0.211   0.0934 / 0.328
 *   τ 0.6,  c 15, ADP < 290:    0.0600 / 0.225   0.0737 / 0.288  (shipped)
 */
export const ADP_LOG_SIGMA = 0.6;
/** Rank offset c: the noise is wide in absolute picks even at the top of the board. */
export const ADP_RANK_OFFSET = 15;
/**
 * Fantrax ADPs from here up are saturated: 617 of 969 sit at 290-294 (players
 * almost never drafted in Fantrax leagues get about the same number), so their
 * order is noise. They are treated as unranked (tied just past the deepest
 * ranked player), like a player without ADP.
 */
export const ADP_SATURATED = 290;

/** The availability model's noise (see the header); the fitted constants by default. */
export interface AdpNoise {
  sigma: number;
  offset: number;
}
export const ADP_NOISE: AdpNoise = { sigma: ADP_LOG_SIGMA, offset: ADP_RANK_OFFSET };
/** Ranked pool size `availability` assumes when none is given. */
export const DEFAULT_RANKED_POOL = 400;

/** Standard normal CDF (Numerical Recipes erfc: relative error < 1.2e-7, tails included). */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * z);
  const erfc =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? 1 - erfc / 2 : erfc / 2;
}

/** Binomial(m, s) probabilities for n = 0..m (m rounded, clamped at 0). */
export function binomialPmf(m: number, s: number): number[] {
  const n = Math.max(0, Math.round(m));
  const out = new Array<number>(n + 1).fill(0);
  if (n === 0 || s <= 0) {
    out[0] = 1;
    return out;
  }
  if (s >= 1) {
    out[n] = 1;
    return out;
  }
  const ls = Math.log(s);
  const lq = Math.log(1 - s);
  let logC = 0;
  for (let k = 0; k <= n; k++) {
    if (k > 0) logC += Math.log(n - k + 1) - Math.log(k);
    out[k] = Math.exp(logC + k * ls + (n - k) * lq);
  }
  return out;
}

const logRank = (rank: number, noise: AdpNoise = ADP_NOISE) => Math.log(rank + noise.offset);

/**
 * The available pool as ADP ranks (unranked players already at R + 1), with
 * the cut-offs u_0..u_k found so far (see the header).
 */
export interface RankPool {
  /** Distinct ln(rank + c), with how many players share it. */
  levels: ReadonlyArray<readonly [number, number]>;
  size: number;
  cut: number[];
  noise: AdpNoise;
}

export function rankPool(ranks: readonly number[], noise: AdpNoise = ADP_NOISE): RankPool {
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  return {
    levels: [...counts].map(([r, k]) => [logRank(r, noise), k] as const),
    size: ranks.length,
    cut: [Number.NEGATIVE_INFINITY],
    noise,
  };
}

/**
 * Cut-offs u_0..u_maxN: Σ over the pool of Φ((u_n − ln(r + c)) / τ) = n,
 * so exactly n players are expected gone after n pool picks. u_0 = −∞
 * (nobody gone); u_n = +∞ once n reaches the pool size (everybody gone).
 * Extends `pool.cut` in place, so each cut-off is solved once.
 */
export function goneCutoffs(pool: RankPool, maxN: number): readonly number[] {
  const { levels, size, cut } = pool;
  const sigma = pool.noise.sigma;
  if (cut.length > maxN) return cut;
  const expectedGone = (u: number) => {
    let e = 0;
    for (const [l, k] of levels) e += k * normalCdf((u - l) / sigma);
    return e;
  };
  const ls = levels.map(([l]) => l);
  const bottom = Math.min(...ls) - 12 * sigma;
  const top = Math.max(...ls) + 12 * sigma;
  for (let n = cut.length; n <= maxN; n++) {
    if (n >= size) {
      cut.push(Number.POSITIVE_INFINITY);
      continue;
    }
    // expectedGone(lo) < n ≤ expectedGone(hi); u_n > u_{n−1}.
    const prev = cut[n - 1]!;
    let lo = Number.isFinite(prev) ? prev : bottom;
    let hi = top;
    for (let i = 0; i < 200 && hi - lo > 1e-12; i++) {
      const mid = (lo + hi) / 2;
      if (expectedGone(mid) < n) lo = mid;
      else hi = mid;
    }
    cut.push((lo + hi) / 2);
  }
  return cut;
}

/** Availability of a player at ADP rank `rank` (see the header). */
function availabilityFrom(rank: number, pmf: readonly number[], cut: readonly number[], noise: AdpNoise = ADP_NOISE): number {
  const m = pmf.length - 1;
  if (m <= 0 || pmf[0] === 1) return 1;
  const l = logRank(rank, noise);
  let gone = 0;
  for (let n = 1; n <= m; n++) {
    const w = pmf[n]!;
    if (w < 1e-15) continue;
    gone += w * normalCdf((cut[n]! - l) / noise.sigma);
  }
  return Math.min(1, Math.max(0, 1 - gone));
}

const defaultPools = new Map<string, RankPool>();

/**
 * Probability a pool player is still available after `m` picks by other
 * teams, `s` of which land on pool players, in a pool of `ranked` players
 * with ADP. `rank` = his ADP rank (1 = first) among them; null without ADP
 * (ranked just past the deepest, R + 1).
 */
export function availability(
  rank: number | null,
  m: number,
  s: number,
  ranked = DEFAULT_RANKED_POOL,
  noise: AdpNoise = ADP_NOISE,
): number {
  const share = Math.min(1, Math.max(0, s));
  const pmf = binomialPmf(m, share);
  const key = `${ranked}|${noise.sigma}|${noise.offset}`;
  let pool = defaultPools.get(key);
  if (!pool) {
    pool = rankPool(Array.from({ length: ranked }, (_, i) => i + 1), noise);
    defaultPools.set(key, pool);
  }
  return availabilityFrom(rank ?? ranked + 1, pmf, goneCutoffs(pool, pmf.length - 1), noise);
}

export interface BestCandidate {
  id: string;
  value: number;
  /** 0..1 probability he is still there. */
  available: number;
}

export interface ExpectedBest {
  /** Expected value of the best candidate left. */
  value: number;
  /** Candidate most likely to be the best one left. */
  topId: string | null;
  /** Probability `topId` is the best one left. */
  topP: number;
}

/** Stop once the chance everyone considered is gone drops below this. */
const SURVIVAL_EPS = 1e-9;

/**
 * Expected best value among candidates, each present with probability
 * `available` (independent); the leftover mass is floored at the deepest
 * candidate considered.
 */
export function expectedBest(cands: readonly BestCandidate[]): ExpectedBest {
  const sorted = [...cands].sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let value = 0;
  let allGone = 1;
  let last = 0;
  let topId: string | null = null;
  let topP = 0;
  for (const c of sorted) {
    const a = Math.min(1, Math.max(0, c.available));
    const p = allGone * a;
    value += c.value * p;
    if (p > topP) {
      topP = p;
      topId = c.id;
    }
    allGone *= 1 - a;
    last = c.value;
    if (allGone < SURVIVAL_EPS) break;
  }
  return { value: value + allGone * last, topId, topP };
}

// ------------------------------------------------------------ outlook

export interface DraftOutlookOptions {
  boardSize?: number;
  /** Share (0..1) of other teams' picks expected to come out of `pool`. */
  poolShare?: number;
  /**
   * Position groups to rank: the league's own `eligibility.groups`. Captains'
   * by default, so every existing caller keeps its four cards.
   */
  groups?: readonly DraftGroup[];
  /** The availability model's noise and ADP saturation (the fitted constants by default). */
  adp?: Partial<AdpNoise> & { saturated?: number };
}

export function draftOutlook(
  picks: DraftPickInfo[],
  myTeamId: string,
  pool: DraftPoolPlayer[],
  need: NeedWeights = {},
  opts: DraftOutlookOptions = {},
): DraftOutlook {
  const boardSize = opts.boardSize ?? 15;
  const share = Math.min(1, Math.max(0, opts.poolShare ?? 1));
  const ordered = [...picks].sort((a, b) => a.pick - b.pick);
  const made = ordered.filter((p) => p.playerId).length;
  const open = ordered.filter((p) => !p.playerId);
  const drafted = new Set(ordered.map((p) => p.playerId).filter((x): x is string => !!x));
  const available = pool.filter((p) => !drafted.has(p.id));
  const current = open[0] ?? null;
  const remaining = open.filter((p) => p.teamId === myTeamId);
  const next = remaining[0] ?? null;
  const following = remaining[1] ?? null;
  const state = made === 0 ? "not-started" : open.length === 0 ? "done" : "running";

  // Open picks by other teams ahead of each of mine.
  const othersBefore = (mine: DraftPickInfo) =>
    open.filter((p) => p.pick < mine.pick && p.teamId !== myTeamId).length;
  const picksBefore = next ? othersBefore(next) : 0;
  const picksBeforeFollowing = following ? othersBefore(following) : null;

  // ADP rank among the still-available pool players who have one; the
  // unranked share the rank just past the deepest ranked player.
  const noise: AdpNoise = { sigma: opts.adp?.sigma ?? ADP_NOISE.sigma, offset: opts.adp?.offset ?? ADP_NOISE.offset };
  const saturated = opts.adp?.saturated ?? ADP_SATURATED;
  const ranked = available
    .filter((p) => Number.isFinite(p.adp) && p.adp < saturated)
    .sort((a, b) => a.adp - b.adp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rankOf = new Map(ranked.map((p, i) => [p.id, i + 1] as const));
  const rank = (id: string) => rankOf.get(id) ?? ranked.length + 1;
  const availRanks = rankPool(available.map((p) => rank(p.id)), noise);
  const availabilityAt = (m: number) => {
    const pmf = binomialPmf(m, share);
    const cut = goneCutoffs(availRanks, pmf.length - 1);
    return new Map(available.map((p) => [p.id, availabilityFrom(rank(p.id), pmf, cut, noise)] as const));
  };
  const atNext = availabilityAt(picksBefore);
  const atFollowing = picksBeforeFollowing === null ? null : availabilityAt(picksBeforeFollowing);

  const valued = available.map((p) => ({ p, value: draftValue(p, need) }));
  const groups = opts.groups ?? CAPTAINS_DYNASTY.eligibility.groups;
  const vona = {} as DraftOutlook["vona"];
  for (const g of groups) {
    const inGroup = valued.filter((x) => x.p.groups.includes(g));
    const now = expectedBest(inGroup.map((x) => ({ id: x.p.id, value: x.value, available: atNext.get(x.p.id)! })));
    const later = atFollowing
      ? expectedBest(inGroup.map((x) => ({ id: x.p.id, value: x.value, available: atFollowing.get(x.p.id)! })))
      : null;
    vona[g] = {
      bestId: now.topId,
      bestP: now.topP,
      now: now.value,
      laterId: later?.topId ?? null,
      laterP: later?.topP ?? 0,
      later: later?.value ?? 0,
      vona: later ? now.value - later.value : null,
    };
  }

  const board = valued
    .map(({ p, value }): DraftBoardRow => {
      let vonaGroup: DraftGroup | null = null;
      if (atFollowing) {
        for (const g of p.groups) if (vonaGroup === null || vona[g].later < vona[vonaGroup].later) vonaGroup = g;
      }
      const available = atNext.get(p.id)!;
      return {
        id: p.id,
        value,
        seasonFp: p.seasonFp,
        groups: p.groups,
        vona: vonaGroup ? value - vona[vonaGroup].later : null,
        vonaGroup,
        available,
        likelyGone: available < 0.5,
      };
    })
    .sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, boardSize);

  return {
    state,
    made,
    total: ordered.length,
    current,
    next,
    following,
    picksBefore,
    picksBeforeFollowing,
    poolShare: share,
    remaining,
    vona,
    board,
  };
}
