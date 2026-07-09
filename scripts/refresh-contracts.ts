import { readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { ageFromBirthDate, parseBirthDate, seasonStartDate } from "../src/lib/age";
import { fetchContractByNhlId } from "../src/lib/contracts";
import { normalizeProfile } from "../src/lib/player-profile";
import type { PlayerProfile } from "../src/lib/profile-types";

const PROFILES = join(process.cwd(), "src", "data", "player-profiles.json");

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      await fn(items[i], i);
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

async function main() {
  const data = JSON.parse(readFileSync(PROFILES, "utf8")) as {
    profiles: PlayerProfile[];
  };

  const limit = process.env.PROFILE_LIMIT
    ? parseInt(process.env.PROFILE_LIMIT, 10)
    : data.profiles.length;

  const targets = data.profiles.slice(0, limit);
  console.log(`Refreshing contracts + age for ${targets.length} players...`);

  await mapWithConcurrency(targets, 4, async (profile, idx) => {
    const parts = profile.name.split(" ");
    const firstName = parts[0];
    const lastName = parts.slice(1).join(" ");

    const contract = await fetchContractByNhlId(profile.id, firstName, lastName);
    const birthDate =
      parseBirthDate(contract.birthDate ?? "") ??
      parseBirthDate(profile.bio.birthDate) ??
      profile.bio.birthDate;

    const seasonStart = seasonStartDate();
    profile.bio.birthDate = birthDate;
    profile.bio.age = ageFromBirthDate(birthDate);
    profile.bio.ageAtSeasonStart = ageFromBirthDate(birthDate, seasonStart);
    profile.contract = contract;

    if ((idx + 1) % 50 === 0) {
      console.log(`  ${idx + 1}/${targets.length}`);
    }
  });

  const normalized = data.profiles.map(normalizeProfile);
  writeFileAtomic(
    PROFILES,
    JSON.stringify(
      {
        collectedAt: new Date().toISOString(),
        count: normalized.length,
        profiles: normalized,
      },
      null,
      2,
    ),
  );
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
