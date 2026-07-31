/**
 * Unit checks for expanded player meta chip copy.
 * Run: npx tsx scripts/test-expanded-meta-copy.ts
 */
import {
  confidenceChipCopy,
  marketEdgeChipCopy,
  shouldShowConfidenceChip,
  uncertaintyChipCopy,
  uncertaintyChipTitle,
} from "../src/lib/expanded-meta-copy";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(confidenceChipCopy(0.82) === "Confidence: 82%", "confidence");
assert(
  shouldShowConfidenceChip({ confidence: 0.8, hasUncertainty: true }) === false,
  "hide stub when uncertainty present",
);
assert(
  shouldShowConfidenceChip({ confidence: 0.55, hasUncertainty: false }) ===
    true,
  "show confidence without uncertainty",
);
assert(
  shouldShowConfidenceChip({ confidence: Number.NaN, hasUncertainty: false }) ===
    false,
  "reject NaN confidence",
);
assert(
  marketEdgeChipCopy({
    consensusRank: 10,
    modelRank: 3,
    draftValue: 7,
  }).includes("Edge"),
  "market edge",
);
assert(
  marketEdgeChipCopy({ consensusRank: 1, modelRank: 1 }).endsWith("model #1"),
  "no edge when null",
);
assert(uncertaintyChipTitle().includes("Aleatoric"), "title");
assert(
  uncertaintyChipCopy({
    gamesPlayedSigma: 4.2,
    totalSigma: 41.2,
    aleatoricShare: 0.55,
  }).includes("55% irreducible"),
  "uncertainty body",
);

if (failed) process.exit(1);
console.log("OK: expanded-meta-copy");
