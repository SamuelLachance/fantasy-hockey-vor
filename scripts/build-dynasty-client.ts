/**
 * `npm run build:pages` step: the browser's copies of every Fantrax league's
 * dynasty values (`<public>/dynasty-table.json`, and for a salary-cap league
 * `<public>/contracts.json`) from its committed dynasty.json.
 * See scripts/dynasty-client.ts.
 */
import { statSync } from "fs";
import { FANTRAX_LEAGUES } from "../src/lib/fantrax/config";
import { writeClientDynasty } from "./dynasty-client";
import { fantraxPaths } from "./fantrax-paths";

for (const cfg of Object.values(FANTRAX_LEAGUES)) {
  if (!cfg.dynastyProfile) continue;
  const out = writeClientDynasty(fantraxPaths(cfg).dynasty);
  console.log(
    out
      ? `OK: ${cfg.slug} dynasty-table.json (${Math.round(statSync(out).size / 1024)} KB)`
      : `OK: ${cfg.slug} has no dynasty.json, no dynasty-table.json`,
  );
}
