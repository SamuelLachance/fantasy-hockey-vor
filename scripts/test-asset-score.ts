/**
 * Asset scores and draft-pick values (src/lib/dynasty/asset-score.ts), audit
 * 2026-10-02: the keeper league's next-draft pool never counts a rostered
 * player still minors-eligible at the cutdown (« free »); players already in
 * the league count from the draft season on, the new class's path moves to
 * it; the next draft's order is averaged over the final standings and the
 * lottery; snake drafts reverse even rounds; one asset score (value, ties by
 * season points) shared by the « Actifs » tab and the player table.
 * Also on the committed Captains dynasty.json: the last pick of the next
 * draft no longer beats half the rostered players.
 * Run: npx tsx scripts/test-asset-score.ts
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  ASSET_MODE_WEIGHTS,
  assetKey,
  assetScale,
  assetScore,
  assetsOf,
  CAPTAINS_LOTTERY,
  draftOrderOdds,
  draftPool,
  slotValues,
  valueFrom,
  type AssetLeagueInput,
  type AssetRecord,
  type PickAsset,
} from "../src/lib/dynasty/asset-score";
import { clientDynastySnapshot } from "../src/lib/dynasty/client-snapshot";
import type { DynastySnapshot } from "../src/lib/dynasty/types";
import { withAssetScores, type FantraxRow } from "../src/lib/fantrax/table";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const D = { winNow: 0.35, balanced: 0.75, longTerm: 0.95 };

// ---- the horizons' season weights are the engine's
{
  const params = JSON.parse(readFileSync(join(process.cwd(), "src", "data", "dynasty", "params.json"), "utf8")) as {
    modes: Record<string, { delta: number; w0: number; w1?: number }>;
  };
  for (const [m, w] of Object.entries(ASSET_MODE_WEIGHTS)) {
    const pm = params.modes[m]!;
    assert(pm.w0 === w.w0 && (pm.w1 ?? 1) === (w.w1 ?? 1) && pm.delta === D[m as keyof typeof D], `mode ${m}: weights and δ match params.json`);
  }
}

// ---- valueFrom: value from season k on (no path shift) vs a class entering k seasons later
{
  const r = { dv: { winNow: 0, balanced: 0, longTerm: 0 }, eG: [10, 10, 10, 10] };
  r.dv.balanced = r.eG.reduce((s, x, t) => s + Math.pow(0.75, t) * x, 0);
  assert(near(valueFrom(r, "balanced", 0.75, 0), r.dv.balanced, 1e-9), "k = 0: the value");
  assert(near(valueFrom(r, "balanced", 0.75, 1), r.dv.balanced - 10, 1e-9), "k = 1: season 0 belongs to his current owner");
  assert(near(valueFrom(r, "balanced", 0.75, 1, true), 0.75 * r.dv.balanced, 1e-9), "a class entering a season later: δ × its value");
  const pros = { dv: { winNow: 0, balanced: 40, longTerm: 0 }, eG: [0, 0, 20, 30] };
  assert(near(valueFrom(pros, "balanced", 0.75, 1), 40, 1e-9), "a prospect whose value is all later keeps it (not δ × it)");
  const mkt = { dv: { winNow: 0, balanced: 20, longTerm: 0 }, eG: [10, 10, 10, 10] };
  assert(near(valueFrom(mkt, "balanced", 0.75, 1), (20 * (r.dv.balanced - 10)) / r.dv.balanced, 1e-9), "the market layer's level is kept (share of the value)");
}

// ---- the keeper pool: owned « free » players out, unkept at 1 − P(kept) (team odds first)
const rec = (o: Partial<AssetRecord> & { v: number }): AssetRecord => ({
  n: "x",
  g: "F",
  age: 24,
  phase: "prime",
  dv: { winNow: o.v, balanced: o.v, longTerm: o.v },
  eG: o.eG ?? [o.v, 0, 0],
  ...o,
});
{
  const records: Record<string, AssetRecord> = {
    pros: rec({ v: 400, eG: [0, 0, 100, 200, 300], keeper: { status: "free", pKept27: null } }),
    vet: rec({ v: 100, eG: [50, 40, 30], keeper: { status: "bubble", pKept27: 0.5, team: { pKept27: 0.2 } } }),
    core: rec({ v: 300, eG: [150, 120, 100], keeper: { status: "core", pKept27: 0.99 } }),
    fa: rec({ v: 60, eG: [30, 30, 30] }),
    kid: rec({ v: 80, eG: [0, 10, 40, 60], draft: { year: 2026, pick: 1 } }),
  };
  const inp: AssetLeagueInput = { kind: "keeper", firstSeason: 2026, teams: ["A"], rosters: { A: ["pros", "vet", "core"] }, records, picks: [], deltas: D };
  const pool = draftPool(inp, "balanced", 1);
  const byV = (v: number) => pool.find((x) => near(x.v, v, 1e-6));
  assert(!pool.some((x) => x.v >= 300), "an owned prospect still minors-eligible at the cutdown is never in the pool");
  const vetV = valueFrom(records.vet!, "balanced", 0.75, 1);
  assert(!!byV(vetV) && near(byV(vetV)!.a, 0.8, 1e-9), "an owned veteran: 1 − his team's keeper odds, from the draft season on");
  assert(pool.filter((x) => x.a > 0).length === 4, "the core keeper (a ≈ 0.01), the unowned player, the class and the veteran");
  assert(!!byV(0.75 * 80), "the latest class enters a season later (δ × its value)");
  const dyn = draftPool({ ...inp, kind: "dynasty" }, "balanced", 1);
  assert(dyn.length === 2, "every-player-carries-over league: the unowned player and the class only");
}

// ---- slotValues
{
  const sv = slotValues([{ v: 10, a: 1 }, { v: 8, a: 0.5 }, { v: 6, a: 0.5 }, { v: 3, a: 1 }], 4);
  assert(sv.join(",") === "10,6,3,0", `slot values walk the cumulative availability (${sv.join(",")})`);
}

// ---- next draft's order: standings noise and the lottery
{
  const s = new Map([
    ["a", 10],
    ["b", 20],
    ["c", 30],
    ["d", 40],
  ]);
  const exact = draftOrderOdds(s, { noise: 0 });
  assert(exact.get("a")![0] === 1 && exact.get("d")![3] === 1, "no noise, no lottery: weakest picks first");
  const noisy = draftOrderOdds(s, { noise: 1 });
  for (const [t, row] of noisy) assert(near(row.reduce((x, y) => x + y, 0), 1, 1e-9), `${t}: positions sum to 1`);
  for (let j = 0; j < 4; j++) assert(near([...noisy.values()].reduce((x, r) => x + r[j]!, 0), 1, 1e-9), `position ${j} filled once`);
  assert(noisy.get("a")![0]! < 1 && noisy.get("a")![0]! > noisy.get("d")![0]!, "with noise the weakest still picks first most often");
  const teams16 = new Map(Array.from({ length: 16 }, (_, i) => [`t${String(i).padStart(2, "0")}`, i]));
  const lot = draftOrderOdds(teams16, { noise: 0, lottery: CAPTAINS_LOTTERY, draws: 20000 });
  const w = CAPTAINS_LOTTERY.weights;
  const tot = w.reduce((a, b) => a + b, 0);
  assert(near(lot.get("t00")![0]!, w[0]! / tot, 0.01), `lottery: P(weakest wins #1) = 25 / Σ weights (${lot.get("t00")![0]!.toFixed(3)})`);
  assert(near(lot.get("t15")![15]!, 1, 1e-9) && near(lot.get("t11")![11]!, 1, 1e-9), "playoff teams keep their place");
  assert(lot.get("t10")![0]! > 0 && lot.get("t00")![3]! > 0, "any lottery team can win; the weakest can fall to 4th");
}

// ---- pick values on a toy league: snake order, lottery, uniform later years
{
  const records: Record<string, AssetRecord> = {};
  for (let i = 0; i < 40; i++) records[`p${i}`] = rec({ v: 200 - 4 * i, eG: [0, 50, 50, 50], draft: { year: 2026, pick: i + 1 } });
  const teams = ["A", "B", "C", "D"];
  const rosters = { A: [], B: [], C: [], D: [] };
  const picks = teams.flatMap((t) => [1, 2].map((round) => ({ year: 2027, round, owner: t, original: t })));
  const base: AssetLeagueInput = { kind: "dynasty", firstSeason: 2026, teams, rosters, records, picks, deltas: D, standingsNoise: 0 };
  const val = (inp: AssetLeagueInput, t: string, round: number) =>
    assetsOf(inp, "balanced").flatMap((x) => x.assets).find((a): a is PickAsset => a.kind === "pick" && a.original === t && a.round === round)!;
  // equal strengths: the order falls back to the team ids (A first)
  assert(val(base, "A", 1).slot === 1 && val(base, "A", 2).slot === 5, "fixed order: the same position every round");
  const snake = { ...base, draftOrder: "snake" as const };
  assert(val(snake, "A", 2).slot === 8 && val(snake, "D", 2).slot === 5, "snake: even rounds reversed");
  const later = { ...base, picks: [{ year: 2028, round: 1, owner: "A", original: "A" }] };
  const p28 = val(later, "A", 1);
  assert(p28.slot === 3 && p28.value > 0, `a later year: every position of the round equally likely (slot ${p28.slot})`);
}

// ---- one asset score: ties broken by season points, the same in the tab and the table
{
  const scale = assetScale([assetKey(0, 10), assetKey(0, 50), assetKey(5, null), assetKey(9, 1)]);
  assert(assetScore(scale, assetKey(0, 10)) === 0 && assetScore(scale, assetKey(0, 50)) === 25, "value ties split by season points");
  assert(assetScore(scale, assetKey(5, null)) === 50 && assetScore(scale, assetKey(100, 0)) === 100, "value first");
  // the tab (assetsOf) and the table (withAssetScores) score the same players identically
  const records: Record<string, AssetRecord> = {};
  const seasonFp: Record<string, number> = {};
  const rows: FantraxRow[] = [];
  for (let i = 0; i < 30; i++) {
    const v = i % 3 === 0 ? 0 : i * 2;
    records[`p${i}`] = rec({ v, eG: [v, v, v] });
    seasonFp[`p${i}`] = (i * 37) % 23;
    rows.push({ id: `p${i}`, owner: i < 24 ? "A" : null, fp: seasonFp[`p${i}`], dynasty: { dv: records[`p${i}`]!.dv }, dynZero: false } as unknown as FantraxRow);
  }
  const tab = assetsOf(
    { kind: "dynasty", firstSeason: 2026, teams: ["A"], rosters: { A: rows.filter((r) => r.owner).map((r) => r.id) }, records, picks: [], deltas: D, seasonFp },
    "balanced",
  );
  withAssetScores(rows);
  let same = 0;
  for (const a of tab[0]!.assets) if (a.kind === "player" && rows.find((r) => r.id === a.id)!.asset!.balanced === a.score) same++;
  assert(same === 24, `the « Actifs » tab and the table agree on every rostered player (${same}/24)`);
}

// ---- the committed Captains values: the last pick of the next draft scores under 50
{
  const full = join(process.cwd(), "public", "fantrax", "dynasty.json");
  const statePath = join(process.cwd(), "public", "fantrax", "state.json");
  if (existsSync(full) && existsSync(statePath)) {
    const records = clientDynastySnapshot(JSON.parse(readFileSync(full, "utf8")) as DynastySnapshot).players as unknown as Record<string, AssetRecord>;
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { rosters: Record<string, Array<{ id: string }>> };
    const rosters: Record<string, string[]> = {};
    for (const [t, es] of Object.entries(state.rosters)) rosters[t] = es.map((e) => e.id);
    const teams = Object.keys(rosters);
    const picks = teams.flatMap((t) => Array.from({ length: 14 }, (_, r) => ({ year: 2027, round: r + 1, owner: t, original: t })));
    const out = assetsOf({ kind: "keeper", firstSeason: 2026, teams, rosters, records, picks, deltas: D, keepers: 10, lottery: CAPTAINS_LOTTERY }, "balanced");
    const p = out.flatMap((t) => t.assets.filter((a): a is PickAsset => a.kind === "pick"));
    const last = p.filter((a) => a.round === 14).sort((a, b) => b.score - a.score)[0]!;
    const first = p.filter((a) => a.round === 1).sort((a, b) => b.value - a.value)[0]!;
    assert(last.score < 50, `Captains: the best 14th-round pick scores ${last.score} (< 50: it no longer beats half the rostered players)`);
    const best = Math.max(...Object.entries(records).filter(([id, r]) => !Object.values(rosters).flat().includes(id) || r.keeper?.status !== "free").map(([, r]) => r.dv.balanced));
    assert(first.value <= best, `Captains: the best 1st-round pick (${first.value}) is worth no more than the best player it could take (${best})`);
  } else console.log("  (no committed Captains dynasty.json / state.json: data checks skipped)");
}

if (failed) process.exit(1);
console.log("OK: asset scores and draft-pick values");
