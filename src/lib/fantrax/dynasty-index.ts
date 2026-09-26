/**
 * Reader of `public/fantrax/dynasty.json` (`npm run league:sync` /
 * `dynasty:build`) for the Captains tabs: every player's dynasty value per
 * mode, rank, career phase, P10–P90 band, yearly trend, P(NHL), ETA, minors
 * eligibility, 2027 keeper outlook and market signals, keyed by Fantrax id
 * (schema: `src/lib/dynasty/types.ts`). The file is this repo's own output:
 * the reader checks the fields the tables read and drops malformed records.
 */
import { MODES, type DynastyRecord, type Phase } from "@/lib/dynasty/types";
import { KEEPER_ORDER, PHASE_ORDER } from "./dynasty-hints";

const KEEPER_STATUSES: readonly string[] = KEEPER_ORDER;

export interface DynastyIndex {
  byFantrax: Map<string, DynastyRecord>;
  /** Modeled players left out of the file (value 0 in every mode). */
  zero: Set<string>;
  builtAt: string;
  /** Phases the file uses, in career order. */
  phases: Phase[];
}

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => !!x && typeof x === "object" && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** The fields the tables read, with their types (the rest of a record is passed through). */
function usableRecord(r: unknown): r is DynastyRecord {
  if (!isObj(r) || typeof r.n !== "string") return false;
  const dv = r.dv;
  const rank = r.rank;
  if (!isObj(dv) || !isObj(rank) || !MODES.every((m) => finite(dv[m]) && finite(rank[m]))) return false;
  if (typeof r.phase !== "string" || !(PHASE_ORDER as readonly string[]).includes(r.phase)) return false;
  if (!Array.isArray(r.eG) || !r.eG.every(finite)) return false;
  const band = r.band;
  if (!isObj(band) || !Array.isArray(band.balanced) || !Array.isArray(band.longTerm)) return false;
  if (!finite(r.pNhl) || !finite(r.age)) return false;
  if (!isObj(r.elig) || typeof r.elig.now !== "boolean") return false;
  const k = r.keeper;
  if (!isObj(k) || !KEEPER_STATUSES.includes(String(k.status))) return false;
  if (k.team !== undefined && (!isObj(k.team) || !KEEPER_STATUSES.includes(String(k.team.status)))) return false;
  return isObj(r.market);
}

/**
 * Reads dynasty.json (`version: 1`, `players: { fantraxId: record }`,
 * `zero: [fantraxId]`). Null when the file is not a dynasty snapshot or
 * holds no usable record.
 */
export function parseDynasty(json: unknown): DynastyIndex | null {
  if (!isObj(json) || json.version !== 1 || !isObj(json.players)) return null;
  const byFantrax = new Map<string, DynastyRecord>();
  const seen = new Set<Phase>();
  for (const [id, rec] of Object.entries(json.players)) {
    if (!usableRecord(rec)) continue;
    byFantrax.set(id, rec);
    seen.add(rec.phase);
  }
  if (byFantrax.size === 0) return null;
  const zero = new Set(Array.isArray(json.zero) ? json.zero.filter((x): x is string => typeof x === "string") : []);
  return {
    byFantrax,
    zero,
    builtAt: typeof json.builtAt === "string" ? json.builtAt : "",
    phases: PHASE_ORDER.filter((p) => seen.has(p)),
  };
}
