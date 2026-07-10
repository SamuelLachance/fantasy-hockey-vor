import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { buildMoneyPuckGoalieRegistry } from "../src/lib/moneypuck-goalies";

const OUT_PATH = join(process.cwd(), "src", "data", "moneypuck-goalies.json");

/** MoneyPuck season years with regular-season goalie CSVs (2007 = 2007–08). */
const MONEYPUCK_YEARS = Array.from({ length: 19 }, (_, i) => 2007 + i);

async function main() {
  console.log(
    `Building MoneyPuck goalie registry (${MONEYPUCK_YEARS[0]}–${MONEYPUCK_YEARS.at(-1)} seasons)...`,
  );
  const registry = await buildMoneyPuckGoalieRegistry(MONEYPUCK_YEARS, console.log);
  writeFileAtomic(OUT_PATH, JSON.stringify(registry, null, 2));
  console.log(
    `Wrote ${Object.keys(registry.byKey).length} player-season rows to ${OUT_PATH}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
