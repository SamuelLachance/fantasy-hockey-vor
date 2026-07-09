import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { applyMoneyPuckSkaterFields, loadMoneyPuckSkaterRegistrySync } from "../src/lib/moneypuck-skaters";
import type { MlDataset } from "../src/lib/ml/types";

const DATA_PATH = join(process.cwd(), "src", "data", "ml", "dataset.json");

async function main() {
  if (!existsSync(DATA_PATH)) {
    console.error("ML dataset not found. Run: npm run ml:dataset");
    process.exit(1);
  }

  const mpRegistry = loadMoneyPuckSkaterRegistrySync();
  if (!mpRegistry) {
    console.error("MoneyPuck skater registry not found. Run: npm run moneypuck:skaters");
    process.exit(1);
  }

  const dataset = JSON.parse(readFileSync(DATA_PATH, "utf8")) as MlDataset;
  let matched = 0;
  dataset.rows = dataset.rows.map((row) => {
    const enriched = applyMoneyPuckSkaterFields(row, mpRegistry);
    if (!row.isGoalie && enriched.xGoals !== undefined) matched++;
    return enriched;
  });
  dataset.builtAt = new Date().toISOString();
  writeFileAtomic(DATA_PATH, JSON.stringify(dataset));
  console.log(
    `Applied MoneyPuck skater stats to ${matched} skater player-seasons (${dataset.rows.length} total rows).`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
