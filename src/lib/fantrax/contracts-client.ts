/**
 * A salary-cap league's contracts.json in the browser (Slapshot). Read by
 * `CapLeagueShell` only — that league's own shell chunk — so the Captains tabs
 * never ship it. Keyed by the league's config, like every cache of
 * league-client.ts.
 */
import { fantraxPublicFile, type FantraxLeagueConfig } from "./config";
import type { ContractsFile } from "./salary-cap";
import { fetchSnapshotFile } from "./snapshot-fetch";

/** A contracts.json the site can read (the cap per season, the players' contracts). */
export function isContractsFile(x: unknown): x is ContractsFile {
  if (!x || typeof x !== "object") return false;
  const f = x as Partial<ContractsFile>;
  return (
    typeof f.firstSeason === "number" &&
    Array.isArray(f.cap) &&
    f.cap.length > 0 &&
    f.cap.every((v) => typeof v === "number" && Number.isFinite(v)) &&
    !!f.players &&
    typeof f.players === "object"
  );
}

const contractsPromises = new Map<string, Promise<ContractsFile | null>>();

/**
 * The league's contracts.json, once per page view (8 s timeout, one retry);
 * null for a league without a cap. Rejects when unreadable or malformed, so
 * the page can say that the salaries are unavailable instead of loading
 * forever; a later call retries.
 */
export function loadContracts(cfg: FantraxLeagueConfig): Promise<ContractsFile | null> {
  if (!cfg.salaryCap) return Promise.resolve(null);
  const cached = contractsPromises.get(cfg.slug);
  if (cached) return cached;
  const p = fetchSnapshotFile<unknown>(fantraxPublicFile(cfg, "contracts.json"))
    .then((c) => {
      if (!isContractsFile(c)) throw new Error("contracts.json is malformed");
      return c;
    })
    .catch((err: unknown) => {
      if (contractsPromises.get(cfg.slug) === p) contractsPromises.delete(cfg.slug);
      throw err;
    });
  contractsPromises.set(cfg.slug, p);
  return p;
}
