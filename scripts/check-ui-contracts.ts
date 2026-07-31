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
    "usePlayerDetails",
    "resetSortToVor",
    "sticky left-10",
    "truncate",
    "Reset board view",
    "useRankingsUrlSync",
    "ExpandedPlayerPanel",
    'e.key === "/"',
    'column="sigma"',
  ],
  "src/components/ExpandedPlayerPanel.tsx": [
    "Copy player link",
    "detailStatSigma",
    "Loading player notes",
  ],
  "src/components/RankingsToolbar.tsx": ["CSV", "Link", "Starters"],
  "src/hooks/useRankingsUrlSync.ts": ["router.replace", "rankingsUrlSearch"],
  "src/hooks/usePlayerDetails.ts": ["requestIdleCallback", "fetchPlayerDetails"],
  "src/lib/rankings-url.ts": ["hideDepthGoalies", "playerId"],
  "src/lib/seo-jsonld.ts": ["WebApplication", "Dataset"],
  "src/lib/publish-players.ts": ["perStatSigma", "compactBoardNumbers"],
  "src/lib/vor.ts": ["softCapCategoryZ", "PERIPHERAL"],
  "src/components/TopPlayers.tsx": [
    "gamesPlayed > 8",
    "playerHref",
    "gamesPlayed}gp",
  ],
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
