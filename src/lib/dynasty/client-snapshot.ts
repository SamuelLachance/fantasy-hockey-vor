/**
 * The browser's copy of dynasty.json (`public/fantrax/dynasty-table.json`,
 * derived at every dynasty build and before every site build, not
 * committed): the same players and zero-value ids without the fields only
 * the reports and checks read (eFP, p50G, dvModel, nhlId, effAge, seg,
 * traj, the market's model rank, growth.base, params, diag), about 30 %
 * lighter gzipped. Pure.
 */
import type { DynastyRecord, DynastySnapshot } from "./types";

/** File name next to dynasty.json (the Captains tabs fetch it first). */
export const CLIENT_DYNASTY_FILE = "dynasty-table.json";

/** Record fields the browser never reads. */
const REPORT_ONLY = ["eFP", "p50G", "dvModel", "nhlId", "effAge", "seg", "traj"] as const;

export interface ClientDynastySnapshot {
  builtAt: string;
  season: DynastySnapshot["season"];
  version: 1;
  inputs: { stateFetchedAt: string };
  players: Record<string, DynastyRecord>;
  zero: string[];
}

function clientRecord(r: DynastyRecord): DynastyRecord {
  const out: Record<string, unknown> = { ...r };
  for (const k of REPORT_ONLY) delete out[k];
  const { dvMkt: _dvMkt, rank: _rank, ...market } = r.market;
  out.market = market;
  if (r.growth) {
    const { base: _base, ...growth } = r.growth;
    out.growth = growth;
  }
  return out as unknown as DynastyRecord;
}

export function clientDynastySnapshot(full: DynastySnapshot): ClientDynastySnapshot {
  const players: Record<string, DynastyRecord> = {};
  for (const [id, r] of Object.entries(full.players)) players[id] = clientRecord(r);
  return {
    builtAt: full.builtAt,
    season: full.season,
    version: full.version,
    inputs: { stateFetchedAt: full.inputs.stateFetchedAt },
    players,
    zero: full.zero,
  };
}
