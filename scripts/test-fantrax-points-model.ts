/**
 * Unit checks for the Fantrax per-game points model.
 * Run: npx tsx scripts/test-fantrax-points-model.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import type { FxeaScoringGroup } from "../src/lib/fantrax/api-types";
import {
  backToBackShares,
  BACK_TO_BACK_STARTER_FACTOR,
  dayToDayFactor,
  goalieRatesFromProjection,
  goalieStartShares,
  goalieValueFromProjection,
  hatTrickProbability,
  MAX_START_SHARE,
  skaterPlayProbability,
  skaterValueFromProjection,
  takeawaysPerGame,
  TK_PRIOR_RATE,
} from "../src/lib/fantrax/points-model";
import { parseScoringTable } from "../src/lib/fantrax/scoring";
import { bestFpg, seasonFp } from "../src/lib/fantrax/draft-inputs";
import { CAPTAINS_DYNASTY, fantasySeasonShare, SLAPSHOT } from "../src/lib/fantrax/config";
import type { ValueRecord } from "../src/lib/fantrax/snapshot-types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const table = parseScoringTable(
  (
    JSON.parse(readFileSync(join(process.cwd(), "scripts", "fixtures", "fantrax-scoring.json"), "utf8")) as {
      scoringCategorySettings: FxeaScoringGroup[];
    }
  ).scoringCategorySettings,
);

// Hat tricks: Poisson P(X >= 3).
assert(hatTrickProbability(0) === 0, "HT(0) = 0");
const lam = 0.6712;
const manual = 1 - Math.exp(-lam) * (1 + lam + (lam * lam) / 2);
assert(near(hatTrickProbability(lam), manual, 1e-12), "HT formula");
assert(near(hatTrickProbability(0.6712), 0.0307, 5e-4), "HT(0.67) ≈ 3.1%");
assert(hatTrickProbability(3) > hatTrickProbability(1), "HT increasing");

// Vasilevskiy 2026-27 projection (players.json): 59 GP, 31 W, 1401 SV, .9224, 4 SO.
const vasy = { gamesPlayed: 59, wins: 31, shutouts: 4, saves: 1401, savePct: 0.9224 };
const vasyCareer = { gamesPlayed: 598, otLosses: 39, assists: 24 };
const vr = goalieRatesFromProjection(vasy, vasyCareer);
assert(near(vr.ga * 59, 118, 0.5), `Vasilevskiy GA ${(vr.ga * 59).toFixed(1)} ≈ 118`);
const vE = goalieValueFromProjection(table, vasy, vasyCareer);
assert(near(vE, 5.21, 0.02), `Vasilevskiy E ${vE.toFixed(3)} = 5.21 ± 0.02`);
// No career history → league-mean OTL / assist rates.
const rookie = goalieRatesFromProjection(vasy, null);
assert(near(rookie.otl, 0.105, 1e-9) && near(rookie.a, 0.02, 1e-9), "goalie priors");

// MacKinnon 2026-27 projection: 73 GP, 49 G, 79 A, 326 SOG, 71 Hit, 45 Blk.
const mack = { gamesPlayed: 73, goals: 49, assists: 79, shots: 326, hits: 71, blocks: 45 };
const mv = skaterValueFromProjection(table, mack, { primaryD: false, dEligible: false });
assert(near(mv.off, 6.44, 0.05), `MacKinnon off ${mv.off.toFixed(3)} = 6.44 ± 0.05`);
assert(mv.dx === 0, "dx is 0 for forwards");

// A D gets dx from blocks, takeaways and the team shutout rate.
const dahlin = { gamesPlayed: 75, goals: 17, assists: 53, shots: 190, hits: 80, blocks: 100 };
const tk = takeawaysPerGame([
  { seasonId: 20252026, gamesPlayed: 77, takeaways: 32 },
  { seasonId: 20242025, gamesPlayed: 73, takeaways: 39 },
  { seasonId: 20232024, gamesPlayed: 81, takeaways: 90 }, // ignored: only 2 seasons
]);
const expectedTk = (0.65 * 32 + 0.35 * 39 + 40 * TK_PRIOR_RATE) / (0.65 * 77 + 0.35 * 73 + 40);
assert(near(tk, expectedTk, 1e-12), "takeaways: 2 seasons weighted 0.65/0.35 + 40 GP prior");
assert(near(takeawaysPerGame([]), TK_PRIOR_RATE, 1e-12), "takeaways: no history → league mean");
const traded = takeawaysPerGame([
  { seasonId: 20252026, gamesPlayed: 40, takeaways: 10 },
  { seasonId: 20252026, gamesPlayed: 40, takeaways: 10 },
]);
assert(near(traded, (0.65 * 20 + 40 * TK_PRIOR_RATE) / (0.65 * 80 + 40), 1e-12), "traded season rows summed");
const dv = skaterValueFromProjection(table, dahlin, { primaryD: true, dEligible: true, takeawaysPerGame: tk });
assert(near(dv.dx, 0.3 * (100 / 75) + 0.35 * tk + 2 * 0.05, 1e-9), "dx = 0.3 blk + 0.35 tk + 2 × 0.05");
assert(dv.off > 0 && dv.dx > 0.5, "D has offense and dx");

// P(play).
const regular = { gp: 75, src: "proj" as const, team: "COL", icons: [] };
assert(skaterPlayProbability(regular, true) === 1, "regular plays");
assert(skaterPlayProbability(regular, false) === 0, "no game → 0");
assert(skaterPlayProbability({ ...regular, icons: ["30"] }, true) === 0, "injured → 0");
assert(skaterPlayProbability({ ...regular, icons: ["4"] }, true) === 0, "minor leagues → 0");
assert(skaterPlayProbability({ ...regular, icons: ["6"] }, true) === 0, "suspended → 0");
// Fantrax "Injured Reserve List" (NHL IR / LTIR: Fiala, Marchand) and "Inactive".
assert(skaterPlayProbability({ ...regular, icons: ["2", "8"] }, true) === 0, "NHL injured reserve → 0");
assert(skaterPlayProbability({ ...regular, icons: ["7"] }, true) === 0, "inactive → 0");
assert(skaterPlayProbability({ ...regular, icons: ["1"] }, true) === 0.5, "day-to-day halves a regular");
assert(near(skaterPlayProbability({ ...regular, gp: 41, fpg: 1.8, icons: ["1"] }, true), 0.25, 1e-9), "day-to-day halves a fringe player");
assert(dayToDayFactor(["31"]) === 1 && dayToDayFactor(undefined) === 1, "no day-to-day flag → no discount");
assert(skaterPlayProbability({ ...regular, team: "(N/A)" }, true) === 0, "clubless → 0");
assert(near(skaterPlayProbability({ ...regular, gp: 41, fpg: 1.8 }, true), 0.5, 1e-9), "fringe → GP/82");
assert(skaterPlayProbability({ ...regular, gp: 10, fpg: 1 }, true) === 0.3, "fringe floor 0.3");
assert(skaterPlayProbability({ ...regular, gp: 58, fpg: 5.4 }, true) === 1, "injury-prone star is a regular");
// The FP/G shortcut needs a real GP projection: 3-GP placeholder projections
// of prospects (James Hagens) and part-time D (Luke Schenn, 44 GP) stay fringe.
assert(skaterPlayProbability({ ...regular, gp: 3, fpg: 2.71 }, true) === 0.3, "3-GP placeholder stays at the 0.3 floor");
assert(near(skaterPlayProbability({ ...regular, gp: 44, fpg: 3.35 }, true), 44 / 82, 1e-9), "44-GP depth D → 44/82");
assert(skaterPlayProbability({ ...regular, gp: 45, fpg: 2.5 }, true) === 1, "45 GP at the p25 FP/G is a regular");
assert(skaterPlayProbability({ ...regular, src: "prior" }, true) === 0.6, "prior discount");

// Goalie tandem shares.
const shares = goalieStartShares([
  { id: "a", team: "TBL", gp: 60, healthy: true },
  { id: "b", team: "TBL", gp: 20, healthy: true },
  { id: "c", team: "MIN", gp: 52, healthy: false },
  { id: "d", team: "MIN", gp: 25, healthy: true },
  { id: "e", team: "(N/A)", gp: 30, healthy: true },
]);
assert(near(shares.get("a")!, 0.75, 1e-9) && near(shares.get("b")!, 0.25, 1e-9), "tandem renormalized");
assert(shares.get("c") === 0, "injured starter gets 0");
assert(shares.get("d") === MAX_START_SHARE, "healthy backup inherits, capped");
assert(shares.get("e") === 0, "clubless goalie 0");
const b2b = backToBackShares(new Map([["a", 0.75], ["b", 0.25]]));
assert(near(b2b.get("a")!, 0.75 * BACK_TO_BACK_STARTER_FACTOR, 1e-9), "b2b starter keeps 60%");
assert(near(b2b.get("a")! + b2b.get("b")!, 1, 1e-9), "b2b share moves to the partner");
// The factor is fit on data (scripts/backtest-goalie-starts.ts, every back-to-back
// second night of 2021-22..2025-26): pinned, then re-scored on those nights
// (scripts/fixtures/goalie-b2b-nights.json, `--dump`): the shipped
// `backToBackShares` must stay at the best Brier of the grid and well ahead
// of the old 0.35 (0.263) and of no adjustment (0.298).
assert(BACK_TO_BACK_STARTER_FACTOR >= 0.55 && BACK_TO_BACK_STARTER_FACTOR <= 0.65, `b2b factor ${BACK_TO_BACK_STARTER_FACTOR} is the backtest's 0.6 (± 0.05)`);
{
  const fx = JSON.parse(readFileSync(join(process.cwd(), "scripts", "fixtures", "goalie-b2b-nights.json"), "utf8")) as { nights: number[][] };
  const brier = (move: (shares: Map<string, number>) => Map<string, number>) => {
    let sum = 0;
    let n = 0;
    for (const row of fx.nights) {
      const t = row[row.length - 1]!;
      const shares = new Map(row.slice(0, -1).map((p, i) => [String(i), p]));
      for (const [id, p] of move(shares)) {
        const q = Math.min(0.99, Math.max(0.01, p));
        sum += (q - (Number(id) === t ? 1 : 0)) ** 2;
        n++;
      }
    }
    return sum / n;
  };
  const withFactor = (f: number) => (shares: Map<string, number>) => {
    const ranked = [...shares.entries()].filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]);
    const out = new Map(shares);
    if (!ranked.length) return out;
    const moved = ranked[0]![1] * (1 - f);
    out.set(ranked[0]![0], ranked[0]![1] - moved);
    if (ranked[1]) out.set(ranked[1][0], Math.min(MAX_START_SHARE, ranked[1][1] + moved));
    return out;
  };
  const shipped = brier(backToBackShares);
  const grid = [0.25, 0.35, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.8, 1].map((f) => brier(withFactor(f)));
  assert(fx.nights.length > 1500, `b2b fixture: ${fx.nights.length} nights`);
  assert(shipped <= Math.min(...grid) + 0.001, `b2b Brier ${shipped.toFixed(4)} is the grid's best (${Math.min(...grid).toFixed(4)})`);
  assert(shipped < brier(withFactor(0.35)) - 0.01 && shipped < brier(withFactor(1)) - 0.03, `b2b Brier ${shipped.toFixed(4)} well ahead of 0.35 and of no adjustment`);
}

// ---- bestFpg: which slot a skater is really valued in.
//
// `dx` is the D slot's extra over the column `off` is measured in. It is
// positive in Captains (Blk / Tk / skater SHO are D-only), but a league can pay
// a category LESS at D than at the base column — Slapshot's scoring table does
// exactly that under the "Fantrax ignores the per-slot rows" reading of its
// Hit / SB zeros (see `ScoringBaseSlot`). A player who can only sit at D is then
// really worth `off + dx`, and clamping the extra at 0 would over-value him.
{
  const rec = (e: string, off: number, dx: number): ValueRecord => ({ n: "X", t: "DET", e, gp: 80, off, dx, src: "proj" });
  // Captains: a pure D gains his blocks, a W/D dual takes the better slot.
  assert(near(bestFpg(rec("D,Skt", 2, 0.5), CAPTAINS_DYNASTY), 2.5, 1e-9), "Captains: a pure D is valued in the D slot");
  assert(near(bestFpg(rec("W,D,F,Skt", 2, 0.5), CAPTAINS_DYNASTY), 2.5, 1e-9), "Captains: a dual takes the better of his slots");
  // A negative D extra: only the D-only player pays it.
  assert(near(bestFpg(rec("D", 3.234, -0.829), SLAPSHOT), 2.405, 1e-3), "a D-only player with a negative D extra is valued at off + dx");
  assert(near(bestFpg(rec("LW,D", 3.234, -0.829), SLAPSHOT), 3.234, 1e-9), "a player who can also take a wing keeps the better slot");
  // Slapshot's fantasy season ends in February: season totals cover its share of the NHL games.
  // A DET player: DET plays 63 of its 84 games through period 82.
  const share = 63 / 84;
  assert(near(fantasySeasonShare(SLAPSHOT, "DET"), share, 1e-12), `Slapshot season share of a DET player ${share}`);
  assert(near(fantasySeasonShare(SLAPSHOT, "WSH"), 60 / 84, 1e-12) && near(fantasySeasonShare(SLAPSHOT, "ANA"), 64 / 84, 1e-12), "each club's own calendar (WSH 60, ANA 64 of 84)");
  assert(fantasySeasonShare(SLAPSHOT, "(N/A)") === SLAPSHOT.cadence.seasonShare, "no club: the league-wide share");
  assert(fantasySeasonShare(CAPTAINS_DYNASTY, "DET") === 1, "Captains: the whole season");
  const games = Object.values(SLAPSHOT.cadence.fantasySeasonGames!.byTeam).reduce((a, b) => a + b, 0) / 2;
  assert(Math.abs(games / 1344 - SLAPSHOT.cadence.seasonShare!) < 5e-4, `the clubs add up to the league-wide share (${games} of 1,344 games)`);
  assert(near(seasonFp(rec("D", 3.234, -0.829), SLAPSHOT), 80 * 2.405 * share, 1e-1), "the season total follows the same slot, over the league's season");
  assert(near(seasonFp(rec("D,Skt", 2, 0.5), CAPTAINS_DYNASTY), 80 * 2.5, 1e-9), "Captains: the whole NHL season");
  // A goalie never goes through the skater branch.
  const g: ValueRecord = { n: "G", t: "DET", e: "G", gp: 55, gE: 5, pS: 0.7, src: "proj" };
  assert(near(bestFpg(g, SLAPSHOT), 3.5, 1e-9), "a goalie is start share x E per start");
  assert(near(seasonFp(g, SLAPSHOT), 275 * share, 1e-9), "and his season total is starts x E, over the league's season");
}

if (failed) process.exit(1);
console.log("OK: fantrax points model");
