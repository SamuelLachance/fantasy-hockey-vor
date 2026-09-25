/**
 * Public Snake data (written by `npm run snake:build`, served from
 * `public/snake/`). Field names are short on purpose: the index carries one
 * slim row per player and the shards every published opinion.
 *
 * Everything here is a French paraphrase of what Simon « Snake » Boisvert
 * said on public podcasts, generated automatically from YouTube's automatic
 * captions. Nothing is a verbatim quote; opinions whose attribution to him is
 * uncertain are never written.
 */

/** Stance / verdict scale, most positive first. */
export const SNAKE_STANCES = [
  "très positif",
  "positif",
  "neutre",
  "mitigé",
  "négatif",
  "très négatif",
] as const;
export type SnakeStance = (typeof SNAKE_STANCES)[number];

export const SNAKE_TRENDS = [
  "en hausse",
  "stable",
  "variable",
  "en baisse",
  "inconnue",
] as const;
export type SnakeTrend = (typeof SNAKE_TRENDS)[number];

/** Attribution levels that may be published ("incertain" never is). */
export type SnakePublishedAttribution = "certain" | "probable";

/**
 * One player of the /snake list (`public/snake/index.json`): only what the
 * cards, search, filters and sorts read.
 */
export interface SnakeListRow {
  /** Stable key from the source DB: `fx:<fantraxId>`, `nhl:<id>` or `name:<normalized>`. */
  k: string;
  /** Display name. */
  n: string;
  /** Position code (C, LW, RW, D, G, F) when known. */
  pos: string | null;
  /** NHL team abbreviation when known. */
  tm: string | null;
  fx: string | null;
  /** Verdict (synthesis, or the stand-in opinion when `dv`). */
  v: SnakeStance;
  /** Trend of his opinion over time. */
  td: SnakeTrend;
  /** Summary paragraph (French paraphrase; capped in the index). */
  s: string;
  /** Published opinion count. */
  oc: number;
  /** Last published mention (YYYY-MM-DD). */
  ls: string;
  /** 1 when every published opinion is "probable" (the summary is too). */
  pr?: 1;
  /** 1 when the source synthesis was withheld (see `SnakeRow.dv`). */
  dv?: 1;
  /**
   * Mentions for the show / period filters, flattened:
   * [showIndex, epochDay, showIndex, epochDay, …] (index.json only).
   */
  m?: number[];
}

/** One player's full row (opinion shards). */
export interface SnakeRow extends SnakeListRow {
  /** NHL id (direct, via the Fantrax id map, or a unique name match). */
  nhl: number | null;
  /** Draft line, e.g. "2022, 62e choix (MTL)". */
  dr: string | null;
  /** 1 when the player is on the VOR rankings board (players.json). */
  b?: 1;
  /** Projection (synthesis). */
  pj: string | null;
  /** Strengths / weaknesses / comparables (synthesis). */
  f: string[];
  w: string[];
  c: string[];
  /** Contradictions / nuances noted across episodes. */
  x: string | null;
  /** Stance of the latest published opinion. */
  l: SnakeStance;
  /** Distinct videos. */
  vc: number;
  /** Published opinions whose attribution is only "probable". */
  pc: number;
  /** First published mention (YYYY-MM-DD). */
  fs: string;
  /**
   * 1 when the source synthesis was withheld (it was written from source
   * opinions that are not all published) and this row stands on one
   * published opinion instead: the latest one with a certain attribution,
   * else the latest one (then every opinion is probable and `pr` is set).
   */
  dv?: 1;
  /** Date of the stand-in opinion when `dv` (YYYY-MM-DD). */
  sd?: string;
  /**
   * 1 when the synthesis was kept but trimmed: a few of its source opinions
   * are not published, and what only they supported was removed.
   */
  tr?: 1;
}

/** `public/snake/index.json`. */
export interface SnakeIndexFile {
  v: 1;
  /** When the source DB was built (ISO). */
  builtAt: string;
  scout: string;
  /** Show names; `SnakeListRow.m` refers to them by index. */
  shows: string[];
  shardCount: number;
  stats: SnakeStats;
  /** Keys folded into another record of the same player (old key → key). */
  aliases: Record<string, string>;
  rows: SnakeListRow[];
}

export interface SnakeStats {
  /** Videos analysed / with Snake present. */
  videos: number;
  videosWithSnake: number;
  /** Published players / opinions (of which "probable"). */
  players: number;
  opinions: number;
  probableOpinions: number;
  /** Distinct videos cited by published opinions. */
  citedVideos: number;
  rankings: number;
  /** What the public-safety filters removed. */
  filtered: {
    playersWithoutPublishableOpinion: number;
    opinionsUncertainAttribution: number;
    /** Weak name match, inferred name, namesake or a hand-checked mix-up. */
    opinionsLowNameConfidence: number;
    opinionsInvalid: number;
    synthesesWithheld: number;
    /** Syntheses kept but trimmed to what the published opinions support. */
    synthesesTrimmed: number;
    sentencesScrubbed: number;
    /** Rankings whose own label flags deduced, relayed or unclear ranks. */
    rankingsWithheld: number;
  };
  /** Date range of published opinions (YYYY-MM-DD). */
  firstDate: string;
  lastDate: string;
  /** Per show: videos cited and published opinions. */
  byShow: Array<{ show: string; videos: number; opinions: number }>;
}

/** One published opinion (shards). */
export interface SnakeOpinion {
  /** YouTube video id. */
  vid: string;
  /** Video date (YYYY-MM-DD). */
  d: string;
  /** Start of the passage, seconds (deep link). */
  t: number;
  /** Other passages in the same video, seconds (excluding `t`). */
  ts?: number[];
  /** Context at the time (team, age, draft…). */
  cx: string | null;
  /** Paraphrase (French). */
  o: string;
  st: SnakeStance;
  pj: string | null;
  f: string[];
  w: string[];
  c: string[];
  /** Rank mentions: [rank, list label]. */
  rk: Array<[number, string]>;
  /** 1 when the attribution to Snake is only "probable". */
  p?: 1;
}

/** Video metadata in a shard: [date, show (guest spots: host program + « invité »), title]. */
export type SnakeVideoRef = [string, string, string];

/** `public/snake/o/<nn>.json`. */
export interface SnakeShardFile {
  v: 1;
  videos: Record<string, SnakeVideoRef>;
  players: Record<string, { r: SnakeRow; o: SnakeOpinion[] }>;
  /** Old keys hashed to this shard that now live under another key. */
  aliases?: Record<string, string>;
}

/** One ranking in `public/snake/rankings.json`. */
export interface SnakeRanking {
  vid: string;
  d: string;
  sh: string;
  /** Ranking label (generated, French). */
  ti: string;
  /** Video title. */
  vt: string;
  /** Start in seconds when the passage is known, else 0 (whole video). */
  t: number;
  /** Entries: [rank, name as extracted, player key when it matches a published player]. */
  e: Array<[number, string, string | null]>;
  /** 1 when the label says it is not an ordered ranking (order of mention). */
  u?: 1;
}

export interface SnakeRankingsFile {
  v: 1;
  builtAt: string;
  rankings: SnakeRanking[];
}

/** Compact lookup entry: [key, verdict, trend, probable (0|1)]. */
export type SnakeNhlEntry = [string, SnakeStance, SnakeTrend, 0 | 1];
/** `public/snake/nhl.json` (board chips). */
export interface SnakeNhlFile {
  v: 1;
  rows: Record<string, SnakeNhlEntry>;
}

/** Compact lookup entry: [key, verdict, trend, one-line summary ("" = none), probable (0|1)]. */
export type SnakeFantraxEntry = [string, SnakeStance, SnakeTrend, string, 0 | 1];
/** `public/snake/fantrax.json` (/league chips). */
export interface SnakeFantraxFile {
  v: 1;
  rows: Record<string, SnakeFantraxEntry>;
}

/** Build-time summary (`src/data/snake-summary.json`). */
export interface SnakeSummaryFile {
  v: 1;
  builtAt: string;
  scout: string;
  stats: SnakeStats;
  /** key → [verdict, trend, one-line summary ("" = none), probable (0|1)]. */
  rows: Record<string, [SnakeStance, SnakeTrend, string, 0 | 1]>;
  /** Keys folded into another record of the same player (old key → key). */
  aliases: Record<string, string>;
  /** NHL id → key; Fantrax id → key. */
  nhl: Record<string, string>;
  fx: Record<string, string>;
}

/** `src/data/snake-version.json`: content hash of `public/snake/**` (cache buster). */
export interface SnakeVersionFile {
  v: string;
}
