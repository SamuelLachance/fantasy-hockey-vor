/**
 * Lightweight UI contract checks (no browser). Fails if critical board hooks vanish.
 * Run: npx tsx scripts/check-ui-contracts.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

const root = process.cwd();
const files: Record<string, string[]> = {
  "src/components/RankingsTable.tsx": [
    'id="rankings"',
    "hideDepthGoalies",
    "fetchPlayerDetails",
    "resetSortToVor",
  ],
  "src/components/RankingsToolbar.tsx": ["CSV", "Link", "Starters"],
  "src/lib/rankings-url.ts": ["hideDepthGoalies", "playerId"],
  "src/lib/publish-players.ts": ["perStatSigma", "compactBoardNumbers"],
  "src/lib/vor.ts": ["softCapCategoryZ", "PERIPHERAL"],
};

let failed = 0;
for (const [rel, needles] of Object.entries(files)) {
  const text = readFileSync(join(root, rel), "utf8");
  for (const n of needles) {
    if (!text.includes(n)) {
      console.error(`FAIL: ${rel} missing ${JSON.stringify(n)}`);
      failed++;
    }
  }
}

if (failed) process.exit(1);
console.log("OK: ui-contracts");
