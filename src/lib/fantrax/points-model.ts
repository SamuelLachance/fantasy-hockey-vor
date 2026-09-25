/**
 * Per-game fantasy points from the committed Yahoo-pipeline projections
 * (`players.json` season totals ÷ games played), so the daily tool needs no
 * ML re-run. About 97% of skater points and 99% of goalie points come from
 * projected stats; the rest (A1/A2 split, OT points, hat tricks, takeaways,
 * skater shutouts, OTL, OT/SO wins, goalie assists) is estimated from
 * league-wide rates measured on 2023-26 NHL / MoneyPuck data.
 *
 * Pure: callers pass projections and profile history in; nothing is read here.
 */
import {
  DAY_TO_DAY_P_PLAY,
  FANTRAX_ICON,
  FANTRAX_NO_TEAM,
  NON_PLAYING_ICONS,
  PRIOR_FPG,
  PRIOR_GOALIE_E,
  PRIOR_P_PLAY,
} from "./config";
import {
  goaliePoints,
  skaterComponents,
  type GoalieRates,
  type ScoringTable,
  type SkaterRates,
} from "./scoring";

/** Primary-assist share of assists (MoneyPuck, 3 seasons): forwards vs D. */
export const A1_SHARE = { F: 0.595, D: 0.467 } as const;
/** OT points ≈ 2.46% of a skater's points (OT goals × assists-per-goal). */
export const OT_POINTS_PER_POINT = 0.0246;
/** Team shutouts per team-game (0.055 / 0.059 / 0.043 for 2023-26). */
export const SKATER_SHO_RATE = 0.05;
/** D takeaways: league mean per GP (2025-26) and its shrinkage weight. */
export const TK_PRIOR_RATE = 0.279;
export const TK_PRIOR_GP = 40;
/** Most recent season first. */
export const TK_SEASON_WEIGHTS = [0.65, 0.35] as const;
/** Goalie OT/SO losses per GP league mean, and goalie assists per GP. */
export const GOALIE_OTL_PRIOR = 0.105;
export const GOALIE_A_PRIOR = 0.02;
export const GOALIE_PRIOR_GP = 40;
/** Share of wins that come in OT/SO (−1 OSW each): 20.7–24.8% for 2023-26. */
export const OSW_SHARE_OF_WINS = 0.221;
/**
 * Nightly regulars: projected for 60+ games, or for 45+ games while scoring
 * at least the p25 of 2025-26 regulars per game. A lowish GP projection on a
 * productive player is injury risk (the injury icon covers the nights he
 * sits), not a scratch — without this, Jack Hughes' 58-GP projection would
 * be discounted by 30%. The GP floor keeps 3-GP placeholder projections of
 * prospects and part-time depth players (Luke Schenn, 44 GP) on the
 * projGP/82 discount.
 */
export const REGULAR_GP = 60;
export const REGULAR_MIN_FPG = 2.5;
export const REGULAR_FPG_MIN_GP = 45;
/** Nobody starts every night; cap a lone healthy goalie's share. */
export const MAX_START_SHARE = 0.85;
/** Second night of a back-to-back: the starter keeps this fraction of his share. */
export const BACK_TO_BACK_STARTER_FACTOR = 0.35;
/** Unprojected NHL goalies (prospects on an NHL club) count as a deep backup. */
export const PRIOR_GOALIE_GP = 10;

/** Poisson P(3+ goals) for a per-game goal rate. */
export function hatTrickProbability(lambda: number): number {
  if (!(lambda > 0)) return 0;
  return 1 - Math.exp(-lambda) * (1 + lambda + (lambda * lambda) / 2);
}

export interface SkaterProjectionInput {
  gamesPlayed: number;
  goals: number;
  assists: number;
  shots: number;
  hits: number;
  blocks: number;
}

export interface GoalieProjectionInput {
  gamesPlayed: number;
  wins: number;
  shutouts: number;
  saves: number;
  savePct: number;
}

export interface TakeawaySeason {
  seasonId: number;
  gamesPlayed: number;
  takeaways: number | null | undefined;
}

/**
 * Takeaways per GP from the last two seasons (weighted 0.65 / 0.35), shrunk
 * toward the D mean with 40 GP of prior. Rows for the same season (trades)
 * are summed first.
 */
export function takeawaysPerGame(history: TakeawaySeason[]): number {
  const bySeason = new Map<number, { gp: number; tk: number }>();
  for (const h of history) {
    if (h.takeaways == null || !(h.gamesPlayed > 0)) continue;
    const s = bySeason.get(h.seasonId) ?? { gp: 0, tk: 0 };
    s.gp += h.gamesPlayed;
    s.tk += h.takeaways;
    bySeason.set(h.seasonId, s);
  }
  const recent = [...bySeason.entries()].sort((a, b) => b[0] - a[0]).slice(0, 2);
  let tk = 0;
  let gp = 0;
  recent.forEach(([, s], i) => {
    const w = TK_SEASON_WEIGHTS[i] ?? 0;
    tk += w * s.tk;
    gp += w * s.gp;
  });
  return (tk + TK_PRIOR_GP * TK_PRIOR_RATE) / (gp + TK_PRIOR_GP);
}

/**
 * Per-game stat line for a skater. Blk / Tk / SHO only matter in a D slot,
 * so they stay 0 for players who can't fill one (keeps `dx` = 0 for forwards).
 */
export function skaterRatesFromProjection(
  p: SkaterProjectionInput,
  opts: { primaryD: boolean; dEligible: boolean; takeawaysPerGame?: number },
): SkaterRates {
  const gp = p.gamesPlayed;
  if (!(gp > 0)) {
    return { g: 0, a1: 0, a2: 0, sog: 0, hit: 0, otp: 0, ht: 0, blk: 0, tk: 0, sho: 0 };
  }
  const g = p.goals / gp;
  const a = p.assists / gp;
  const share = opts.primaryD ? A1_SHARE.D : A1_SHARE.F;
  return {
    g,
    a1: share * a,
    a2: (1 - share) * a,
    sog: p.shots / gp,
    hit: p.hits / gp,
    otp: OT_POINTS_PER_POINT * (g + a),
    ht: hatTrickProbability(g),
    blk: opts.dEligible ? p.blocks / gp : 0,
    tk: opts.dEligible ? (opts.takeawaysPerGame ?? TK_PRIOR_RATE) : 0,
    sho: opts.dEligible ? SKATER_SHO_RATE : 0,
  };
}

export interface GoalieCareer {
  gamesPlayed: number;
  otLosses?: number;
  assists?: number;
}

/**
 * Per-start goalie line. GA is exact from saves and SV%; OTL and assists
 * use the goalie's career rate shrunk toward the league mean; OT/SO wins
 * are a fixed share of wins (W already counts them, so an OT win nets 2).
 */
export function goalieRatesFromProjection(
  p: GoalieProjectionInput,
  career?: GoalieCareer | null,
): GoalieRates {
  const gp = p.gamesPlayed;
  if (!(gp > 0)) return { w: 0, ga: 0, sv: 0, so: 0, otl: 0, osw: 0, a: 0, g: 0 };
  const w = p.wins / gp;
  const sv = p.saves / gp;
  const ga = p.savePct > 0 ? (sv * (1 - p.savePct)) / p.savePct : 0;
  const cgp = career?.gamesPlayed ?? 0;
  return {
    w,
    ga,
    sv,
    so: p.shutouts / gp,
    otl: ((career?.otLosses ?? 0) + GOALIE_PRIOR_GP * GOALIE_OTL_PRIOR) / (cgp + GOALIE_PRIOR_GP),
    osw: OSW_SHARE_OF_WINS * w,
    a: ((career?.assists ?? 0) + GOALIE_PRIOR_GP * GOALIE_A_PRIOR) / (cgp + GOALIE_PRIOR_GP),
    g: 0,
  };
}

export function skaterValueFromProjection(
  table: ScoringTable,
  p: SkaterProjectionInput,
  opts: { primaryD: boolean; dEligible: boolean; takeawaysPerGame?: number },
): { off: number; dx: number } {
  return skaterComponents(table, skaterRatesFromProjection(p, opts));
}

/** Expected fantasy points per start. */
export function goalieValueFromProjection(
  table: ScoringTable,
  p: GoalieProjectionInput,
  career?: GoalieCareer | null,
): number {
  return goaliePoints(table, goalieRatesFromProjection(p, career));
}

/** Prior per-game value for a skater with no projection. */
export function priorSkaterValue(primaryD: boolean): { off: number; dx: number } {
  // The p25 FP/G already includes D extras; keep them in `dx` so a prior D
  // loses them in the Skt slot like everyone else.
  return primaryD
    ? { off: PRIOR_FPG.D * 0.8, dx: PRIOR_FPG.D * 0.2 }
    : { off: PRIOR_FPG.F, dx: 0 };
}

export const priorGoalieValue = (): number => PRIOR_GOALIE_E;

export interface PlayInput {
  /** Projected games (skaters) — drives the fringe-player discount. */
  gp: number;
  /** Best per-game value; productive players count as regulars. */
  fpg?: number;
  src: "proj" | "prior";
  /** Fantrax NHL team; "(N/A)" or empty = no club. */
  team: string;
  icons?: readonly string[];
}

/** True when an icon or the lack of an NHL club rules a player out. */
export function isRuledOut(p: Pick<PlayInput, "team" | "icons">): boolean {
  if (!p.team || p.team === FANTRAX_NO_TEAM) return true;
  return (p.icons ?? []).some((i) => NON_PLAYING_ICONS.includes(i));
}

/** Multiplier on a healthy player's odds of dressing: 0.5 while day-to-day. */
export function dayToDayFactor(icons: readonly string[] | undefined): number {
  return (icons ?? []).includes(FANTRAX_ICON.dayToDay) ? DAY_TO_DAY_P_PLAY : 1;
}

/**
 * P(skater dresses) on a day his team plays: 0 if injured / suspended /
 * in the minors / inactive / clubless; 1 for regulars; projGP/82 (floored
 * at 0.3) for fringe players; a flat discount for unprojected players.
 * Day-to-day halves whichever applies.
 */
export function skaterPlayProbability(p: PlayInput, hasGame: boolean): number {
  if (!hasGame || isRuledOut(p)) return 0;
  const dtd = dayToDayFactor(p.icons);
  if (p.src === "prior") return PRIOR_P_PLAY * dtd;
  const regular =
    p.gp >= REGULAR_GP || (p.gp >= REGULAR_FPG_MIN_GP && (p.fpg ?? 0) >= REGULAR_MIN_FPG);
  if (regular) return dtd;
  return Math.min(1, Math.max(0.3, p.gp / 82)) * dtd;
}

export interface GoalieShareInput {
  id: string;
  team: string;
  gp: number;
  healthy: boolean;
}

/**
 * Prior start share per goalie: projected GP renormalized within his
 * current (Fantrax) NHL team over the healthy goalies, so an injured
 * starter's games flow to his partner. Capped at 85%.
 */
export function goalieStartShares(goalies: GoalieShareInput[]): Map<string, number> {
  const byTeam = new Map<string, GoalieShareInput[]>();
  for (const g of goalies) {
    if (!g.team || g.team === FANTRAX_NO_TEAM) continue;
    const list = byTeam.get(g.team) ?? [];
    list.push(g);
    byTeam.set(g.team, list);
  }
  const out = new Map<string, number>();
  for (const g of goalies) out.set(g.id, 0);
  for (const list of byTeam.values()) {
    const healthy = list.filter((g) => g.healthy && g.gp > 0);
    const total = healthy.reduce((s, g) => s + g.gp, 0);
    if (total <= 0) continue;
    for (const g of healthy) out.set(g.id, Math.min(MAX_START_SHARE, g.gp / total));
  }
  return out;
}

/**
 * Second night of a back-to-back: the team's top-share goalie keeps 35% of
 * his share and the rest moves to the next goalie. Input and output are
 * the shares of one team's goalies for that day.
 */
export function backToBackShares(shares: Map<string, number>): Map<string, number> {
  const ranked = [...shares.entries()].filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]);
  const out = new Map(shares);
  if (ranked.length === 0) return out;
  const [starterId, starterP] = ranked[0]!;
  const moved = starterP * (1 - BACK_TO_BACK_STARTER_FACTOR);
  out.set(starterId, starterP - moved);
  if (ranked[1]) {
    const [backupId, backupP] = ranked[1];
    out.set(backupId, Math.min(MAX_START_SHARE, backupP + moved));
  }
  return out;
}
