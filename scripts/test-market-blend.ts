/**
 * Market blend (src/lib/ml/market-blend.ts): the fit recovers a known
 * weight, clips to [0, 1], ignores a market that adds nothing, and the
 * application leaves a player the market does not project untouched; a stat
 * the market did not publish (null) is skipped, not read as 0; a longer
 * schedule is put on the 82-game basis.
 * Run: npx tsx scripts/test-market-blend.ts
 */
import assert from "node:assert/strict";
import {
  applyMarketBlend,
  fitMarketBlend,
  marketLinesFor,
  marketScheduleGames,
  MARKET_BLEND_STATS,
  zeroFilledMarketStats,
  type BlendSample,
  type MarketFileShape,
  type MarketLine,
} from "../src/lib/ml/market-blend";
import { unpublishedStats } from "./build-espn-market";

let seed = 11;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd());

const line = (v: number, gp: number): MarketLine => ({
  rates: Object.fromEntries(MARKET_BLEND_STATS.map((t) => [t, v])) as MarketLine["rates"],
  gp,
});

// Truth = 0.7 stack + 0.3 market (+ noise): the fitted weight is ~0.3.
const samples: BlendSample[] = [];
for (let i = 0; i < 4000; i++) {
  const truth = 0.5 + 0.2 * gauss();
  const s = truth + 0.1 * gauss();
  const m = truth + 0.1 * gauss();
  const actual = 0.5 * s + 0.5 * m + 0.02 * gauss();
  const gpS = 70 + 5 * gauss();
  const gpM = 70 + 5 * gauss();
  samples.push({
    stack: { rates: line(s, 0).rates, gp: gpS },
    market: line(m, gpM),
    actual: { rates: line(actual, 0).rates, gp: 0.8 * gpS + 0.2 * gpM },
    rateWeight: 1,
  });
}
const blend = fitMarketBlend(samples, "test", [20242025]);
for (const t of MARKET_BLEND_STATS) assert.ok(Math.abs(blend.betas[t] - 0.5) < 0.05, `${t} beta ${blend.betas[t]}`);
assert.ok(Math.abs(blend.gpBeta - 0.2) < 0.03, `gp beta ${blend.gpBeta}`);
assert.equal(blend.pairs, 4000);

// A market that is pure noise gets ~0; one that is better than the truth's
// proxy cannot exceed 1.
const noise = fitMarketBlend(
  samples.map((s) => ({ ...s, market: line(Math.abs(gauss()), 60 + 20 * gauss()) })),
  "noise",
  [],
);
for (const t of MARKET_BLEND_STATS) assert.ok(noise.betas[t] < 0.05, `noise ${t} ${noise.betas[t]}`);
const over = fitMarketBlend(
  samples.map((s) => ({ ...s, actual: { rates: s.market.rates, gp: 2 * s.market.gp - s.stack.gp } })),
  "over",
  [],
);
assert.equal(over.gpBeta, 1);

// Application: moves each stat by beta x gap; no market line, no change.
const rates = { goals: 0.4, assists: 0.5, shots: 3, blocks: 0.5, hits: 1, powerplayPoints: 0.2, penaltyMinutes: 0.3, faceoffWins: 7 };
const out = applyMarketBlend(blend, line(0.6, 50), rates, 74);
assert.ok(Math.abs(out.rates.goals - (0.4 + blend.betas.goals * 0.2)) < 1e-12);
assert.equal(out.rates.faceoffWins, 7, "faceoffs are not blended (ESPN does not project them)");
assert.ok(Math.abs(out.gp - (74 + blend.gpBeta * (50 - 74))) < 1e-12);
assert.deepEqual(applyMarketBlend(blend, undefined, rates, 74), { rates, gp: 74 });
assert.deepEqual(applyMarketBlend(undefined, line(0.6, 50), rates, 74), { rates, gp: 74 });

// Market lines: per-game rates, 56-game 2020-21 put on 82 games.
const file: MarketFileShape = {
  builtAt: "",
  source: "test",
  seasons: {
    "20202021": { skaters: [{ id: 1, gp: 56, goals: 28, assists: 28, shots: 112, hits: 56, blocks: 28, powerplayPoints: 14, penaltyMinutes: 0 }] },
    "20242025": { skaters: [{ id: 2, gp: 82, goals: 41, assists: 41, shots: 164, hits: 82, blocks: 41, powerplayPoints: 20.5, penaltyMinutes: 0 }] },
  },
};
const short = marketLinesFor(file, 20202021).get(1)!;
assert.equal(short.gp, 82);
assert.equal(short.rates.goals, 0.5);
assert.equal(marketLinesFor(file, 20242025).get(2)!.gp, 82);
assert.equal(marketLinesFor(file, 20232024).size, 0);
assert.equal(marketLinesFor(null, 20242025).size, 0);

// An unpublished stat (null) is NaN: the stack keeps its own rate, and the fit skips it.
const unpublished: MarketFileShape = {
  builtAt: "",
  source: "test",
  seasons: {
    "20182019": { skaters: [{ id: 3, gp: 80, goals: 20, assists: 40, shots: 200, hits: null, blocks: null, powerplayPoints: 16, penaltyMinutes: 20 }] },
  },
};
const u = marketLinesFor(unpublished, 20182019).get(3)!;
assert.ok(Number.isNaN(u.rates.hits) && Number.isNaN(u.rates.blocks));
assert.equal(u.rates.goals, 0.25);
const kept = applyMarketBlend({ ...blend, betas: { ...blend.betas, hits: 1, blocks: 1 } }, u, rates, 74);
assert.equal(kept.rates.hits, rates.hits, "an unpublished market stat leaves the stack's rate");
assert.equal(kept.rates.blocks, rates.blocks);
const nanFit = fitMarketBlend(
  samples.map((s) => ({ ...s, market: { ...s.market, rates: { ...s.market.rates, hits: NaN } } })),
  "nan",
  [],
);
assert.equal(nanFit.betas.hits, 0, "no published market hits: no weight");
assert.ok(Math.abs(nanFit.betas.goals - blend.betas.goals) < 1e-12, "other stats fit as before");

// A longer schedule (2026-27: 84 games) is put on the 82-game basis.
assert.equal(marketScheduleGames(20262027, 84), 84);
assert.equal(marketScheduleGames(20242025, 82), 82);
assert.equal(marketScheduleGames(20202021, 56), 56);
const long: MarketFileShape = {
  builtAt: "",
  source: "test",
  seasons: {
    "20262027": {
      skaters: [
        { id: 4, gp: 84, goals: 42, assists: 42, shots: 168, hits: 84, blocks: 42, powerplayPoints: 21, penaltyMinutes: 0 },
        { id: 5, gp: 76, goals: 38, assists: 38, shots: 152, hits: 76, blocks: 38, powerplayPoints: 19, penaltyMinutes: 0 },
      ],
    },
  },
};
assert.equal(marketLinesFor(long, 20262027).get(4)!.gp, 82);
assert.ok(Math.abs(marketLinesFor(long, 20262027).get(5)!.gp - (76 * 82) / 84) < 1e-9);
assert.equal(marketLinesFor(long, 20262027).get(5)!.rates.goals, 0.5, "rates stay per game");

// Zero-filled stats (a stat stored as 0 for every player) are detected.
const zeroed: MarketFileShape = {
  builtAt: "",
  source: "test",
  seasons: {
    "20172018": {
      skaters: Array.from({ length: 30 }, (_, i) => ({
        id: i, gp: 80, goals: 10, assists: 10, shots: 100, hits: 0, blocks: i === 0 ? 5 : 0, powerplayPoints: i % 2, penaltyMinutes: 10,
      })),
    },
  },
};
assert.deepEqual(
  zeroFilledMarketStats(zeroed).map((z) => z.stat),
  ["blocks", "hits"],
);
assert.deepEqual(zeroFilledMarketStats(unpublished), []);
assert.deepEqual(unpublishedStats([{ "31": 0, "13": 5 }, { "13": 4 }, { "13": 2, "31": 3 }], [13, 31]), [31]);

console.log("PASS: market blend (fit, clip, apply, 82-game lines, unpublished stats, 84-game schedule)");
