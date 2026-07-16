/**
 * Sanity checks for synthetic-market training helpers.
 * Usage: npx tsx scripts/sanity-market-training.ts
 */
import {
  ADVERSARIAL_STRENGTH,
  DISAGREEMENT_SIGMA,
  MARKET_BLEND,
  disagreementWeight,
  kellyFantasyWeight,
  percentileRanks,
  perturbFeatureVector,
  sampleStd,
} from "../src/lib/ml/market-training";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(Math.abs(MARKET_BLEND.marcel + MARKET_BLEND.ewma + MARKET_BLEND.lag1 - 1) < 1e-9, "blend sums to 1");
assert(disagreementWeight(0.3, 0.3, 0.1) === 0.25, "agreement → 0.25");
assert(disagreementWeight(0.3, 0.5, 0.1) > 1, "large edge → >1");
assert(kellyFantasyWeight(0.2, 0.8, true) > kellyFantasyWeight(0.2, 0.8, false), "aligned Kelly > misaligned");

const ranks = percentileRanks([1, 3, 2]);
assert(ranks[0] === 0 && ranks[1] === 1 && ranks[2] === 0.5, `ranks=${ranks}`);

let s = 42;
const rng = () => {
  s = (s * 1664525 + 1013904223) >>> 0;
  return (s % 1_000_000) / 1_000_000;
};
const vec = [10, 0, 5];
const names = ["age", "pos_C", "team_elo"];
const pert = perturbFeatureVector(vec, names, ADVERSARIAL_STRENGTH, rng);
assert(pert[1] === 0, "pos_C not perturbed");
assert(pert[0] !== 10 || pert[2] !== 5, "at least one whitelisted changed");

assert(sampleStd([1, 2, 3]) > 0, "std positive");
assert(DISAGREEMENT_SIGMA === 0.15, "sigma constant");

console.log("OK: market-training sanity checks passed");
