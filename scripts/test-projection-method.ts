/**
 * Unit checks for projection method labels.
 * Run: npx tsx scripts/test-projection-method.ts
 */
import {
  projectionMethodLabel,
  projectionMethodTone,
} from "../src/lib/projection-method";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(projectionMethodLabel("ai") === "AI projection", "ai label");
assert(projectionMethodLabel("ml") === "ML stacked ensemble", "ml label");
assert(
  projectionMethodLabel("contextual") === "Contextual model",
  "contextual label",
);
assert(projectionMethodLabel(undefined) === "Contextual model", "fallback");
assert(projectionMethodTone("ml").includes("emerald"), "ml tone");
assert(projectionMethodTone("ai").includes("violet"), "ai tone");

if (failed) process.exit(1);
console.log("OK: projection-method");
