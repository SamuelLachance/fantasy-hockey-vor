import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { buildDraftRegistry } from "../src/lib/draft-registry";

const OUT_PATH = join(process.cwd(), "src", "data", "draft-registry.json");

async function main() {
  console.log("Building NHL entry draft registry (1979–present, all rounds)...");
  const registry = await buildDraftRegistry(console.log);
  mkdirSync(join(process.cwd(), "src", "data"), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(registry, null, 2));
  console.log(
    `Wrote ${Object.keys(registry.byName).length} unique drafted players to ${OUT_PATH}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
