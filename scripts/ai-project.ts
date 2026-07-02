import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { runAiProjections } from "../src/lib/ai-projections";
import type { PlayerProfile } from "../src/lib/profile-types";

const PROFILES = join(process.cwd(), "src", "data", "player-profiles.json");

async function main() {
  if (!existsSync(PROFILES)) {
    console.error("Run npm run collect first to build player profiles.");
    process.exit(1);
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error(
      "Set OPENAI_API_KEY in .env.local or environment to run AI projections.",
    );
    process.exit(1);
  }

  const { profiles } = JSON.parse(readFileSync(PROFILES, "utf8")) as {
    profiles: PlayerProfile[];
  };

  const limit = process.env.AI_LIMIT
    ? parseInt(process.env.AI_LIMIT, 10)
    : undefined;
  const force = process.env.AI_FORCE === "1";

  const cache = await runAiProjections(profiles, { limit, force });
  console.log(
    `AI cache: ${Object.keys(cache.skaters).length} skaters, ${Object.keys(cache.goalies).length} goalies`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
