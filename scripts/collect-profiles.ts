import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { collectAllProfiles } from "../src/lib/player-profile";

const OUT = join(process.cwd(), "src", "data", "player-profiles.json");

async function main() {
  const limit = process.env.PROFILE_LIMIT
    ? parseInt(process.env.PROFILE_LIMIT, 10)
    : undefined;
  console.log("Collecting comprehensive NHL player dossiers...");
  const profiles = await collectAllProfiles((d, t) => {
    if (d % 50 === 0 || d === t) {
      console.log(`  profiles ${d}/${t}`);
    }
  }, limit);

  writeFileAtomic(
    OUT,
    JSON.stringify(
      {
        collectedAt: new Date().toISOString(),
        count: profiles.length,
        profiles,
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${profiles.length} player profiles to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
