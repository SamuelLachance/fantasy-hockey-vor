/**
 * Draft-board and roster helpers on dynasty.json (src/lib/dynasty/board.ts),
 * plus a sanity pass over the committed public/fantrax/dynasty.json.
 * Run: npx tsx scripts/test-dynasty-plan.ts
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  dynastyBoard,
  dynastyDraftValue,
  dynastyDropProtection,
  marketRanks,
  PROTECT_TOP_N,
} from "../src/lib/dynasty/board";
import { explainFr } from "../src/lib/dynasty/explain";
import type { DynastyRecord, DynastySnapshot } from "../src/lib/dynasty/types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const rec = (n: string, over: Partial<DynastyRecord> = {}): DynastyRecord => ({
  n,
  g: "F",
  age: 25,
  path: "nhl",
  seg: "established",
  phase: "prime",
  effAge: 25,
  traj: 0,
  gp: 300,
  dv: { winNow: 50, balanced: 60, longTerm: 70 },
  rank: { winNow: 1, balanced: 1, longTerm: 1 },
  band: { balanced: [10, 50, 120], longTerm: [10, 60, 150] },
  eG: [40, 20, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  p50G: new Array(12).fill(0),
  eFP: new Array(12).fill(0),
  pNhl: 1,
  eta: null,
  elig: { now: false, next: 0, freeThrough: null, binding: null, uncertain: false },
  keeper: { status: "bubble", pKept27: 0.5 },
  market: { w: 0 },
  ...over,
});
const snap = (players: Record<string, DynastyRecord>): DynastySnapshot => ({
  builtAt: "2026-09-25T00:00:00Z",
  season: "2026-27",
  version: 1,
  inputs: {
    valuesFetchedAt: "",
    stateFetchedAt: "",
    projectionsAt: "",
    prospectsBuiltAt: "",
    poolFetchedAt: null,
    paramsVersion: "test",
  },
  params: {} as DynastySnapshot["params"],
  players,
  zero: [],
});

// ---- market ranks
{
  const ros: Record<string, number> = { a: 90, b: 90, c: 50, d: 0 };
  const adp: Record<string, number> = { a: 10, b: 300, c: 5, e: 20 };
  const r = marketRanks(["a", "b", "c", "d", "e"], (id) => ros[id], (id) => adp[id]);
  assert(r.size === 4, "players with neither Ros% nor a real ADP are unranked");
  assert(!r.has("d"), "Ros 0 and no ADP → unranked");
  // Ros ranks a 1.5, b 1.5, c 3; ADP ranks c 1, a 2, e 3 (b's 300 counts as missing)
  const score = { a: Math.sqrt(1.5 * 2), b: 1.5, c: Math.sqrt(3 * 1), e: 3 };
  const order = Object.entries(score).sort((x, y) => x[1] - y[1]).map(([id]) => id);
  const got = [...r.entries()].sort((x, y) => x[1] - y[1]).map(([id]) => id);
  assert(JSON.stringify(got) === JSON.stringify(order), `geometric-mean order ${got.join(",")} (expected ${order.join(",")})`);
}

// ---- board: prospects only in dynasty.json join the pool, sorted by value
{
  const players: Record<string, DynastyRecord> = {
    vet: rec("Vet", { dv: { winNow: 120, balanced: 100, longTerm: 80 }, market: { w: 0, ros: 80, adp: 40 } }),
    kid: rec("Kid", {
      path: "prospect",
      phase: "prospect",
      seg: "prospect",
      dv: { winNow: 20, balanced: 60, longTerm: 150 },
      eG: new Array(12).fill(0),
      market: { w: 0.35, ros: 95 },
      keeper: { status: "free", pKept27: null },
      elig: { now: true, next: 1, freeThrough: 2029, binding: "age", uncertain: false },
    }),
    dman: rec("Dman", { g: "D", dv: { winNow: 50, balanced: 50, longTerm: 45 }, eG: [60, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], market: { w: 0, adp: 90 } }),
    deep: rec("Deep", { dv: { winNow: 1, balanced: 1, longTerm: 1 }, market: { w: 0 } }),
  };
  const dyn = snap(players);
  const board = dynastyBoard(dyn, ["vet", "kid", "dman", "deep", "not-modeled"], { mode: "longTerm", picksBefore: 2, picksBeforeFollowing: 5 });
  assert(board.some((b) => b.id === "kid"), "a prospect that exists only in dynasty.json is on the board");
  assert(!board.some((b) => b.id === "not-modeled"), "ids without a dynasty record are skipped");
  assert(board[0]!.id === "kid", `long-term board led by the prospect (${board[0]!.id})`);
  assert(board.every((b, i) => i === 0 || board[i - 1]!.value >= b.value), "board sorted by value");
  const bal = dynastyBoard(dyn, ["vet", "kid", "dman", "deep"], { mode: "balanced", picksBefore: 2, need: { D: 1 } });
  assert(near(bal.find((b) => b.id === "dman")!.value, 50 + 0.5 * 1 * 60, 1e-9), "D need bonus only on the current season");
  const pos = (id: string) => bal.findIndex((b) => b.id === id);
  assert(pos("dman") < pos("kid"), "an empty D slot lifts the D (50 + 30) above a 60 prospect");
  // pool share 1: with m picks before, the odds of being gone add up to m over the ranked pool
  const many: Record<string, DynastyRecord> = {};
  for (let i = 0; i < 60; i++) many[`p${i}`] = rec(`P${i}`, { market: { w: 0, adp: i + 1 } });
  const b2 = dynastyBoard(snap(many), Object.keys(many), { mode: "balanced", picksBefore: 6 });
  const gone = b2.reduce((s, b) => s + (1 - b.available), 0);
  assert(near(gone, 6, 0.05), `every pick lands in this pool (expected gone ${gone.toFixed(3)} = 6)`);
  assert(b2.find((b) => b.id === "p0")!.available < b2.find((b) => b.id === "p59")!.available, "the market's top is at risk first");
  const none = dynastyBoard(snap(many), Object.keys(many), { mode: "balanced", picksBefore: 0 });
  assert(none.every((b) => b.available === 1), "nobody picks in between → everyone available");
  assert(dynastyDraftValue(rec("neg", { dv: { winNow: -5, balanced: -5, longTerm: -5 } }), "balanced") === 0, "value floored at 0");
}

// ---- drop protection
{
  const roster: Record<string, DynastyRecord> = {};
  for (let i = 0; i < 16; i++) roster[`r${i}`] = rec(`R${i}`, { dv: { winNow: i, balanced: i, longTerm: i }, keeper: { status: "rental", pKept27: 0.1 } });
  roster.stash = rec("Stash", {
    dv: { winNow: 0, balanced: 3, longTerm: 20 },
    keeper: { status: "free", pKept27: null },
    elig: { now: true, next: 1, freeThrough: 2028, binding: "gp", uncertain: false },
  });
  roster.core = rec("Core", { dv: { winNow: 2, balanced: 2, longTerm: 2 }, keeper: { status: "core", pKept27: 0.9 } });
  const ids = Object.keys(roster);
  const d = dynastyDropProtection(ids, snap(roster), new Set(["r0"]));
  assert(d.protected.has("stash"), "a free-stash prospect worth ≥ 15 long-term is never dropped");
  assert(d.protected.has("core"), "keeper-core players are protected");
  assert(d.protected.has("r0"), "the season core stays protected");
  assert(d.protected.has("r15") && d.protected.has("r4"), `the ${PROTECT_TOP_N} best by balanced DV are protected`);
  assert(d.order[0] === "r1" && !d.order.includes("r0"), `drop order ascending DV (${d.order.slice(0, 3).join(",")})`);
}

// ---- the committed snapshot reads well
{
  const path = join(process.cwd(), "public", "fantrax", "dynasty.json");
  if (existsSync(path)) {
    const dyn = JSON.parse(readFileSync(path, "utf8")) as DynastySnapshot;
    const recs = Object.entries(dyn.players);
    assert(recs.length > 800, `dynasty.json has ${recs.length} players`);
    const tooLong = recs.filter(([, r]) => explainFr(r).length > 220);
    assert(tooLong.length === 0, `every explanation fits 220 characters (${tooLong.length} too long)`);
    const top = recs.sort((a, b) => a[1].rank.balanced - b[1].rank.balanced).slice(0, 5).map(([, r]) => r.n);
    assert(top.includes("Macklin Celebrini"), `Celebrini in the top 5 (${top.join(", ")})`);
  }
}

if (failed > 0) {
  console.error(`test-dynasty-plan: ${failed} failure(s)`);
  process.exit(1);
}
console.log("OK: dynasty board (market ranks, pool, need bonus, availability, drop protection, committed snapshot)");
