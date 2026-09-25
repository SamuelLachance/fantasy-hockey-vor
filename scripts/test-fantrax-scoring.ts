/**
 * Unit checks for the Fantrax scoring table (slot-based scoring, captain
 * multiplier, Default fallback for a D in the Skt slot).
 * Run: npx tsx scripts/test-fantrax-scoring.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import type { FxeaScoringGroup } from "../src/lib/fantrax/api-types";
import {
  categoryPoints,
  goaliePoints,
  parseScoringTable,
  scoringShape,
  skaterComponents,
  skaterSlotPoints,
  skaterSlotValue,
  type SkaterRates,
} from "../src/lib/fantrax/scoring";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "scripts", "fixtures", "fantrax-scoring.json"), "utf8"),
) as { scoringCategorySettings: FxeaScoringGroup[] };
const table = parseScoringTable(fixture.scoringCategorySettings);

// Skt = 1.5 × Default on every offensive category.
for (const cat of ["G", "A1", "A2", "SOG", "Hit", "OTP", "HT"]) {
  const d = categoryPoints(table.skater, cat, "Default");
  const skt = categoryPoints(table.skater, cat, "Skt");
  assert(d > 0, `${cat} Default > 0`);
  assert(near(skt, 1.5 * d), `${cat} Skt ${skt} = 1.5 × ${d}`);
  // C / W / F slots have no rows: they fall back to Default.
  assert(near(categoryPoints(table.skater, cat, "W"), d), `${cat} W slot = Default`);
}

// Blk / Tk / skater SHO: 0 everywhere but the D slot — including Skt.
const dValues: Record<string, number> = { Blk: 0.3, Tk: 0.35, SHO: 2 };
for (const [cat, pts] of Object.entries(dValues)) {
  assert(categoryPoints(table.skater, cat, "Skt") === 0, `${cat} in Skt = 0`);
  assert(categoryPoints(table.skater, cat, "C") === 0, `${cat} in C = 0`);
  assert(near(categoryPoints(table.skater, cat, "D"), pts), `${cat} in D = ${pts}`);
}

// Goalie table is separate (G and SHO exist in both groups).
assert(categoryPoints(table.goalie, "SHO", "Default") === 3, "goalie SHO 3");
assert(categoryPoints(table.goalie, "GA", "Default") === -1.5, "goalie GA -1.5");
assert(categoryPoints(table.goalie, "OL+ShL", "Default") === 1, "goalie OTL +1");
assert(categoryPoints(table.goalie, "OSW", "Default") === -1, "goalie OSW -1");

const shape = scoringShape(table);
assert(near(shape.sktMultiplier, 1.5) && shape.uniformSkt, "uniform 1.5× captain multiplier");
assert(JSON.stringify(shape.overrideSlots) === JSON.stringify(["D", "Skt"]), "only D and Skt override slots");

// MacKinnon 2025-26 as Fantrax displays it (default position C): 477.6.
// His 25 takeaways and 7 skater shutouts score 0 because he is not in a D slot.
const mackinnon: SkaterRates = { g: 53, a1: 50, a2: 24, sog: 350, hit: 64, otp: 2, ht: 0, blk: 30, tk: 25, sho: 7 };
assert(near(skaterSlotPoints(table, mackinnon, "C"), 477.6, 1e-6), "MacKinnon 2025-26 = 477.6");
assert(
  near(skaterSlotPoints(table, mackinnon, "Skt"), 477.6 * 1.5, 1e-6),
  "MacKinnon in Skt = 1.5 × (no Blk/Tk/SHO either way)",
);

// A D in Skt loses his D-only categories under the default fallback…
const dman: SkaterRates = { g: 10, a1: 20, a2: 20, sog: 150, hit: 100, otp: 1, ht: 0, blk: 120, tk: 30, sho: 4 };
const { off, dx } = skaterComponents(table, dman);
assert(near(dx, 0.3 * 120 + 0.35 * 30 + 2 * 4, 1e-9), "dx = Blk/Tk/SHO at D values");
assert(near(skaterSlotPoints(table, dman, "D"), off + dx, 1e-9), "D slot = off + dx");
assert(near(skaterSlotPoints(table, dman, "Skt", { isD: true }), 1.5 * off, 1e-9), "D in Skt = 1.5 × off only");
assert(near(skaterSlotValue(off, dx, "Skt", 1.5, { isD: true }), 1.5 * off, 1e-9), "slot value agrees");
// …and keeps them (unmultiplied) under the "d" reading.
assert(
  near(skaterSlotPoints(table, dman, "Skt", { isD: true, dInSkt: "d" }), 1.5 * off + dx, 1e-9),
  "dInSkt=d keeps D values",
);
assert(near(skaterSlotValue(off, dx, "W", 1.5), off, 1e-9), "W slot = off");

// Vasilevskiy-like per-start line: W 3, GA −1.5, SV 0.27, SO 3, OTL 1, OSW −1, A 2.
const g = goaliePoints(table, { w: 1, ga: 2, sv: 25, so: 0, otl: 0, osw: 0, a: 0, g: 0 });
assert(near(g, 3 - 3 + 6.75), `goalie line = ${g}`);

if (failed) process.exit(1);
console.log("OK: fantrax scoring");
