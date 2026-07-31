/**
 * List players without Yahoo position eligibility (mostly farm/prospects).
 * Run: npx tsx scripts/report-yahoo-gaps.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import type { ProjectionsDataset } from "../src/lib/types";

const data = JSON.parse(
  readFileSync(join(process.cwd(), "src", "data", "players.json"), "utf8"),
) as ProjectionsDataset;

const gaps = data.players
  .filter((p) => p.positionSource !== "yahoo")
  .sort((a, b) => a.rank - b.rank);

const coverage =
  ((data.players.length - gaps.length) / Math.max(1, data.players.length)) *
  100;

console.log(
  `Yahoo coverage: ${data.players.length - gaps.length}/${data.players.length} (${coverage.toFixed(1)}%)`,
);
console.log(`Unmatched: ${gaps.length} (showing top 40 by rank)\n`);
for (const p of gaps.slice(0, 40)) {
  console.log(
    `#${p.rank}\t${p.name}\t${p.team}\t${p.positions.join("/")}\t${p.positionSource ?? "none"}`,
  );
}
