/**
 * The browser's copies of the Slapshot dynasty snapshot
 * (`public/fantrax/slapshot/dynasty.json`, scripts/dynasty-slapshot.ts),
 * derived at every dynasty build and before every site build, not
 * committed:
 *
 * - `dynasty-table.json`: the player table's records, in the shape the
 *   Captains table already reads (value and rank per mode, band, phase,
 *   trend, P(NHL), ETA, market) plus the league's own fields (positions,
 *   2026-27 season points, the contract and its cap charge, the model's
 *   sentence), without what only the reports read (eFP, p50G, nhlId,
 *   effAge, the far seasons);
 * - `contracts.json` (`src/lib/fantrax/salary-cap.ts`): the league cap per
 *   season and every player's cap hits, small enough for every tab (the
 *   plan's cap line, the draft board, Mon équipe).
 *
 * Pure.
 */
import { CONTRACT_SEASONS, type ContractRow, type ContractsFile } from "../fantrax/salary-cap";
import type { SlapshotRecord } from "./slapshot";
import type { DynastyRecord } from "./types";

/** The part of the Slapshot build's snapshot the copies read (scripts/dynasty-slapshot.ts `SlapshotSnapshot`). */
export interface SlapshotSnapshotLike {
  builtAt: string;
  league: { id: string; name: string; teams: number };
  season: "2026-27";
  version: 1;
  inputs: { poolFetchedAt: string; projectionsAt: string };
  params: {
    cap: { league: number[]; nhl: number[]; min: number[]; growthAfter: number; announced?: number[] };
    lambda: number[];
  };
  players: Record<string, SlapshotRecord>;
  zero: string[];
}

/** Seasons of the value chart and the gains the browser keeps. */
const CLIENT_SEASONS = 6;
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** The Slapshot contract a table row carries (a view of `SlapshotRecord.contract`). */
export interface ClientContract {
  /** Cap hit per season from 2026-27 (M$), signed then projected. */
  cap: number[];
  signed: number;
  expiry: number | null;
  status: "UFA" | "RFA" | null;
  nextAav: number | null;
  elc: boolean;
  /** Cap charge per season (league points), the first three seasons. */
  capFP: number[];
}

/**
 * A Slapshot record in the table's shape. `keeper` and `elig` are not
 * written: the league has no cutdown and no minors eligibility, and the
 * reader (`parseDynasty`) fills neutral values that no Slapshot view shows.
 */
export type ClientSlapshotRecord = Omit<DynastyRecord, "keeper" | "elig" | "eFP" | "p50G" | "seg" | "traj" | "effAge" | "nhlId"> & {
  pos: string[];
  fp0: number | null;
  contract: ClientContract;
  explanation: string;
};

export interface ClientSlapshotSnapshot {
  builtAt: string;
  season: "2026-27";
  version: 1;
  /** Marks the league profile (the reader relaxes the Captains-only fields). */
  profile: "slapshot";
  inputs: { stateFetchedAt: string };
  players: Record<string, ClientSlapshotRecord>;
  zero: string[];
}

function clientRecord(r: SlapshotRecord): ClientSlapshotRecord {
  const { dvMkt: _dvMkt, rank: _rank, ...market } = r.market;
  const c = r.contract;
  return {
    n: r.n,
    g: r.g,
    pos: r.pos,
    age: r.age,
    path: r.path,
    phase: r.phase,
    gp: r.gp,
    ...(r.draft ? { draft: r.draft } : {}),
    dv: r.dv,
    rank: r.rank,
    band: r.band,
    eG: r.eG.slice(0, CLIENT_SEASONS).map(r1),
    trend: r.trend ?? null,
    ...(r.growth ? { growth: (({ base: _b, ...g }) => g)(r.growth) as DynastyRecord["growth"] } : {}),
    pNhl: r.pNhl,
    eta: r.eta,
    market,
    ...(r.flags ? { flags: r.flags } : {}),
    fp0: r.fp0,
    contract: {
      cap: c.cap.slice(0, CONTRACT_SEASONS).map(r2),
      signed: c.signed,
      expiry: c.expiry,
      status: c.status,
      nextAav: c.nextAav,
      elc: c.elc,
      capFP: c.capFP.slice(0, 3),
    },
    explanation: r.explanation,
  };
}

export function slapshotClientSnapshot(full: SlapshotSnapshotLike): ClientSlapshotSnapshot {
  const players: Record<string, ClientSlapshotRecord> = {};
  for (const [id, r] of Object.entries(full.players)) players[id] = clientRecord(r);
  return {
    builtAt: full.builtAt,
    season: full.season,
    version: full.version,
    profile: "slapshot",
    // The rosters the values saw (the Slapshot pool's sync).
    inputs: { stateFetchedAt: full.inputs.poolFetchedAt },
    players,
    zero: full.zero,
  };
}

/** Start years whose NHL cap is announced (the profile's `cap.nhl` keys); the rest grow by `growthAfter`. */
export function slapshotContracts(full: SlapshotSnapshotLike, firstSeason: number, announced: readonly number[]): ContractsFile {
  const players: Record<string, ContractRow> = {};
  for (const id of Object.keys(full.players).sort()) {
    const c = full.players[id]!.contract;
    players[id] = {
      c: c.cap.slice(0, CONTRACT_SEASONS).map(r2),
      s: c.signed,
      x: c.expiry,
      st: c.status,
      ...(c.elc ? { elc: 1 as const } : {}),
    };
  }
  const cap = full.params.cap;
  return {
    builtAt: full.builtAt,
    firstSeason,
    cap: cap.league.slice(0, CONTRACT_SEASONS),
    min: cap.min.slice(0, CONTRACT_SEASONS),
    nhl: cap.nhl.slice(0, CONTRACT_SEASONS),
    growthAfter: cap.growthAfter,
    announced: announced.filter((y) => y >= firstSeason),
    lambda: full.params.lambda.slice(0, CONTRACT_SEASONS),
    players,
  };
}
