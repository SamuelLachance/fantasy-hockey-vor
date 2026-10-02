/**
 * Calibration replay of the draft helper's availability on a league's real
 * draft: after a team's pick, `draftOutlook` gives every pool player's
 * probability of still being there at that team's next pick; the draft then
 * says whether he was. Scored over the players among the first 120 available
 * by ADP that have one (the board's working range), as Brier and log loss.
 *
 * Shared by `scripts/test-fantrax-vona.ts` (the shipped constants must stay
 * calibrated on both drafts) and the parameter fit:
 *   npx tsx scripts/draft-calibration.ts            (grid over τ, c, saturation)
 */
import { readFileSync } from "fs";
import { CAPTAINS_DYNASTY, SLAPSHOT, type FantraxLeagueConfig } from "../src/lib/fantrax/config";
import { draftOutlook, type DraftOutlookOptions, type DraftPickInfo, type DraftPoolPlayer } from "../src/lib/fantrax/draft";
import { seasonFp } from "../src/lib/fantrax/draft-inputs";
import type { StateSnapshot, ValuesSnapshot } from "../src/lib/fantrax/snapshot-types";
import { fantraxPaths } from "./fantrax-paths";

export interface DraftCalibration {
  n: number;
  brier: number;
  logLoss: number;
  /** Predicted 0-10 % still there: how many, and the share actually still there. */
  lowBin: { n: number; observed: number };
}

export interface ReplayInput {
  picks: DraftPickInfo[];
  pool: DraftPoolPlayer[];
  /** Pick number each drafted pool player went at. */
  pickAt: Map<string, number>;
  /** Pool players with a projection (the share of picks landing in the pool). */
  inPool: Set<string>;
}

/** The league's committed draft and pool, as the audit replayed them. */
export function replayInput(cfg: FantraxLeagueConfig, root = process.cwd()): ReplayInput | null {
  const paths = fantraxPaths(cfg, root);
  const st = JSON.parse(readFileSync(paths.state, "utf8")) as StateSnapshot;
  const vals = (JSON.parse(readFileSync(paths.values, "utf8")) as ValuesSnapshot).players;
  if (!st.draft?.picks.length) return null;
  const picks = [...st.draft.picks].sort((a, b) => a.pick - b.pick);
  const pickAt = new Map<string, number>();
  for (const p of picks) if (p.playerId) pickAt.set(p.playerId, p.pick);
  const rostered = new Set(Object.values(st.rosters).flatMap((r) => r.map((x) => x.id)));
  const pool = Object.keys(vals)
    .filter((id) => vals[id]!.src === "proj" && (pickAt.has(id) || !rostered.has(id)))
    .map((id) => ({ id, groups: ["C"] as const, seasonFp: Math.max(1e-6, seasonFp(vals[id]!, cfg)), adp: st.adp[id] ?? Number.POSITIVE_INFINITY }))
    .filter((p) => p.seasonFp > 0);
  return { picks, pool, pickAt, inPool: new Set(pool.map((p) => p.id)) };
}

export function replayDraft(input: ReplayInput, adp: DraftOutlookOptions["adp"], step = 1, window = 120): DraftCalibration {
  const { picks, pool, pickAt, inPool } = input;
  let n = 0;
  let brier = 0;
  let ll = 0;
  let lowN = 0;
  let lowO = 0;
  for (let i = 0; i < picks.length; i += step) {
    const me = picks[i]!.teamId;
    const nextMine = picks.slice(i + 1).find((p) => p.teamId === me);
    if (!nextMine) continue;
    const view = picks.map((p, k) => (k <= i ? p : { ...p, playerId: undefined }));
    const made = view.filter((p) => p.playerId);
    const fromPool = made.filter((p) => inPool.has(p.playerId!)).length;
    const o = draftOutlook(view, me, pool, {}, { poolShare: (fromPool + 1) / (made.length + 2), boardSize: 100_000, groups: ["C"], adp });
    const avail = pool
      .filter((p) => Number.isFinite(p.adp) && (pickAt.get(p.id) ?? Number.POSITIVE_INFINITY) > picks[i]!.pick)
      .sort((a, b) => a.adp - b.adp)
      .slice(0, window);
    const inWindow = new Set(avail.map((p) => p.id));
    for (const row of o.board) {
      if (!inWindow.has(row.id)) continue;
      const stayed = (pickAt.get(row.id) ?? Number.POSITIVE_INFINITY) >= nextMine.pick ? 1 : 0;
      const a = row.available;
      brier += (a - stayed) ** 2;
      const ac = Math.min(1 - 1e-6, Math.max(1e-6, a));
      ll -= stayed ? Math.log(ac) : Math.log(1 - ac);
      n++;
      if (a < 0.1) {
        lowN++;
        lowO += stayed;
      }
    }
  }
  return { n, brier: brier / n, logLoss: ll / n, lowBin: { n: lowN, observed: lowN ? lowO / lowN : 0 } };
}

/** Slapshot's 1,216-pick draft is replayed every `SLAPSHOT_STEP`th pick (same as the audit). */
export const SLAPSHOT_STEP = 5;

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/draft-calibration.ts");
if (isMain) {
  const leagues = [
    ["Captains", replayInput(CAPTAINS_DYNASTY), 1],
    ["Slapshot", replayInput(SLAPSHOT), SLAPSHOT_STEP],
  ] as const;
  const grid: Array<{ sigma: number; offset: number; saturated: number }> = [{ sigma: 0.35, offset: 5, saturated: Number.POSITIVE_INFINITY }];
  const list = (k: string, def: number[]) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1]!.split(",").map(Number) : def);
  for (const saturated of list("--sat", [Number.POSITIVE_INFINITY, 280, 285, 290]))
    for (const sigma of list("--sigma", [0.6, 0.8, 1.0, 1.2, 1.4]))
      for (const offset of list("--offset", [10, 25, 40])) grid.push({ sigma, offset, saturated });
  for (const g of grid) {
    const r = leagues.map(([label, inp, step]) => {
      const c = replayDraft(inp!, g, step);
      return `${label} Brier ${c.brier.toFixed(4)} ll ${c.logLoss.toFixed(3)} low ${c.lowBin.n}:${c.lowBin.observed.toFixed(2)}`;
    });
    console.log(`τ ${g.sigma} c ${g.offset} sat ${g.saturated}: ${r.join(" | ")}`);
  }
  console.log("done");
}
