import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { buildDraftRegistry } from "../src/lib/draft-registry";

const OUT_PATH = join(process.cwd(), "src", "data", "draft-registry.json");

async function main() {
  console.log("Building NHL entry draft registry (1979–present, all rounds)...");
  const registry = await buildDraftRegistry(console.log);
  writeFileAtomic(OUT_PATH, JSON.stringify(registry, null, 2));
  console.log(
    `Wrote ${Object.keys(registry.byName).length} unique drafted players to ${OUT_PATH}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
