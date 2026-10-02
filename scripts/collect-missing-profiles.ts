/**
 * Top up src/data/player-profiles.json with every player on an NHL club's
 * roster today (src/data/nhl-rosters.json, list "roster") who has no
 * dossier: rookies and call-ups the full collection (`npm run collect`,
 * built from past seasons' stats) cannot know about, so that the
 * pre-season projections cover 100 % of the rosters
 * (scripts/check-roster-coverage.ts).
 *
 * Public NHL landing only (one request per player, ≥ 1.1 s apart, through
 * fetchJson), no contract lookup. Run before `npm run generate`:
 *   npm run collect:missing
 */
import { readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { collectProfilesForPlayers } from "../src/lib/player-profile";
import type { PlayerProfile } from "../src/lib/profile-types";

const PROFILES = join(process.cwd(), "src", "data", "player-profiles.json");
const ROSTERS = join(process.cwd(), "src", "data", "nhl-rosters.json");

interface ProfilesFile {
  collectedAt: string;
  count: number;
  profiles: PlayerProfile[];
  toppedUp?: { at: string; rostersFetchedAt: string; ids: number[] };
}

async function main() {
  const file = JSON.parse(readFileSync(PROFILES, "utf8")) as ProfilesFile;
  const rosters = JSON.parse(readFileSync(ROSTERS, "utf8")) as {
    fetchedAt: string;
    players: Array<{ id: number; name: string; team: string; code: string; list: string }>;
  };
  const have = new Set(file.profiles.map((p) => p.id));
  const missing = rosters.players.filter((p) => p.list === "roster" && !have.has(p.id));
  if (missing.length === 0) {
    console.log("OK: every roster player already has a dossier");
    return;
  }
  console.log(`Collecting ${missing.length} missing roster dossier(s)...`);
  const added = await collectProfilesForPlayers(missing, (d, t) => {
    if (d % 10 === 0 || d === t) console.log(`  ${d}/${t}`);
  });
  const profiles = [...file.profiles, ...added].sort((a, b) => a.name.localeCompare(b.name));
  const out: ProfilesFile = {
    ...file,
    count: profiles.length,
    profiles,
    toppedUp: {
      at: new Date().toISOString(),
      rostersFetchedAt: rosters.fetchedAt,
      ids: [...new Set([...(file.toppedUp?.ids ?? []), ...added.map((p) => p.id)])].sort((a, b) => a - b),
    },
  };
  writeFileAtomic(PROFILES, JSON.stringify(out, null, 2));
  console.log(`Added ${added.length} dossier(s): ${added.map((p) => `${p.name} (${p.team})`).join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
