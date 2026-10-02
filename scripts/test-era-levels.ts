/**
 * Era levels by position group (src/lib/ml/dataset-view.ts): defensemen's
 * hits follow their own league level, the other stats the pooled one.
 * Walk-forward 2021-26: defensemen's hits bias +7.3 -> +4.4 per 82, hits
 * wMAE 23.69 -> 23.59, the other stats unchanged.
 * Run: npx tsx scripts/test-era-levels.ts
 */
import { buildTargetLevels, eraFactor, levelsFor, POSITION_LEVEL_TARGETS } from "../src/lib/ml/dataset-view";
import type { PlayerSeasonRow } from "../src/lib/ml/types";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failed++;
    console.error(`FAIL: ${name}${detail ? ` (${detail})` : ""}`);
  }
}

const row = (seasonId: number, position: string, hits: number, shots: number): PlayerSeasonRow =>
  ({ playerId: seasonId + hits, seasonId, position, isGoalie: false, gamesPlayed: 82, hits, shots }) as unknown as PlayerSeasonRow;
// Defensemen's hits fall 110 → 80 while forwards' stay at 100.
const rows: PlayerSeasonRow[] = [];
const dHits: Record<number, number> = { 20222023: 110, 20232024: 100, 20242025: 90, 20252026: 80 };
for (const s of [20222023, 20232024, 20242025, 20252026]) {
  rows.push(row(s, "D", dHits[s]!, 100), row(s, "C", 100, 150), row(s, "LW", 100, 150));
}
const levels = buildTargetLevels(rows, ["hits", "shots"], false, 10);
check("hits is a position-level target", (POSITION_LEVEL_TARGETS as readonly string[]).includes("hits"));
check("hits@D level", Math.abs((levels["hits@D"]?.[20252026] ?? 0) - 80 / 82) < 1e-9);
check("hits@F level", Math.abs((levels["hits@F"]?.[20252026] ?? 0) - 100 / 82) < 1e-9);
check("no shots@D (pooled)", levels["shots@D"] === undefined);
check("levelsFor D hits → D level", levelsFor(levels, "hits", "D") === levels["hits@D"]);
check("levelsFor RW hits → F level", levelsFor(levels, "hits", "RW") === levels["hits@F"]);
check("levelsFor shots → pooled", levelsFor(levels, "shots", "D") === levels.shots);
const history = [20232024, 20242025, 20252026].map((s) => row(s, "D", dHits[s]!, 100));
const dEra = eraFactor(levelsFor(levels, "hits", "D"), history, 20262027);
const pooledEra = eraFactor(levels.hits, history, 20262027);
check("a defenseman's hits era follows the D decline", dEra < pooledEra && dEra < 0.95, `${dEra.toFixed(3)} vs pooled ${pooledEra.toFixed(3)}`);

if (failed > 0) {
  console.error(`${failed} era-level check(s) failed`);
  process.exit(1);
}
console.log("OK: era levels by position group");
