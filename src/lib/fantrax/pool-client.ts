/**
 * The player table's data (Captains Dynasty): the whole league pool
 * (`public/fantrax/pool.json`, prospects included) and the dynasty values
 * (`public/fantrax/dynasty.json`, rebuilt by every league sync). Fetched on
 * demand, once per page view, and kept across tab changes. Apart from `league-client.ts` so the tabs'
 * table code does not carry the live Fantrax reads.
 */
import { fantraxDataHref } from "@/lib/site";
import { parseDynasty, type DynastyIndex } from "./dynasty-index";
import { isPoolSnapshot, type PoolSnapshot } from "./pool";
import { fetchOptionalJson, fetchSnapshotFile } from "./snapshot-fetch";

let poolPromise: Promise<PoolSnapshot> | null = null;
let poolValue: PoolSnapshot | null = null;
let dynastyPromise: Promise<DynastyIndex | null> | null = null;
/** undefined until the dynasty read settles (null: unreadable). */
let dynastyValue: DynastyIndex | null | undefined;

/**
 * The player table's pool (required; retried like the snapshot). Fetched
 * once per page view, on demand, and kept across tab changes.
 */
export function loadFantraxPool(): Promise<PoolSnapshot> {
  if (!poolPromise) {
    const p = fetchSnapshotFile<unknown>("pool.json")
      .then((pool) => {
        if (!isPoolSnapshot(pool)) throw new Error("pool.json is malformed");
        poolValue = pool;
        return pool;
      })
      .catch((err) => {
        if (poolPromise === p) poolPromise = null;
        throw err;
      });
    poolPromise = p;
  }
  return poolPromise;
}

/** The pool when this page view already loaded it (a tab change paints at once). */
export function peekFantraxPool(): PoolSnapshot | null {
  return poolValue;
}

/**
 * Dynasty values: the browser's copy (`fantrax/dynasty-table.json`, the
 * same players without the report-only fields, written before every site
 * build), else `fantrax/dynasty.json` itself (a dev server before any
 * build). Only called when the build saw dynasty.json; never rejects
 * (unreadable = null).
 */
export function loadDynasty(): Promise<DynastyIndex | null> {
  if (!dynastyPromise) {
    dynastyPromise = fetchOptionalJson(fantraxDataHref("dynasty-table.json"))
      .then((slim) => slim ?? fetchOptionalJson(fantraxDataHref("dynasty.json")))
      .then(parseDynasty, () => null)
      .then((d) => {
        dynastyValue = d;
        return d;
      });
  }
  return dynastyPromise;
}

/** The dynasty read when this page view already settled it (a tab change paints at once). */
export function peekDynasty(): { value: DynastyIndex | null; settled: boolean } {
  return { value: dynastyValue ?? null, settled: dynastyValue !== undefined };
}
