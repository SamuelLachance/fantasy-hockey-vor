/**
 * Player cards (/joueur?id=<NHL id>): the data file shape
 * (scripts/build-player-cards.ts), the shard of a player, and the addresses
 * that link to a card. Pure.
 */

/** Files the cards are split into (public/joueurs/00.json … 63.json). */
export const CARD_SHARDS = 64;

export function cardShard(nhlId: number): number {
  return ((nhlId % CARD_SHARDS) + CARD_SHARDS) % CARD_SHARDS;
}

export function cardShardFile(nhlId: number): string {
  return `joueurs/${String(cardShard(nhlId)).padStart(2, "0")}.json`;
}

/** One player's card data. */
export interface PlayerCardData {
  id: number;
  n: string;
  /** NHL team (projection's when projected). */
  t: string;
  pos: string[];
  g: boolean;
  num: number | null;
  bd: string | null;
  from: string | null;
  /** Height (inches), weight (lb), shoots / catches. */
  h: number | null;
  w: number | null;
  sh: string | null;
  /** NHL draft: year, round (null when unknown), overall pick, team. */
  dr: [number, number | null, number, string] | null;
  /** NHL contract: cap hit (M$), years left, status at expiry, type. */
  k: { cap: number; yrs: number | null; st: string | null; ty: string | null } | null;
  /** Durability: trend, score 0-1. */
  inj: { tr: string | null; d: number | null } | null;
  /**
   * NHL career by season: skaters [season, team, GP, G, A, PPP, SOG, HIT,
   * BLK, TOI min]; goalies [season, team, GP, W, SV%, GAA, SO].
   */
  hist: (string | number)[][];
  /** His part in each of the user's leagues (built from their published files). */
  lg?: {
    captains?: FantraxCardPart;
    slapshot?: FantraxCardPart;
    ltl?: LtlCardPart;
  };
  /** Snake: [key of his Snake page, verdict, trend]. */
  sn?: [string, string, string] | null;
  /** This season so far (NHL), and a current injury with its estimated return. */
  cur?: { gp: number; s: Record<string, number> } | null;
  injNow?: { st: string; ret: string | null; out: number; note: string | null } | null;
  /** This season's projection. */
  proj:
    | { gp: number; g: number; a: number; ppp: number; sog: number; hit: number; blk: number; pim: number }
    | { gp: number; w: number; sv: number; gaa: number; so: number }
    | null;
}

export interface CardFile {
  v: 1;
  projectionsAt: string;
  players: Record<string, PlayerCardData>;
}

/** A player's card, for next/link: by NHL id, or by a Fantrax id of a league (resolved on the card). */
export function playerCardPath(p: { nhl?: number | null; fx?: string | null; league?: string | null }): string | null {
  if (p.nhl) return `/joueur?id=${p.nhl}`;
  if (p.fx && p.league) return `/joueur?fx=${encodeURIComponent(p.fx)}&ligue=${encodeURIComponent(p.league)}`;
  return null;
}

/** Age in years at a date (ISO birth date). */
export function ageOn(birthDate: string | null, nowMs: number): number | null {
  if (!birthDate) return null;
  const b = Date.parse(`${birthDate}T00:00:00Z`);
  if (!Number.isFinite(b)) return null;
  return (nowMs - b) / (365.2425 * 24 * 3600 * 1000);
}

/** Percentile (0-100) of a value in an ascending list. */
export function percentileOf(sortedAsc: readonly number[], v: number): number {
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return sortedAsc.length ? Math.max(0, Math.min(100, Math.round((lo / sortedAsc.length) * 100))) : 0;
}

/** A player in a Fantrax dynasty league. */
export interface FantraxCardPart {
  fx: string;
  /** Owner team id and name (null: available), his roster status. */
  own: string | null;
  ownName: string | null;
  st: string | null;
  /** Dynasty value, league rank and asset score (0-100) per horizon. */
  dv: { W: number; B: number; L: number } | null;
  rk: { W: number; B: number; L: number } | null;
  sc: { W: number; B: number; L: number } | null;
  ph: string | null;
  /** Expected value per season (the model's units), first six. */
  eG: number[] | null;
  /** Captains: 2027 cutdown status and odds of being kept. */
  kp?: { st: string; p: number | null } | null;
  /** Slapshot: the recommended (or confirmed) league contract. */
  ct?: { y: number; e: number; b: number; eb: number | null; f: boolean; sal: number[]; start: number } | null;
}

/** A player in Light the Lamp (Yahoo, categories). */
export interface LtlCardPart {
  rank: number | null;
  vor: number | null;
  posRank: Record<string, number> | null;
  /** Projection [G, A, PPP, SOG, HIT, BLK] or goalies' own. */
  z: number[] | null;
  adjusted: string | null;
  onBoard: boolean;
}
