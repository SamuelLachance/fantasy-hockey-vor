/**
 * Writes the browser's copies of a league's dynasty values next to its
 * dynasty.json (not committed): `dynasty-table.json` for every profile
 * (`clientDynastySnapshot` drops the fields only the reports and checks
 * read), and for the Slapshot profile also `contracts.json` (the league cap
 * per season and every player's cap hits, `src/lib/dynasty/slapshot-client.ts`)
 * and `cap-plan.json` (the league-contract planner's inputs, read by the
 * « Plafond » tab only).
 * Called at the end of every dynasty build and before every site build
 * (`npm run build:pages`), so the copies never lag the committed file;
 * without dynasty.json, stale copies are removed.
 */
import { existsSync, readFileSync, rmSync } from "fs";
import { dirname, join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { CLIENT_DYNASTY_FILE, clientDynastySnapshot } from "../src/lib/dynasty/client-snapshot";
import { CAP_PLAN_FILE, slapshotCapPlan, slapshotClientSnapshot, slapshotContracts, type SlapshotSnapshotLike } from "../src/lib/dynasty/slapshot-client";
import type { DynastySnapshot } from "../src/lib/dynasty/types";

export const DYNASTY_FULL = join(process.cwd(), "public", "fantrax", "dynasty.json");
/** The Slapshot profile's cap and contracts, next to its dynasty.json. */
export const CONTRACTS_FILE = "contracts.json";

type AnySnapshot = DynastySnapshot | SlapshotSnapshotLike;
const isSlapshot = (s: AnySnapshot): s is SlapshotSnapshotLike => "league" in s && !!(s as SlapshotSnapshotLike).params?.cap;

/** Writes the copies next to `full`; returns the table copy's path, or null when there is no dynasty.json. */
export function writeClientDynasty(full: string = DYNASTY_FULL): string | null {
  const dir = dirname(full);
  const out = join(dir, CLIENT_DYNASTY_FILE);
  const contracts = join(dir, CONTRACTS_FILE);
  const capPlan = join(dir, CAP_PLAN_FILE);
  if (!existsSync(full)) {
    rmSync(out, { force: true });
    rmSync(contracts, { force: true });
    rmSync(capPlan, { force: true });
    return null;
  }
  const snapshot = JSON.parse(readFileSync(full, "utf8")) as AnySnapshot;
  if (isSlapshot(snapshot)) {
    const first = Number(snapshot.season.slice(0, 4));
    writeFileAtomic(out, `${JSON.stringify(slapshotClientSnapshot(snapshot))}\n`);
    writeFileAtomic(contracts, `${JSON.stringify(slapshotContracts(snapshot, first, snapshot.params.cap.announced ?? [first]))}\n`);
    const plan = slapshotCapPlan(snapshot, first);
    if (plan) writeFileAtomic(capPlan, `${JSON.stringify(plan)}\n`);
    else rmSync(capPlan, { force: true });
  } else {
    writeFileAtomic(out, `${JSON.stringify(clientDynastySnapshot(snapshot))}\n`);
    rmSync(contracts, { force: true });
    rmSync(capPlan, { force: true });
  }
  return out;
}
