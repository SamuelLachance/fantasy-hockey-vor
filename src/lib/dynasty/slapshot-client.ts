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
    cap: { league: number[]; nhl: number[]; min: number[]; growthAfter: number; announced?: number[]; elcCapHit?: number; elcYears?: number };
    lambda: number[];
    rosterSpot?: { cost: number };
  };
  players: Record<string, SlapshotRecord>;
  zero: string[];
  /** The zero-value ids' contracts (a snapshot built before they were written has none). */
  zeroContracts?: Record<string, Pick<SlapshotRecord["contract"], "cap" | "signed" | "expiry" | "status" | "elc">>;
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

/**
 * Every modeled player's cap hits — the valued ones and the zero-value ones
 * alike (a late pick of a zero-value NHL player counts his real cap hit, not
 * « sans salaire connu »). Start years whose NHL cap is announced (the
 * profile's `cap.nhl` keys); the rest grow by `growthAfter`.
 */
export function slapshotContracts(full: SlapshotSnapshotLike, firstSeason: number, announced: readonly number[]): ContractsFile {
  const players: Record<string, ContractRow> = {};
  const all: Record<string, Pick<SlapshotRecord["contract"], "cap" | "signed" | "expiry" | "status" | "elc">> = { ...full.zeroContracts };
  for (const [id, r] of Object.entries(full.players)) all[id] = r.contract;
  for (const id of Object.keys(all).sort()) {
    const c = all[id]!;
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
    ...(full.params.rosterSpot ? { rosterSpot: full.params.rosterSpot.cost } : {}),
    ...(cap.elcCapHit != null && cap.elcYears != null ? { elc: { capHit: cap.elcCapHit, years: cap.elcYears } } : {}),
    players,
  };
}

// ---------------------------------------------------------------- cap plan

/** File name of the « Plafond » tab's data, next to dynasty.json (not committed). */
export const CAP_PLAN_FILE = "cap-plan.json";

/** One player's league-contract inputs: enough for the browser to re-plan any length. */
export interface CapPlanRow {
  /** Name, positions, age, phase and dynasty value per horizon (the tab needs nothing else). */
  nm: string;
  pos: string[];
  age: number;
  ph: string;
  dv: { W: number; B: number; L: number };
  /** Season index of the first league contract. */
  s: number;
  /** Real NHL cap hit per season (the bases), M$. */
  n: number[];
  /** Expected value per season before the cap, league points above replacement. */
  v: number[];
  /** Planned first-contract length, extension, bases. */
  y: number;
  e: number;
  b: number;
  eb: number | null;
  /** The first contract is confirmed. */
  f?: 1;
}

export interface CapPlanFile {
  builtAt: string;
  firstSeason: number;
  cap: number;
  floor: number;
  /** Cap shadow price and league minimum per season. */
  lambda: number[];
  min: number[];
  rules: { mult: number[]; maxYears: number; extensions: number; delta: number };
  /** Discount per season of each dynasty horizon (winNow, balanced, longTerm). */
  deltas: { W: number; B: number; L: number };
  players: Record<string, CapPlanRow>;
}

/** The league-contract plans of every valued player (null: the profile has no league contracts). */
export function slapshotCapPlan(
  full: SlapshotSnapshotLike & {
    params: { contracts?: CapPlanFile["rules"]; cap: { floor?: number }; modes?: Record<string, { delta: number }> };
  }, firstSeason: number): CapPlanFile | null {
  const rules = full.params.contracts;
  if (!rules) return null;
  const players: Record<string, CapPlanRow> = {};
  for (const id of Object.keys(full.players).sort()) {
    const c = full.players[id]!.contract;
    const L = c.league;
    if (!L || !c.nhl) continue;
    // nobody would roster him: not worth the bytes
    if (Math.max(full.players[id]!.dv.balanced, full.players[id]!.dv.longTerm) < 1) continue;
    const r = full.players[id]!;
    players[id] = {
      nm: r.n,
      pos: r.pos,
      age: r1(r.age),
      ph: r.phase,
      dv: { W: r1(r.dv.winNow), B: r1(r.dv.balanced), L: r1(r.dv.longTerm) },
      s: L.start,
      n: c.nhl.map(r2),
      v: L.value.map(r1),
      y: L.years,
      e: L.ext,
      b: L.base,
      eb: L.extBase,
      ...(L.fixed ? { f: 1 as const } : {}),
    };
  }
  return {
    builtAt: full.builtAt,
    firstSeason,
    cap: full.params.cap.league[0]!,
    floor: full.params.cap.floor ?? 0,
    lambda: full.params.lambda,
    min: full.params.cap.min,
    rules,
    deltas: {
      W: full.params.modes?.winNow?.delta ?? 0.35,
      B: full.params.modes?.balanced?.delta ?? rules.delta,
      L: full.params.modes?.longTerm?.delta ?? 0.95,
    },
    players,
  };
}
