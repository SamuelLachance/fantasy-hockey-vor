/**
 * Writes the browser's copy of the dynasty values
 * (public/fantrax/dynasty-table.json, not committed) from
 * public/fantrax/dynasty.json: `clientDynastySnapshot` drops the fields
 * only the reports and checks read. Called at the end of every dynasty
 * build and before every site build (`npm run build:pages`), so the copy
 * never lags the committed file; without dynasty.json, a stale copy is
 * removed.
 */
import { existsSync, readFileSync, rmSync } from "fs";
import { dirname, join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { CLIENT_DYNASTY_FILE, clientDynastySnapshot } from "../src/lib/dynasty/client-snapshot";
import type { DynastySnapshot } from "../src/lib/dynasty/types";

export const DYNASTY_FULL = join(process.cwd(), "public", "fantrax", "dynasty.json");

/** Writes the copy next to `full`; returns its path, or null when there is no dynasty.json. */
export function writeClientDynasty(full: string = DYNASTY_FULL): string | null {
  const out = join(dirname(full), CLIENT_DYNASTY_FILE);
  if (!existsSync(full)) {
    rmSync(out, { force: true });
    return null;
  }
  const snapshot = JSON.parse(readFileSync(full, "utf8")) as DynastySnapshot;
  writeFileAtomic(out, `${JSON.stringify(clientDynastySnapshot(snapshot))}\n`);
  return out;
}
