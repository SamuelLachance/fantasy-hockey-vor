/**
 * Stacking the market consensus into the v2 skater projection.
 *
 * The market is ESPN's public pre-season projection (src/data/ml/
 * market-espn.json, scripts/build-espn-market.ts). Walk-forward 2019-20 →
 * 2025-26 (scripts/backtest-projections.ts) the stack beats it on every
 * rate, but the market knows things the box-score history cannot: camp
 * injuries, line and power-play assignments, holdouts. Its games played beat
 * the stack's on the players it projects (MAE 8.95 vs 9.73), so a share of
 * the gap is worth taking:
 *
 *   rate' = rate + β_stat · (market rate − rate)
 *   gp'   = gp   + β_gp   · (market gp   − gp)
 *
 * one β per stat and one for games, each the least-squares weight of the
 * market's gap on the stack's out-of-sample error (clipped to [0, 1]), fitted
 * on past seasons only. Players the market does not project keep the stack.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { scheduledGamesForSeason } from "../nhl-api";
import { actualRate, gp82 } from "./dataset-view";
import type { SeasonPredictions } from "./stack";

export const MARKET_BLEND_STATS = [
  "goals",
  "assists",
  "shots",
  "blocks",
  "hits",
  "powerplayPoints",
  "penaltyMinutes",
] as const;
export type MarketBlendStat = (typeof MARKET_BLEND_STATS)[number];

/** One player's market projection: per-game rates and 82-game-equivalent games. */
export interface MarketLine {
  rates: Record<MarketBlendStat, number>;
  gp: number;
}

export interface MarketBlend {
  /** Where the market comes from (file `source`). */
  source: string;
  /** Seasons whose (stack, market, actual) triples fitted the weights. */
  fittedSeasons: number[];
  /** Number of player-seasons in the fit. */
  pairs: number;
  /** Weight of the market's gap per stat (0 = stack only, 1 = market only). */
  betas: Record<MarketBlendStat, number>;
  gpBeta: number;
}

interface MarketSkaterRow {
  id: number;
  gp: number;
  goals: number;
  assists: number;
  shots: number;
  hits: number;
  blocks: number;
  powerplayPoints: number;
  penaltyMinutes: number;
}

export interface MarketFileShape {
  builtAt: string;
  source: string;
  seasons: Record<string, { skaters: MarketSkaterRow[] }>;
}

export const MARKET_FILE_PATH = join(process.cwd(), "src", "data", "ml", "market-espn.json");

export function loadMarketFile(path = MARKET_FILE_PATH): MarketFileShape | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as MarketFileShape;
}

/**
 * The market's skater lines of one season keyed by NHL id. A season the
 * market projected on a short schedule (2020-21: 56 games) is put on an
 * 82-game basis like the stack's games.
 */
export function marketLinesFor(file: MarketFileShape | null, seasonId: number): Map<number, MarketLine> {
  const out = new Map<number, MarketLine>();
  const rows = file?.seasons[String(seasonId)]?.skaters ?? [];
  if (rows.length === 0) return out;
  const maxGp = Math.max(...rows.map((r) => r.gp));
  const scale = maxGp < 70 ? 82 / scheduledGamesForSeason(seasonId) : 1;
  for (const r of rows) {
    if (!(r.gp > 0)) continue;
    out.set(r.id, {
      rates: {
        goals: r.goals / r.gp,
        assists: r.assists / r.gp,
        shots: r.shots / r.gp,
        blocks: r.blocks / r.gp,
        hits: r.hits / r.gp,
        powerplayPoints: r.powerplayPoints / r.gp,
        penaltyMinutes: r.penaltyMinutes / r.gp,
      },
      gp: Math.min(82, r.gp * scale),
    });
  }
  return out;
}

/** One out-of-sample training triple: the stack's line, the market's, the outcome. */
export interface BlendSample {
  stack: { rates: Record<string, number>; gp: number };
  market: MarketLine;
  actual: { rates: Record<string, number>; gp: number };
  /** Weight of a rate residual (games-based reliability, e.g. min(60, GP) / 60). */
  rateWeight: number;
}

/** Least-squares weight of x − a on y − a, clipped to [0, 1]. */
function blendWeight(samples: Array<{ a: number; x: number; y: number; w: number }>): number {
  let num = 0;
  let den = 0;
  for (const s of samples) {
    if (!Number.isFinite(s.a) || !Number.isFinite(s.x) || !Number.isFinite(s.y) || !(s.w > 0)) continue;
    num += s.w * (s.x - s.a) * (s.y - s.a);
    den += s.w * (s.x - s.a) * (s.x - s.a);
  }
  return den > 0 ? Math.max(0, Math.min(1, num / den)) : 0;
}

export function fitMarketBlend(
  samples: BlendSample[],
  source: string,
  fittedSeasons: number[],
): MarketBlend {
  const betas = {} as Record<MarketBlendStat, number>;
  for (const t of MARKET_BLEND_STATS) {
    betas[t] = blendWeight(
      samples.map((s) => ({ a: s.stack.rates[t], x: s.market.rates[t], y: s.actual.rates[t], w: s.rateWeight })),
    );
  }
  const gpBeta = blendWeight(samples.map((s) => ({ a: s.stack.gp, x: s.market.gp, y: s.actual.gp, w: 1 })));
  return { source, fittedSeasons: [...fittedSeasons], pairs: samples.length, betas, gpBeta };
}

/** The stack's per-game rates and games moved toward the market's line. */
export function applyMarketBlend<T extends Record<string, number>>(
  blend: MarketBlend | undefined,
  market: MarketLine | undefined,
  rates: T,
  gp: number,
): { rates: T; gp: number } {
  if (!blend || !market) return { rates, gp };
  const out = { ...rates };
  for (const t of MARKET_BLEND_STATS) {
    const m = market.rates[t];
    const r = rates[t];
    if (!Number.isFinite(m) || !Number.isFinite(r)) continue;
    (out as Record<string, number>)[t] = Math.max(0, r + blend.betas[t] * (m - r));
  }
  const g = Number.isFinite(market.gp) ? gp + blend.gpBeta * (market.gp - gp) : gp;
  return { rates: out, gp: Math.max(0, Math.min(82, g)) };
}

/** The stack's out-of-sample lines of walk-forward seasons, keyed by season. */
export type StackLines = Map<number, Array<{ rates: Record<string, number>; gp: number }>>;

/**
 * Fit the blend on every season of `pool` the market projected: the stack's
 * out-of-sample line (`lines`, src/lib/ml/stack.ts stackLinesOutOfSample),
 * the market's, and the realized season of each player both projected.
 * Undefined when no season qualifies.
 */
export function fitMarketBlendOnSeasons(
  pool: SeasonPredictions[],
  lines: StackLines,
  file: MarketFileShape | null,
): MarketBlend | undefined {
  const samples: BlendSample[] = [];
  const fitted: number[] = [];
  for (const s of [...pool].sort((a, b) => a.seasonId - b.seasonId)) {
    const market = marketLinesFor(file, s.seasonId);
    const own = lines.get(s.seasonId);
    if (market.size === 0 || !own) continue;
    let n = 0;
    s.examples.forEach((ex, k) => {
      const m = market.get(ex.playerId);
      if (!m) return;
      const rates: Record<string, number> = {};
      for (const t of MARKET_BLEND_STATS) rates[t] = actualRate(ex.actualRow, t);
      samples.push({
        stack: own[k],
        market: m,
        actual: { rates, gp: Math.min(82, gp82(ex.actualRow)) },
        rateWeight: Math.min(60, ex.actualRow.gamesPlayed) / 60,
      });
      n++;
    });
    if (n > 0) fitted.push(s.seasonId);
  }
  return samples.length > 0 ? fitMarketBlend(samples, file?.source ?? "", fitted) : undefined;
}
