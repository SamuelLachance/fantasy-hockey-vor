/**
 * The Slapshot live draft board and Mon équipe cap helpers
 * (src/lib/fantrax/slapshot-draft.ts): my players from the live roster plus
 * picks not on it yet, the empty seats of C4 LW4 RW4 D6 G2 filled optimally
 * (a multi-eligible player where he opens the most room), the best available
 * per position by dynasty value in the page's mode, the cap use with picks
 * counted as Active, and the cheapest players to stash in the minors.
 * Also: the Slapshot client copy parses into the shared dynasty index.
 * Run: npx tsx scripts/test-slapshot-draft.ts
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { SLAPSHOT } from "../src/lib/fantrax/config";
import { parseDynasty } from "../src/lib/fantrax/dynasty-index";
import type { ContractsFile } from "../src/lib/fantrax/salary-cap";
import { slapshotContracts, type SlapshotSnapshotLike } from "../src/lib/dynasty/slapshot-client";
import { seatNeeds, type SeatNeedsResult } from "../src/lib/fantrax/seat-needs";
import { bestAvailable, draftBoardView, draftSeatNeeds, myDraftPlayers, stashCandidates, type MyDraftPlayer } from "../src/lib/fantrax/slapshot-draft";
import type { FantraxRow } from "../src/lib/fantrax/table";
import type { DynastyRecord } from "../src/lib/dynasty/types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const dynRec = (dv: number, cap: number[], signed = cap.length): DynastyRecord =>
  ({
    n: "x",
    dv: { winNow: dv / 2, balanced: dv, longTerm: dv * 2 },
    rank: { winNow: 1, balanced: 1, longTerm: 1 },
    contract: { cap, signed, expiry: null, status: null, nextAav: null, elc: false, capFP: [0, 0, 0] },
  }) as unknown as DynastyRecord;

const row = (id: string, groups: string[], over: Partial<FantraxRow> = {}): FantraxRow =>
  ({
    id,
    name: id,
    search: id,
    team: "",
    groups,
    age: null,
    birthDate: null,
    owner: null,
    rosterStatus: null,
    free: "FA",
    minorsEligible: false,
    injured: false,
    playing: true,
    icons: [],
    ros: null,
    adp: null,
    nhlDraft: null,
    fp: null,
    fpg: null,
    gp: null,
    value: null,
    vona: null,
    available: null,
    src: "p",
    nhl: null,
    dynasty: null,
    dynZero: false,
    snake: null,
    ...over,
  }) as FantraxRow;

// ---- seats: a C/LW goes where he opens room; LW/RW wingers make the wings one pool
const p = (id: string, groups: string[], fp: number, status = "ACTIVE"): MyDraftPlayer => ({
  id,
  name: id,
  groups,
  status,
  dyn: fp,
  rank: null,
  cap: [null, null],
  signed: 0,
  src: "p",
  fp,
  dynB: fp,
});
{
  const mine = [p("c1", ["C"], 900), p("c2", ["C"], 800), p("c3", ["C"], 700), p("c4", ["C"], 600), p("flex", ["C", "LW"], 500), p("d1", ["D"], 400)];
  const n = draftSeatNeeds(mine, SLAPSHOT.slots.order, SLAPSHOT.slots.counts);
  assert(n.slots.C!.filled === 4 && n.slots.LW!.filled === 1 && n.seatOf.flex === "LW", "the C/LW fills LW once C is full");
  assert(n.slots.RW!.empty === 4 && n.slots.D!.empty === 5 && n.slots.G!.empty === 2, "empty seats per position");
  assert(n.wing!.filled === 1 && n.wing!.empty === 7 && n.wing!.lw === 3 && n.wing!.rw === 4, `wings 1/8, 3 more LW, 4 more RW (${JSON.stringify(n.wing)})`);
}
{
  // The roster of the issue: two LW/RW wingers (Gauthier, Neighbours) and two
  // LW-only. The old card said « LW 4/4 complet, RW 0/4 »; the page, LW 3/4 RW 1/4.
  const mine = [p("gauthier", ["LW", "RW"], 250), p("neighbours", ["LW", "RW"], 180), p("lw1", ["LW"], 200), p("lw2", ["LW"], 150), p("pros", ["C"], 0, "MINORS"), p("hurt", ["RW"], 90, "INJURED_RESERVE")];
  const n = draftSeatNeeds(mine, SLAPSHOT.slots.order, SLAPSHOT.slots.counts);
  const w = n.wing!;
  assert(w.filled === 4 && w.max === 8 && w.empty === 4, `wings 4/8, 4 to fill (${JSON.stringify(w)})`);
  assert(w.flex === 2 && w.lw === 2 && w.rw === 4, `a LW still fits twice (the LW/RW move right), a RW four times (${JSON.stringify(w)})`);
  assert(n.slots.C!.filled === 0 && n.slots.RW!.filled + n.slots.LW!.filled === 4, "minors and IR hold no starting seat");
  // Four LW-only and two LW/RW: the LW/RW go right, and a fifth LW-only has no seat.
  const full = draftSeatNeeds([...mine, p("lw3", ["LW"], 140), p("lw4", ["LW"], 130)], SLAPSHOT.slots.order, SLAPSHOT.slots.counts);
  assert(full.wing!.filled === 6 && full.wing!.lw === 0 && full.wing!.rw === 2, `LW full once four LW-only sit there (${JSON.stringify(full.wing)})`);
}

// ---- the stand-alone page runs the SAME seat fill (its plain-JS copy in the template)
{
  const html = readFileSync(join(process.cwd(), "scripts", "slapshot-draft", "template.html"), "utf8").replace(/\r\n/g, "\n");
  const start = html.indexOf("  function seatNeeds(players, slots) {");
  const end = html.indexOf("\n  }\n", start);
  assert(start > 0 && end > start, "the template carries function seatNeeds");
  const pageSeatNeeds = new Function(`${html.slice(start, end + 4)}; return seatNeeds;`)() as (
    players: Array<{ id: string; pos: string[] }>,
    slots: Record<string, number>,
  ) => SeatNeedsResult;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const SHAPES = [["C"], ["LW"], ["RW"], ["D"], ["G"], ["LW", "RW"], ["C", "LW"], ["C", "RW"], ["C", "LW", "RW"], ["D", "LW"]];
  const slots = Object.fromEntries(SLAPSHOT.slots.order.map((s) => [s, SLAPSHOT.slots.counts[s] ?? 0]));
  assert(JSON.stringify(Object.keys(slots)) === JSON.stringify(["C", "LW", "RW", "D", "G"]), "the site's slot order is the page's");
  let same = 0;
  for (let k = 0; k < 400; k++) {
    const n = 1 + Math.floor(rnd() * 30);
    const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, pos: SHAPES[Math.floor(rnd() * SHAPES.length)]! }));
    const a = JSON.stringify(seatNeeds(players, slots));
    const b = JSON.stringify(pageSeatNeeds(players, { C: 4, LW: 4, RW: 4, D: 6, G: 2 }));
    if (a === b) same++;
    else if (same === k) console.error(`first difference: ${JSON.stringify(players)}\n site ${a}\n page ${b}`);
  }
  assert(same === 400, `site and page seat fills agree on 400 random rosters (${same})`);
}

// ---- a zero-value player's cap hit comes from the contracts file
{
  const file: ContractsFile = {
    builtAt: "",
    firstSeason: 2026,
    cap: [105],
    min: [0.85],
    nhl: [104],
    growthAfter: 0.05,
    announced: [2026],
    lambda: [1],
    players: { z: { c: [1.5, 1.5], s: 2, x: null, st: "UFA" } },
  };
  const m = myDraftPlayers([row("z", ["C"], { dynZero: true })], [{ id: "z", status: "ACTIVE" }], [], "balanced", 2, file);
  assert(m[0]!.cap[0] === 1.5 && m[0]!.cap[1] === 1.5 && m[0]!.signed === 2, `zero-value: cap from contracts.json (${JSON.stringify(m[0]!.cap)})`);
  const full = {
    builtAt: "t",
    season: "2026-27",
    params: { cap: { league: [105], nhl: [104], min: [0.85], growthAfter: 0.05 }, lambda: [1] },
    players: { v: { contract: { cap: [2, 2], signed: 2, expiry: null, status: "UFA", elc: false } } },
    zero: ["z"],
    zeroContracts: { z: { cap: [1.5, 1.5], signed: 1, expiry: 2027, status: "RFA", elc: false } },
  } as unknown as SlapshotSnapshotLike;
  const c = slapshotContracts(full, 2026, [2026]);
  assert(!!c.players.v && !!c.players.z && c.players.z.c[0] === 1.5 && c.players.z.x === 2027, "contracts.json: valued and zero-value players alike");
}

// ---- best available: nobody's, by dynasty value in the mode
{
  const rows = [
    row("a", ["C"], { dynasty: dynRec(100, [1]) }),
    row("b", ["C"], { dynasty: dynRec(300, [1]), owner: "t1" }),
    row("c", ["C", "LW"], { dynasty: dynRec(200, [1]) }),
    row("g", ["G"], { dynasty: dynRec(50, [1]) }),
  ];
  const best = bestAvailable(rows, ["C", "LW", "G"], "balanced", 2);
  assert(best[0]!.rows.map((r) => r.id).join() === "c,a", `C: c then a, owned b left out (${best[0]!.rows.map((r) => r.id)})`);
  assert(best[1]!.rows[0]!.id === "c" && best[2]!.rows[0]!.id === "g", "LW and G");
}

// ---- the whole board: picks not on the roster yet count as Active for the cap
const contracts: ContractsFile = {
  builtAt: "",
  firstSeason: 2026,
  cap: [105, 114.591],
  min: [0.85, 0.928],
  nhl: [104, 113.5],
  growthAfter: 0.05,
  announced: [2026, 2027],
  lambda: [1.3, 0.2],
  players: {
    star: { c: [12, 12], s: 2, x: null, st: "UFA" },
    kid: { c: [0.98, 0.98], s: 0, x: 2026, st: "RFA" },
    vet: { c: [9, 9], s: 1, x: 2027, st: "UFA" },
    minor: { c: [5, 5], s: 2, x: null, st: "UFA" },
  },
};
{
  const rows = [
    row("star", ["RW"], { owner: "me", dynasty: dynRec(500, [12, 12]), value: 150 }),
    row("kid", ["C"], { owner: "me", dynasty: dynRec(200, [0.98, 0.98], 0), value: 0, src: "e" }),
    row("vet", ["D"], { owner: "me", dynasty: dynRec(100, [9, 9], 1), value: 5 }),
    row("minor", ["LW"], { owner: "me", dynasty: dynRec(80, [5, 5]), value: 60 }),
  ];
  const v = draftBoardView({
    rows,
    roster: [
      { id: "star", status: "ACTIVE" },
      { id: "vet", status: "RESERVE" },
      { id: "minor", status: "MINORS" },
    ],
    myPicks: ["kid", "star"],
    mode: "balanced",
    order: SLAPSHOT.slots.order,
    counts: SLAPSHOT.slots.counts,
    groups: SLAPSHOT.eligibility.groups,
    contracts,
    rules: SLAPSHOT.salaryCap,
  });
  assert(v.mine.length === 4 && v.mine[0]!.id === "star" && v.mine.find((p) => p.id === "kid")?.status === "PICK", "roster + picks, best first");
  assert(Math.abs(v.salary!.used[0]! - (12 + 9 + 0.98)) < 1e-9, `cap use counts the pick, not the minors (${v.salary!.used[0]})`);
  assert(v.salary!.counted === 3 && v.roomPerSpot !== null && Math.abs(v.roomPerSpot - Math.round(((105 - 21.98) / 20) * 100) / 100) < 1e-9, "room per open counted spot");

  const s = stashCandidates(rows, [{ id: "star", status: "ACTIVE" }, { id: "vet", status: "RESERVE" }, { id: "kid", status: "ACTIVE" }, { id: "minor", status: "MINORS" }], SLAPSHOT.salaryCap!, contracts);
  assert(s.map((c) => c.id).join() === "kid,vet,star", `cheapest points per M$ first, minors left out (${s.map((c) => c.id)})`);
  assert(s.find((c) => c.id === "vet")!.netNegative && !s.find((c) => c.id === "star")!.netNegative, "the charge beats a 5-point player, not a 150-point one");
}

// ---- the published client copy reads as a dynasty index
{
  const f = join(process.cwd(), "public", "fantrax", "slapshot", "dynasty-table.json");
  if (existsSync(f)) {
    const idx = parseDynasty(JSON.parse(readFileSync(f, "utf8")));
    assert(!!idx && idx.byFantrax.size > 800, `Slapshot copy parses (${idx?.byFantrax.size ?? 0} records)`);
    const any = idx ? [...idx.byFantrax.values()][0] : undefined;
    assert(!!any?.contract && Array.isArray(any.contract.cap) && !!any.explanation, "records carry the contract and the sentence");
    assert(any?.elig.now === false, "no minors eligibility in a league without a cutdown");
  }
}

if (failed) process.exit(1);
console.log("OK: Slapshot draft board (seats, best available, cap with picks, stash list, client copy)");
