/**
 * `npm run build:pages` step: public/fantrax/dynasty-table.json (the
 * browser's copy of dynasty.json) from the committed dynasty.json.
 * See scripts/dynasty-client.ts.
 */
import { statSync } from "fs";
import { writeClientDynasty } from "./dynasty-client";

const out = writeClientDynasty();
console.log(out ? `OK: dynasty-table.json (${Math.round(statSync(out).size / 1024)} KB)` : "OK: no dynasty.json, no dynasty-table.json");
