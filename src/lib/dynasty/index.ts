/**
 * buildDynasty: every player's dynasty value for the Captains Dynasty
 * League, from the joined inputs the build script assembles. Pure: no fs,
 * no fetch, seeded RNG — the same inputs give the same snapshot.
 *
 * Pipeline: route each player (NHL path / prospect path / fringe; young
 * skaters get their conditional growth path, growth.ts) → an ungated pass
 * sets the keeper-slot cost K and the keep-index gate → one gated
 * simulation per player (4,000 paths × 12 seasons) → values for every mode
 * → the market layer on thin segments → ranks, keeper status, eligibility
 * summary, expected keepers per cutdown.
 */
import { makeLevel } from "./aging";
import { birthdayInWindow, cutdownAge, isEligible } from "./eligibility";
import { makeGrowth } from "./growth";
import { teamKeepers, type TeamKeepersResult } from "./keepers";
import { applyMarket, MODEL_FLOOR, type MarketMember, type MarketPool } from "./market";
import type { DynastyParams } from "./params";
import { makeRetention } from "./retention";
import { replacement } from "./scale";
import { routePlayer, type Route, type Routed } from "./segment";
import { simulatePlayer, type SimContext } from "./simulate";
import type { DynastyBuildInputs, DynastyRecord, DynastySnapshot, KeeperStatus, Mode } from "./types";
import { MODES } from "./types";
import { calibrateK, discount, modeWeights, summarize, type KCalibration, type PlayerValue } from "./value";

export * from "./types";
export { parseParams, type DynastyParams } from "./params";

/** Paths per player: 4,000 keeps the long-term top 200 within ~10 ranks across seeds (2,000: P95 13). */
export const DEFAULT_PATHS = 4000;
export const SEED_KEY = "|dyn|v1";

export interface BuildOptions {
  /** Paths per player (default DEFAULT_PATHS). */
  paths?: number;
  /** Fixed K (skips the calibration pass; tests). */
  K?: number;
  /** Fixed keep-index gate with a fixed K (default K). */
  Kgate?: number;
  /** Market layer on/off (default params.market.enabled). */
  market?: boolean;
  /** RNG seed suffix (default SEED_KEY); a different key is a seed-stability check. */
  seedKey?: string;
  onProgress?: (done: number, total: number) => void;
}

export interface BuildInternal {
  routed: Routed;
  value: PlayerValue | null;
  pool: MarketPool;
}

export interface BuildResult {
  snapshot: DynastySnapshot;
  K: KCalibration;
  routes: Record<Route, number>;
  /** Everyone modeled, before the output filter (reports, checks). */
  internals: Map<string, BuildInternal>;
  /** Every record, before the output filter. */
  all: Record<string, DynastyRecord>;
  /** Team-conditional keeper odds (when the build has the league's rosters). */
  teams: TeamKeepersResult | null;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function keeperStatus(pElig1: number, pKept27: number | null): KeeperStatus {
  if (pElig1 >= 0.5) return "free";
  if (pKept27 == null) return "rental";
  if (pKept27 >= 0.8) return "core";
  if (pKept27 >= 0.4) return "bubble";
  return "rental";
}

/**
 * Year-0 goalie depth per NHL team (modeled NHL-path goalies, before
 * injuries): summed starts, and the reference they should reach — the
 * projected GP of the goalies still on the depth chart, capped at a season.
 * A status flag that wiped out a starter's season shows as starts << ref.
 */
export function goalieStarts0(p: DynastyParams, routed: readonly Routed[]): Record<string, { starts: number; ref: number }> {
  const SG = p.games.seasonGames;
  const out = new Map<string, { starts: number; ref: number }>();
  const depthOut = new Set(p.status0.depthIcons);
  for (const r of routed) {
    const team = r.input.team;
    if (r.g !== "G" || r.path !== "nhl" || !team || r.sim?.share0 == null) continue;
    const t = out.get(team) ?? { starts: 0, ref: 0 };
    t.starts += r.sim.share0 * SG;
    if (!(r.input.status ?? []).some((i) => depthOut.has(i))) t.ref += ((r.input.proj?.gp ?? 0) * SG) / p.games.projectionBasis;
    out.set(team, t);
  }
  return Object.fromEntries(
    [...out.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([team, t]) => [team, { starts: r1(t.starts), ref: r1(Math.min(SG, t.ref)) }]),
  );
}

export function buildDynasty(inputs: DynastyBuildInputs, p: DynastyParams, opts: BuildOptions = {}): BuildResult {
  const level = makeLevel(p);
  const growth = makeGrowth(p, level);
  const ret = makeRetention(p);
  const repl = replacement(p);
  const modes = modeWeights(p);
  const N = opts.paths ?? DEFAULT_PATHS;
  const T = p.T;
  const Y0 = p.firstSeasonYear;

  const seen = new Set<string>();
  const routed: Routed[] = [];
  for (const inp of inputs.players) {
    if (seen.has(inp.id)) continue;
    seen.add(inp.id);
    const rem = inp.team ? (inputs.remainingShare?.[inp.team] ?? 1) : 1;
    routed.push(routePlayer(p, level, inp, rem, growth));
  }
  const routes = { nhl: 0, prospect: 0, "nhl-part": 0, slot: 0, fringe: 0 } as Record<Route, number>;
  for (const r of routed) routes[r.route]++;

  const sims = routed.filter((r) => r.sim).map((r) => r.sim!);
  const base = { p, level, ret, repl, growth };
  const kGate = opts.Kgate ?? opts.K;
  const K: KCalibration =
    opts.K != null
      ? { value: opts.K, band: [opts.K, opts.K], gate: kGate!, gateBand: [kGate!, kGate!], pool: 0, fallback: false }
      : calibrateK(p, sims, base);
  const ctx: SimContext = { ...base, K: K.value, Kgate: K.gate, N, keepGate: true, seedKey: opts.seedKey ?? SEED_KEY, recordKi: !!inputs.league };

  const values = new Map<string, PlayerValue | null>();
  const keptPerCutdown = new Array<number>(T).fill(0);
  // the 2027 keep index per path (team-conditional keeper odds)
  const ki27 = new Map<string, Float64Array>();
  let done = 0;
  for (const r of routed) {
    const res = r.sim ? simulatePlayer(r.sim, ctx) : null;
    const v = res ? summarize(res, modes) : null;
    if (res?.ki1 && res.eligAt[1]! < 1) ki27.set(r.input.id, res.ki1);
    values.set(r.input.id, v);
    if (v) for (let t = 0; t < T; t++) keptPerCutdown[t] += v.keptShare[t]!;
    done++;
    if (opts.onProgress && done % 100 === 0) opts.onProgress(done, routed.length);
  }

  // ---- market layer
  const poolOf = (r: Routed): MarketPool => (r.path === "prospect" || r.eligNow ? "P" : r.g === "G" ? "G" : "S");
  const members: MarketMember[] = routed.map((r) => {
    const v = values.get(r.input.id);
    const dvModel = {} as Record<Mode, number>;
    for (const m of MODES) dvModel[m] = v ? v.dv[m] : 0;
    return { id: r.input.id, pool: poolOf(r), seg: r.seg, g: r.g, ros: r.input.ros, adp: r.input.adp, dvModel };
  });
  const market = applyMarket(p, members, opts.market ?? p.market.enabled);

  // ---- team-conditional keeper odds: each team's 10 best keep indices per path
  const teams = inputs.league
    ? teamKeepers(
        {
          rosters: inputs.league.rosters,
          remainingPicks: inputs.league.remainingPicks,
          pool: routed.filter((r) => !r.input.rostered).map((r) => ({ id: r.input.id, ros: r.input.ros, adp: r.input.adp })),
        },
        ki27,
        p.K.teamSlots,
      )
    : null;
  const rosteredIds = new Set(inputs.league ? Object.values(inputs.league.rosters).flat() : []);

  // ---- records
  const all: Record<string, DynastyRecord> = {};
  const internals = new Map<string, BuildInternal>();
  for (const r of routed) {
    const id = r.input.id;
    const v = values.get(id) ?? null;
    const mk = market.get(id)!;
    internals.set(id, { routed: r, value: v, pool: poolOf(r) });
    const dvModel = {} as Record<Mode, number>;
    for (const m of MODES) dvModel[m] = v ? v.dv[m] : 0;
    // One posterior factor scales eG, the medians and the bands, so every
    // mode stays exact from the exported eG (Σ w_t δ^t eG[t] = dv[mode]).
    let eG = v ? [...v.eG] : new Array<number>(T).fill(0);
    let p50G = v ? [...v.p50G] : new Array<number>(T).fill(0);
    let bandBal: [number, number, number] = v ? [...v.band.balanced] : [0, 0, 0];
    let bandLt: [number, number, number] = v ? [...v.band.longTerm] : [0, 0, 0];
    const dvPost = { ...mk.dv };
    if (mk.moved) {
      const post = mk.dv.balanced;
      const model = dvModel.balanced;
      if (model >= MODEL_FLOOR) {
        const k = post / model;
        eG = eG.map((x) => x * k);
        p50G = p50G.map((x) => x * k);
        bandBal = bandBal.map((x) => x * k) as [number, number, number];
        bandLt = bandLt.map((x) => x * k) as [number, number, number];
      } else {
        // no model value to scale: the market value, spread flat from the expected arrival
        const t0 = Math.max(1, (v?.etaMedian ?? r.pm?.eta ?? Y0) - Y0);
        const on = (t: number) => t >= Math.min(t0, T - 1);
        const denom = discount(
          eG.map((_, t) => (on(t) ? 1 : 0)),
          modes.balanced,
        );
        const c = denom > 0 ? Math.max(0, post) / denom : 0;
        eG = eG.map((_, t) => (on(t) ? c : 0));
        p50G = [...eG];
        for (const m of MODES) dvPost[m] = discount(eG, modes[m]);
        bandBal = [dvPost.balanced, dvPost.balanced, dvPost.balanced];
        bandLt = [dvPost.longTerm, dvPost.longTerm, dvPost.longTerm];
      }
    }
    const pElig = v ? v.pElig : null;
    const elig1 = pElig
      ? pElig[1]!
      : isEligible(p, r.g, cutdownAge(p, r.input.birthDate, r.age0, 1), r.gp0)
        ? 1
        : 0;
    let freeThrough: number | null = null;
    if (r.eligNow) {
      if (pElig) {
        for (let t = 0; t < T; t++) if (pElig[t]! >= 0.5) freeThrough = Y0 + t;
      } else freeThrough = Y0 + (elig1 >= 0.5 ? 1 : 0);
    }
    const pKept27 = v ? v.pKept[1] ?? null : null;
    const uncertain = (elig1 > 0.15 && elig1 < 0.85) || birthdayInWindow(p, r.input.birthDate, Y0 + 1);
    const flags = new Set(r.flags);
    if (uncertain) flags.add("eligibilityUncertain");
    const rec: DynastyRecord = {
      n: r.input.n,
      g: r.g,
      age: r1(r.age0),
      ...(r.input.nhlId ? { nhlId: r.input.nhlId } : {}),
      path: r.path,
      seg: r.seg,
      phase: r.phase,
      effAge: r.effAge,
      traj: r.traj.shift,
      gp: Math.round(r.gp0),
      ...(r.draft ? { draft: { year: r.draft.year, pick: r.draft.pick } } : {}),
      dv: { winNow: r1(dvPost.winNow), balanced: r1(dvPost.balanced), longTerm: r1(dvPost.longTerm) },
      ...(mk.moved ? { dvModel: { winNow: r1(dvModel.winNow), balanced: r1(dvModel.balanced), longTerm: r1(dvModel.longTerm) } } : {}),
      rank: { winNow: 0, balanced: 0, longTerm: 0 },
      band: {
        balanced: bandBal.map(Math.round) as [number, number, number],
        longTerm: bandLt.map(Math.round) as [number, number, number],
      },
      eG: eG.map(r1),
      p50G: p50G.map((x) => Math.round(x)),
      eFP: (v ? v.eFP : new Array<number>(T).fill(0)).map((x) => Math.round(x)),
      trend: r.path === "nhl" && v?.trend != null ? r3(v.trend) : null,
      ...(r.growth
        ? {
            growth: {
              src: r.growth.src,
              base: r3(r.growth.base),
              baseAge: r1(r.growth.baseAge),
              pct: r3(r.growth.path.pct),
              pick: r.growth.pick,
              m: r.growth.path.m.map(r3),
            },
          }
        : {}),
      pNhl: r3(v ? v.pMade : 0),
      eta: r.path === "prospect" ? (v?.etaMedian ?? r.pm?.eta ?? null) : null,
      elig: {
        now: r.eligNow,
        next: r3(elig1),
        freeThrough,
        binding: r.eligNow ? (v?.binding ?? (r.age0 + 1 >= p.eligibility.age ? "age" : "gp")) : null,
        uncertain,
      },
      keeper: {
        status: keeperStatus(elig1, pKept27),
        pKept27: pKept27 == null ? null : r3(pKept27),
        ...(teams && rosteredIds.has(id)
          ? (() => {
              const o = teams.odds.get(id);
              const pt = o?.pKept ?? null;
              return { team: { status: keeperStatus(elig1, pt), pKept27: pt == null ? null : r3(pt), rank: o?.rank ?? null } };
            })()
          : {}),
      },
      market: {
        ...(r.input.ros != null ? { ros: r.input.ros } : {}),
        ...(r.input.adp != null ? { adp: r1(r.input.adp) } : {}),
        ...(r.input.leaguePick != null ? { leaguePick: r.input.leaguePick } : {}),
        ...(mk.rank != null ? { rank: mk.rank } : {}),
        ...(mk.dvMkt != null ? { dvMkt: r1(mk.dvMkt) } : {}),
        w: mk.w,
        ...(mk.gap != null && r.path !== "fringe" ? { gap: mk.gap } : {}),
      },
      ...(flags.size ? { flags: [...flags].sort() } : {}),
    };
    all[id] = rec;
  }
  for (const m of MODES) {
    Object.entries(all)
      .sort((a, b) => b[1].dv[m] - a[1].dv[m] || a[0].localeCompare(b[0]))
      .forEach(([, rec], i) => (rec.rank[m] = i + 1));
  }
  const players: Record<string, DynastyRecord> = {};
  const zero: string[] = [];
  const rostered = new Set(inputs.players.filter((x) => x.rostered).map((x) => x.id));
  // Every modeled player left out (values.json rows and prospects alike) is
  // listed, so the tables read 0 for him instead of « not modeled ».
  for (const id of Object.keys(all).sort()) {
    const rec = all[id]!;
    if (rostered.has(id) || rec.dv.longTerm >= p.output.minLongTerm) players[id] = rec;
    else zero.push(id);
  }

  const meta = inputs.meta;
  const builtAt = [meta.valuesFetchedAt, meta.stateFetchedAt, meta.projectionsAt, meta.prospectsBuiltAt, meta.poolFetchedAt ?? ""]
    .filter(Boolean)
    .sort()
    .pop()!;
  const snapshot: DynastySnapshot = {
    builtAt,
    season: "2026-27",
    version: 1,
    inputs: {
      valuesFetchedAt: meta.valuesFetchedAt,
      stateFetchedAt: meta.stateFetchedAt,
      projectionsAt: meta.projectionsAt,
      prospectsBuiltAt: meta.prospectsBuiltAt,
      poolFetchedAt: meta.poolFetchedAt ?? null,
      paramsVersion: p.version,
      ytdGames: inputs.players.reduce((s, x) => s + Math.max(0, x.seasonGp ?? 0), 0),
    },
    params: {
      T,
      paths: N,
      seasonGames: p.games.seasonGames,
      lambda: p.lambda.value,
      deltaKeep: p.K.keepDelta,
      scale: { F: { a: p.scale.F.a, b: p.scale.F.b }, D: { a: p.scale.D.a, b: p.scale.D.b } },
      repl: { F: r3(repl.F), D: r3(repl.D), Gseason: repl.Gseason },
      offRef: r3(repl.offRef),
      K: {
        value: r1(K.value),
        band: [r1(K.band[0]), r1(K.band[1])],
        rank: p.K.rank,
        gate: r1(K.gate),
        gateBand: [r1(K.gateBand[0]), r1(K.gateBand[1])],
      },
      modes: {
        winNow: { ...modes.winNow },
        balanced: { ...modes.balanced },
        longTerm: { ...modes.longTerm },
      },
      cutdown: { month: p.cutdown.month, day: p.cutdown.day, window: [p.cutdown.window[0], p.cutdown.window[1]] },
      market: { enabled: opts.market ?? p.market.enabled, weights: { ...p.market.weights } },
    },
    players,
    diag: { goalieStarts0: goalieStarts0(p, routed), keptPerCutdown: keptPerCutdown.slice(1, 4).map(r1) },
    zero,
  };
  return { snapshot, K, routes, internals, all, teams };
}
