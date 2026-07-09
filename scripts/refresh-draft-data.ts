import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import {
  draftRecordToInfo,
  fetchPlayerLandingDraft,
  lookupDraftByName,
  type DraftRegistry,
} from "../src/lib/draft-registry";
import { buildContextNarrative } from "../src/lib/player-profile";
import type { PlayerProfile } from "../src/lib/profile-types";

const PROFILES_PATH = join(process.cwd(), "src", "data", "player-profiles.json");
const REGISTRY_PATH = join(process.cwd(), "src", "data", "draft-registry.json");

async function main() {
  if (!existsSync(PROFILES_PATH)) {
    console.error("Run npm run collect first");
    process.exit(1);
  }
  if (!existsSync(REGISTRY_PATH)) {
    console.error("Run npm run draft:registry first");
    process.exit(1);
  }

  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as DraftRegistry;
  const data = JSON.parse(readFileSync(PROFILES_PATH, "utf8")) as {
    collectedAt: string;
    profiles: PlayerProfile[];
  };

  let updated = 0;
  let fromLanding = 0;
  let fromRegistry = 0;

  for (let i = 0; i < data.profiles.length; i++) {
    const profile = data.profiles[i];
    const landingDraft = await fetchPlayerLandingDraft(profile.id);
    let draft = landingDraft;

    if (draft) {
      fromLanding++;
    } else {
      const record = lookupDraftByName(registry, profile.name);
      if (record) {
        draft = draftRecordToInfo(record);
        fromRegistry++;
      }
    }

    const changed =
      (draft?.overallPick ?? 0) !== (profile.draft?.overallPick ?? 0) ||
      (draft?.year ?? 0) !== (profile.draft?.year ?? 0);

    if (changed) {
      profile.draft = draft;
      profile.contextNarrative = buildContextNarrative(profile);
      updated++;
    }

    if (i > 0 && i % 50 === 0) {
      await new Promise((r) => setTimeout(r, 80));
    }
  }

  writeFileAtomic(PROFILES_PATH, JSON.stringify(data, null, 2));
  const withDraft = data.profiles.filter((p) => p.draft).length;
  console.log(
    `Draft refresh: ${updated} profiles updated (${fromLanding} landing, ${fromRegistry} registry)`,
  );
  console.log(`Coverage: ${withDraft}/${data.profiles.length} players with NHL entry draft position`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
