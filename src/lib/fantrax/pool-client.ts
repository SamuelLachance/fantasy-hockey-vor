/**
 * The player table's data for one Fantrax points league: the whole league pool
 * (`<public>/pool.json`, prospects included) and the dynasty values
 * (`public/fantrax/dynasty.json`, rebuilt by every Captains sync). Fetched on
 * demand, once per page view, and kept across tab changes. Apart from
 * `league-client.ts` so the tabs' table code does not carry the live Fantrax
 * reads.
 *
 * The pool cache is keyed by league: both Fantrax leagues can be visited in
 * one single-page session, and one league's pool under the other's name would
 * put players nobody in that league can draft on its board.
 */
import { fantraxDataHref } from "@/lib/site";
import { CAPTAINS_DYNASTY, fantraxPublicFile, type FantraxLeagueConfig } from "./config";
import { parseDynasty, type DynastyIndex } from "./dynasty-index";
import { isPoolSnapshot, type PoolSnapshot } from "./pool";
import { fetchOptionalJson, fetchSnapshotFile } from "./snapshot-fetch";

const poolPromises = new Map<string, Promise<PoolSnapshot>>();
const poolValues = new Map<string, PoolSnapshot>();
const dynastyPromises = new Map<string, Promise<DynastyIndex | null>>();
/** Per league: absent until the dynasty read settles (null: unreadable). */
const dynastyValues = new Map<string, DynastyIndex | null>();

/**
 * The player table's pool (required; retried like the snapshot). Fetched
 * once per page view, on demand, and kept across tab changes.
 */
export function loadFantraxPool(cfg: FantraxLeagueConfig = CAPTAINS_DYNASTY): Promise<PoolSnapshot> {
  const cached = poolPromises.get(cfg.slug);
  if (cached) return cached;
  const p = fetchSnapshotFile<unknown>(fantraxPublicFile(cfg, "pool.json"))
    .then((pool) => {
      if (!isPoolSnapshot(pool)) throw new Error("pool.json is malformed");
      poolValues.set(cfg.slug, pool);
      return pool;
    })
    .catch((err) => {
      if (poolPromises.get(cfg.slug) === p) poolPromises.delete(cfg.slug);
      throw err;
    });
  poolPromises.set(cfg.slug, p);
  return p;
}

/** The pool when this page view already loaded it (a tab change paints at once). */
export function peekFantraxPool(cfg: FantraxLeagueConfig = CAPTAINS_DYNASTY): PoolSnapshot | null {
  return poolValues.get(cfg.slug) ?? null;
}

/**
 * Dynasty values: the browser's copy (`fantrax/dynasty-table.json`, the
 * same players without the report-only fields, written before every site
 * build), else `fantrax/dynasty.json` itself (a dev server before any
 * build). Only called when the build saw dynasty.json; never rejects
 * (unreadable = null).
 */
export function loadDynasty(cfg: FantraxLeagueConfig = CAPTAINS_DYNASTY): Promise<DynastyIndex | null> {
  const cached = dynastyPromises.get(cfg.slug);
  if (cached) return cached;
  // The league's own copy (Captains at the root of fantrax/, the others under their slug).
  const p = fetchOptionalJson(fantraxDataHref(fantraxPublicFile(cfg, "dynasty-table.json")))
    .then((slim) => slim ?? fetchOptionalJson(fantraxDataHref(fantraxPublicFile(cfg, "dynasty.json"))))
    .then(parseDynasty, () => null)
    .then((d) => {
      dynastyValues.set(cfg.slug, d);
      return d;
    });
  dynastyPromises.set(cfg.slug, p);
  return p;
}

/** The dynasty read when this page view already settled it (a tab change paints at once). */
export function peekDynasty(cfg: FantraxLeagueConfig = CAPTAINS_DYNASTY): { value: DynastyIndex | null; settled: boolean } {
  return { value: dynastyValues.get(cfg.slug) ?? null, settled: dynastyValues.has(cfg.slug) };
}
