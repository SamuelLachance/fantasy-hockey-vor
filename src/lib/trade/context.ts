/**
 * The trade evaluator's inputs from what a Fantrax league's tabs already
 * read: the dynasty records (`dynasty-table.json`), the projections
 * (`values.json`), the rosters (snapshot + live read), the future picks and
 * their values per horizon (`assetsOf`), the schedule (the share of each
 * club's fantasy season still to play) and, in a cap league, the contracts.
 * Pure.
 */
import type { AssetHorizon, AssetRecord, TeamAssets } from "../dynasty/asset-score";
import { slotTokens, type FantraxLeagueConfig } from "../fantrax/config";
import { isGoalieRecord, seasonFp } from "../fantrax/draft-inputs";
import type { ContractsFile } from "../fantrax/salary-cap";
import type { ValueRecord } from "../fantrax/snapshot-types";
import type { SlotSpec } from "../leagues/slot-fill";
import type { CapInputs, TradeContext, TradePick } from "./evaluate";
import { TRADE_BENCH } from "./params";
import { freeAgentBySlot, HORIZONS, type Horizon, type TeamPlayer } from "./team-value";

export type TradeRecord = AssetRecord & { pos?: string[] };

export interface TradeBuildInput {
  config: FantraxLeagueConfig;
  teams: readonly string[];
  rosters: Readonly<Record<string, ReadonlyArray<{ id: string; status: string }>>>;
  records: Readonly<Record<string, TradeRecord>>;
  values: Readonly<Record<string, ValueRecord>> | null;
  /** Share of a club's fantasy season still to play (1 before the season). */
  remaining: (club: string) => number;
  /** `assetsOf` for each horizon (pick values, team windows). */
  assets: Readonly<Record<Horizon, readonly TeamAssets[]>>;
  contracts: ContractsFile | null;
  /** Horizon the user picked for a team (else its window's). */
  horizonOverride?: Readonly<Record<string, Horizon>>;
}

/** A team's window → the horizon it plays for. */
export function windowHorizon(window: TeamAssets["window"]): Horizon {
  return window === "Aspirant" ? "winNow" : window === "Reconstruction" || window === "En montée" ? "longTerm" : "balanced";
}

export function teamSeats(config: FantraxLeagueConfig): SlotSpec<string>[] {
  return config.slots.order
    .filter((s) => (config.slots.counts[s] ?? 0) > 0)
    .map((s) => ({ slot: s, capacity: config.slots.counts[s] ?? 0, accepts: slotTokens(config, s) }));
}

/** Rest-of-season share per club from the schedule (games from `nowMs` to the league's end over its whole season). */
export function remainingShares(
  games: ReadonlyArray<readonly [string, string, string]>,
  startDate: string,
  endDate: string,
  nowMs: number,
): (club: string) => number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T23:59:59Z`);
  const all = new Map<string, number>();
  const left = new Map<string, number>();
  for (const [iso, away, home] of games) {
    const t = Date.parse(iso);
    if (!(t >= start && t <= end)) continue;
    for (const c of [away, home]) {
      all.set(c, (all.get(c) ?? 0) + 1);
      if (t >= nowMs) left.set(c, (left.get(c) ?? 0) + 1);
    }
  }
  return (club) => {
    const a = all.get(club);
    return a ? (left.get(club) ?? 0) / a : 1;
  };
}

export function buildTradeContext(inp: TradeBuildInput): TradeContext {
  const { config } = inp;
  const ids = new Set<string>([...Object.keys(inp.records), ...Object.keys(inp.values ?? {})]);
  const players: Record<string, TeamPlayer> = {};
  for (const id of ids) {
    const r = inp.records[id];
    const v = inp.values?.[id];
    if (!r && !v) continue;
    const goalie = v ? isGoalieRecord(v, config) : r?.g === "G";
    const fp = v && v.src === "proj" ? seasonFp(v, config) * inp.remaining(v.t) : 0;
    players[id] = {
      id,
      name: r?.n ?? v?.n ?? id,
      pos: v ? v.e.split(",").map((t) => t.trim()) : (r?.pos ?? (goalie ? [config.eligibility.goalieToken] : [])),
      goalie,
      dv: { winNow: Math.max(0, r?.dv.winNow ?? 0), balanced: Math.max(0, r?.dv.balanced ?? 0), longTerm: Math.max(0, r?.dv.longTerm ?? 0) },
      fp,
      minorsOk: config.features.minorsAnyPlayer ? true : config.features.minors ? !!r?.elig?.now : false,
    };
  }
  const rosters: Record<string, string[]> = {};
  for (const t of inp.teams) rosters[t] = (inp.rosters[t] ?? []).map((e) => e.id).filter((id) => players[id]);
  const rostered = new Set(Object.values(rosters).flat());
  const fas = Object.values(players).filter((p) => !rostered.has(p.id));
  const faValues = {} as Record<Horizon, number[]>;
  for (const h of HORIZONS) faValues[h] = fas.map((p) => p.dv[h]).sort((a, b) => b - a).slice(0, 12);
  const seats = teamSeats(config);

  // picks: one record per pick, its value under each horizon
  const picks: Record<string, TradePick> = {};
  for (const h of HORIZONS) {
    for (const t of inp.assets[h]) {
      for (const a of t.assets) {
        if (a.kind !== "pick") continue;
        const p = (picks[a.id] ??= { id: a.id, name: a.name, owner: a.team, original: a.original, value: { winNow: 0, balanced: 0, longTerm: 0 } });
        (p.value as Record<Horizon, number>)[h] = a.value;
      }
    }
  }

  const horizonOf: Record<string, Horizon> = {};
  for (const t of inp.assets.balanced) horizonOf[t.team] = inp.horizonOverride?.[t.team] ?? windowHorizon(t.window);

  // the market's view: his market rank read on the league's value curve
  const curve = {} as Record<Horizon, number[]>;
  for (const h of HORIZONS) curve[h] = Object.values(inp.records).map((r) => Math.max(0, r.dv[h] ?? 0)).sort((a, b) => b - a);
  const market = (id: string, h: AssetHorizon): number | null => {
    const r = inp.records[id];
    const gap = r?.market?.gap;
    const rank = r?.rank?.balanced;
    if (gap == null || rank == null) return null;
    const m = Math.max(1, Math.round(rank + gap));
    return curve[h][m - 1] ?? 0;
  };

  let cap: CapInputs | null = null;
  if (config.salaryCap && inp.contracts) {
    const c = inp.contracts;
    const rules = config.salaryCap;
    const status = new Map<string, string>();
    for (const t of inp.teams) for (const e of inp.rosters[t] ?? []) status.set(`${t}|${e.id}`, e.status);
    const n = Math.min(4, c.cap.length);
    cap = {
      seasons: Array.from({ length: n }, (_, i) => c.firstSeason + i),
      cap: c.cap.slice(0, n),
      hits: (id) => c.players[id]?.c,
      spots: rules.countedSpots,
      counted: (team, id) => rules.countedStatuses.includes(status.get(`${team}|${id}`) ?? ""),
    };
  }

  return {
    teams: inp.teams,
    rosters,
    players,
    picks,
    horizonOf,
    roster: config.features.minorsAnyPlayer
      ? { main: config.salaryCap?.countedSpots ?? config.limits.maxActive + config.limits.maxReserve, minors: config.limits.maxMinors }
      : { main: config.limits.maxActive + config.limits.maxReserve, minors: config.features.minors ? config.limits.maxMinors : 0 },
    lineup: {
      seats,
      benchShare: config.features.gamesCaps ? TRADE_BENCH.cappedBenchShare : TRADE_BENCH.benchShare,
      goalieBenchShare: TRADE_BENCH.goalieBenchShare,
      benchSize: config.limits.maxReserve,
      captainBonus: config.features.captainSlot ? 0.5 : 0,
    },
    faValues,
    faBySlot: freeAgentBySlot(fas, seats),
    market,
    cap,
  };
}
