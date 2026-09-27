/**
 * Games-played rule for skaters whose last season is not an availability
 * reading: a split season (NHL games plus games in another league) or an
 * away season (the last completed season spent entirely in another league
 * after NHL games the season before or two before).
 *
 * The NHL-only pipeline reads Cole Hutson's 2025-26 (14 NHL games after 35
 * at Boston University) like 68 games lost to injury: the v2 GP heads start
 * from his 14 games (model 45) and the post-hoc isotonic curve, fitted on
 * realized prior-season GP where call-ups sit low by construction, takes
 * him to 32. For those players the published GP comes instead from a linear
 * model of the next season's NHL games (scaled to 82) fitted on every
 * 2008-09 → 2024-25 split / away skater season (src/data/ml/durability.json
 * game logs + src/data/league-seasons.json), with the features below:
 * `npm run gp:split-fit` refits it (scripts/fit-split-season-gp.ts) and
 * writes src/data/ml/split-season-gp.json with its walk-forward backtest.
 *
 * Inputs come from the same two files at fit and at inference, so the rule
 * sees a 2025-26 season exactly as it saw the historical ones.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { isSplitSeason } from "./split-season";
import {
  isClubLeague,
  type LeagueSeasonsPlayer,
} from "./league-seasons";
import type { DurabilityRecord } from "./ml/gamelog-durability";
import type { MoneyPuckSkaterSeason } from "./moneypuck-skaters";

export const SPLIT_SEASON_GP_PATH = join(
  process.cwd(),
  "src",
  "data",
  "ml",
  "split-season-gp.json",
);

/** Games a regular season schedules per team (lockout / pandemic seasons). */
export function scheduledGames(seasonId: number): number {
  if (seasonId === 20122013) return 48;
  if (seasonId === 20192020) return 70;
  if (seasonId === 20202021) return 56;
  return 82;
}

export type SplitKind = "split" | "away";
export type OtherLeagueType = "ahl" | "college" | "chl" | "europe";

export interface SplitSeasonInput {
  kind: SplitKind;
  /** Season the reading comes from (split: that season; away: the away season). */
  seasonId: number;
  isDefense: boolean;
  /** Age on October 1 of the projected season. */
  age: number;
  draftPick: number | null;
  /** NHL games of the last NHL season, scaled to 82. */
  nhlGp82: number;
  /** NHL TOI per game (minutes) of the last NHL season. */
  toiMinutes: number;
  /** Club games outside the NHL in `seasonId`. */
  otherGames: number;
  league: OtherLeagueType;
  /**
   * Split: still with the NHL club at the end of the season (at most
   * FINISHED_MAX_TAIL team games after his last appearance, from the game
   * logs); null when unknown.
   */
  finished: boolean | null;
  /** NHL games before the last NHL season. */
  careerGpBefore: number;
  /** Away: seasons since the last NHL season (1 or 2). */
  seasonsAway: number;
  /** MoneyPuck game score of the last NHL season (its games: `mpGames`); 0 when unknown. */
  gameScore: number;
  mpGames: number;
}

/**
 * Team games after his last NHL appearance that still count as finishing the
 * season with the club (a late scratch or knock; a send-down leaves far more).
 * The backtest is flat between 0 and 5 (RMSE 22.3 either way): 5 keeps a
 * player scratched for the last week from reading as sent down.
 */
export const FINISHED_MAX_TAIL = 5;

/** Games of prior that shrink a short NHL sample's production toward the pool. */
export const PRODUCTION_PRIOR_GAMES = 15;

/** Fitted constants the features need besides the input. */
export interface FeatureContext {
  /** Sample mean of `finished` (stands in when a season has no game logs). */
  finishedMean: number;
  /** Pool game score per game (the production prior). */
  gameScorePrior: number;
}

/** Named features of the linear rule (the params file lists the ones it uses). */
export const SPLIT_FEATURES = {
  nhlShare: (x: SplitSeasonInput) => x.nhlGp82 / 82,
  toi: (x: SplitSeasonInput) => x.toiMinutes,
  isD: (x: SplitSeasonInput) => (x.isDefense ? 1 : 0),
  toiD: (x: SplitSeasonInput) => (x.isDefense ? x.toiMinutes : 0),
  finished: (x: SplitSeasonInput, c: FeatureContext) => finishedValue(x, c),
  finishedToi: (x: SplitSeasonInput, c: FeatureContext) => finishedValue(x, c) * x.toiMinutes,
  finishedShare: (x: SplitSeasonInput, c: FeatureContext) => finishedValue(x, c) * (x.nhlGp82 / 82),
  age: (x: SplitSeasonInput) => Math.min(x.age, 34),
  ageOver24: (x: SplitSeasonInput) => Math.max(0, Math.min(x.age, 34) - 24),
  draftLog: (x: SplitSeasonInput) => Math.log(x.draftPick ?? 300),
  undrafted: (x: SplitSeasonInput) => (x.draftPick == null ? 1 : 0),
  college: (x: SplitSeasonInput) => (x.league === "college" ? 1 : 0),
  chl: (x: SplitSeasonInput) => (x.league === "chl" ? 1 : 0),
  europe: (x: SplitSeasonInput) => (x.league === "europe" ? 1 : 0),
  career: (x: SplitSeasonInput) => Math.min(x.careerGpBefore, 300) / 100,
  debut: (x: SplitSeasonInput) => (x.careerGpBefore === 0 ? 1 : 0),
  twoAway: (x: SplitSeasonInput) => (x.seasonsAway >= 2 ? 1 : 0),
  /** Game score per game, shrunk toward the pool over PRODUCTION_PRIOR_GAMES. */
  gameScorePg: (x: SplitSeasonInput, c: FeatureContext) =>
    (x.gameScore + c.gameScorePrior * PRODUCTION_PRIOR_GAMES) / (x.mpGames + PRODUCTION_PRIOR_GAMES),
  // A first NHL stint after a college, junior or European season: a drafted
  // 20-year-old who finishes the season with the club (Quinn Hughes, Brock
  // Faber, Lane Hutson) and an overage college free agent (most back in the
  // AHL the next season) are two different players; these terms let age,
  // draft, TOI and finishing the season tell them apart.
  prospectFinished: (x: SplitSeasonInput, c: FeatureContext) => prospectDebut(x) * finishedValue(x, c),
  prospectAge: (x: SplitSeasonInput) => prospectDebut(x) * Math.min(x.age, 34),
  prospectDraftLog: (x: SplitSeasonInput) => prospectDebut(x) * Math.log(x.draftPick ?? 300),
  prospectToi: (x: SplitSeasonInput) => prospectDebut(x) * x.toiMinutes,
  /**
   * A first NHL stint after college / junior / Europe that did not end with
   * the club: a teenager's trial before he went back to junior or Europe
   * (Brady Martin, 2025-26) rarely sticks the next season; without these
   * the youth and pedigree terms, fitted mostly on the players who stayed,
   * took him to ~48 games.
   */
  prospectSentBack: (x: SplitSeasonInput, c: FeatureContext) =>
    prospectDebut(x) * (1 - finishedValue(x, c)),
  prospectSentBackYouth: (x: SplitSeasonInput, c: FeatureContext) =>
    prospectDebut(x) * (1 - finishedValue(x, c)) * Math.max(0, 23 - x.age),
  /** Years under 23, with finishing the season and with the draft slot. */
  finishedYouth: (x: SplitSeasonInput, c: FeatureContext) =>
    finishedValue(x, c) * Math.max(0, 23 - x.age),
  youthDraftLog: (x: SplitSeasonInput) => Math.max(0, 23 - x.age) * Math.log(x.draftPick ?? 300),
} as const satisfies Record<string, (x: SplitSeasonInput, c: FeatureContext) => number>;

function finishedValue(x: SplitSeasonInput, c: FeatureContext): number {
  return x.finished == null ? c.finishedMean : x.finished ? 1 : 0;
}

/** 1 for a first NHL stint after a season outside the AHL / ECHL. */
function prospectDebut(x: SplitSeasonInput): number {
  return x.careerGpBefore === 0 && x.league !== "ahl" ? 1 : 0;
}
export type SplitFeatureName = keyof typeof SPLIT_FEATURES;

export interface LinearGpModel extends FeatureContext {
  features: SplitFeatureName[];
  intercept: number;
  coef: number[];
  floor: number;
  ceiling: number;
  /**
   * Spread of the realized games around a prediction, as a probit scale:
   * P(next season ≥ ROLE_GP games) = Φ((prediction − ROLE_GP) / roleSd),
   * fitted by maximum likelihood on the walk-forward predictions (split:
   * ≈ 22 GP; empirical shares 0.13 / 0.43 / 0.62 / 0.81 at predictions of
   * 15 / 35 / 45 / 55). The Captains dynasty route reads it
   * (src/lib/dynasty/segment.ts): a hard cut at 40 games on a point
   * estimate this noisy decided values on rounding.
   */
  roleSd?: number;
}

/** Half a season: the NHL-role cut the dynasty route uses (src/lib/dynasty/segment.ts). */
export const ROLE_GP = 40;

export interface SplitSeasonGpParams {
  version: 1;
  fittedAt: string;
  source: string;
  minOtherGames: number;
  split: LinearGpModel;
  away: LinearGpModel;
  /** Walk-forward backtest of the fit (reported, not used at inference). */
  backtest?: unknown;
}

export function featureVector(model: LinearGpModel, x: SplitSeasonInput): number[] {
  return model.features.map((name) => SPLIT_FEATURES[name](x, model));
}

export function predictLinearGp(model: LinearGpModel, x: SplitSeasonInput): number {
  const v = featureVector(model, x);
  const raw = model.intercept + v.reduce((s, f, i) => s + f * (model.coef[i] ?? 0), 0);
  return Math.max(model.floor, Math.min(model.ceiling, raw));
}

/** Expected NHL games (82-game season) under the rule, unrounded. */
export function predictSplitSeasonGp(params: SplitSeasonGpParams, x: SplitSeasonInput): number {
  return predictLinearGp(x.kind === "split" ? params.split : params.away, x);
}

export function leagueType(leagues: string[]): OtherLeagueType {
  const l = leagues.join("/");
  if (/\bAHL\b|ECHL/.test(l)) return "ahl";
  if (/NCAA|H-East|Big Ten|NCHC|ECAC|WCHA|CCHA|Hockey East|USHL/.test(l)) return "college";
  if (/\b(OHL|WHL|QMJHL)\b/.test(l)) return "chl";
  return "europe";
}

/** Age in years on October 1 of the season starting in `seasonId`'s first year. */
export function ageOnSeasonStart(birth: string, seasonId: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birth);
  if (!m) return null;
  const startYear = Math.floor(seasonId / 10000);
  const b = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return (Date.UTC(startYear, 9, 1) - b) / (365.25 * 86_400_000);
}

export interface SplitSeasonSources {
  /** Game-log durability record of (player, season), if any. */
  durability: (playerId: number, seasonId: number) => DurabilityRecord | undefined;
  /** League-seasons cache entry of a player. */
  leagues: (playerId: number) => LeagueSeasonsPlayer | null | undefined;
  /** MoneyPuck season of (player, season), if any. */
  moneypuck: (playerId: number, seasonId: number) => ProductionSeason | null | undefined;
}

/** The MoneyPuck fields the rule reads. */
export type ProductionSeason = Pick<
  MoneyPuckSkaterSeason,
  "gamesPlayed" | "gameScore"
>;

function clubGames(p: LeagueSeasonsPlayer, seasonId: number): { games: number; leagues: string[] } {
  let games = 0;
  const leagues: string[] = [];
  for (const [s, league, gp] of p.seasons) {
    if (s !== seasonId || !isClubLeague(league)) continue;
    games += gp;
    if (!leagues.includes(league)) leagues.push(league);
  }
  return { games, leagues };
}

function nhlLine(p: LeagueSeasonsPlayer, seasonId: number): { games: number; toi: number } {
  const line = p.seasons.find((l) => l[0] === seasonId && l[1] === "NHL");
  return { games: line?.[2] ?? 0, toi: line?.[3] ?? 0 };
}

/**
 * The rule's input for a skater projected into `projectionSeasonId`, when
 * the season before it was a split or an away season; null otherwise (the
 * last season is an NHL-only season, an injury season, or unknown).
 * Split: NHL games that season (game logs, else the landing) and at least
 * SPLIT_SEASON_MIN_OTHER_GAMES club games elsewhere. Away: no NHL game that
 * season, that many club games elsewhere, NHL games one or two seasons
 * before.
 */
export function splitSeasonInput(
  playerId: number,
  projectionSeasonId: number,
  sources: SplitSeasonSources,
): SplitSeasonInput | null {
  const p = sources.leagues(playerId);
  if (!p || p.pos === "G") return null;
  const last = projectionSeasonId - 10001;
  const age = ageOnSeasonStart(p.birth, projectionSeasonId);
  if (age == null) return null;
  const other = clubGames(p, last);
  if (!isSplitSeason(other.games)) return null;

  const nhlGames = (seasonId: number) =>
    sources.durability(playerId, seasonId)?.played ?? nhlLine(p, seasonId).games;
  let nhlSeason = last;
  let seasonsAway = 0;
  if (nhlGames(last) <= 0) {
    const prior = [last - 10001, last - 20002].find((s) => nhlGames(s) > 0);
    if (prior == null) return null;
    nhlSeason = prior;
    seasonsAway = (last - prior) / 10001;
  }
  const games = nhlGames(nhlSeason);
  const careerGpBefore = p.seasons
    .filter((l) => l[1] === "NHL" && l[0] < nhlSeason)
    .reduce((s, l) => s + l[2], 0);
  const dur = sources.durability(playerId, nhlSeason);
  const mp = sources.moneypuck(playerId, nhlSeason);
  return {
    kind: seasonsAway > 0 ? "away" : "split",
    seasonId: last,
    isDefense: p.pos === "D",
    age,
    draftPick: p.draft,
    nhlGp82: Math.min(82, (games * 82) / scheduledGames(nhlSeason)),
    toiMinutes: nhlLine(p, nhlSeason).toi / 60,
    otherGames: other.games,
    league: leagueType(other.leagues),
    finished: seasonsAway === 0 && dur ? dur.tail <= FINISHED_MAX_TAIL : null,
    careerGpBefore,
    seasonsAway,
    gameScore: mp?.gameScore ?? 0,
    mpGames: mp?.gamesPlayed ?? 0,
  };
}

let paramsCache: SplitSeasonGpParams | null | undefined;

export function loadSplitSeasonGpParams(
  path = SPLIT_SEASON_GP_PATH,
): SplitSeasonGpParams | null {
  if (path === SPLIT_SEASON_GP_PATH && paramsCache !== undefined) return paramsCache;
  const loaded = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as SplitSeasonGpParams)
    : null;
  if (path === SPLIT_SEASON_GP_PATH) paramsCache = loaded;
  return loaded;
}
