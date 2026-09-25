/**
 * My-team lineup, category strength and pick suggestions on the committed
 * Light the Lamp board.
 * Run: npx tsx scripts/test-draft-team.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import { groupRelativeZ, type DraftBoard, type DraftBoardPlayer } from "../src/lib/draft/board-types";
import { myPickNumbers } from "../src/lib/draft/snake";
import { EMPTY_DRAFT_STATE, markPick, setDraftSlot, type DraftState } from "../src/lib/draft/draft-state";
import { draftTimeline, suggestPicks } from "../src/lib/draft/suggestions";
import {
  BENCH_GOALIE_SHARES,
  BENCH_SKATER_SHARE,
  buildLineup,
  categoryTargets,
  filledStarterCount,
  lineupScore,
  startingSeatCount,
  teamCategoryStrength,
} from "../src/lib/draft/team";

const board = JSON.parse(
  readFileSync(join(process.cwd(), "public/leagues/light-the-lamp/board.json"), "utf8"),
) as DraftBoard;
const byName = (name: string): DraftBoardPlayer => {
  const p = board.players.find((x) => x.name === name);
  if (!p) throw new Error(`missing ${name}`);
  return p;
};
const pick = (state: DraftState, names: string[], mine: boolean) =>
  names.reduce((s, n) => markPick(s, byName(n).id, mine), state);

assert.equal(startingSeatCount(board), 14);

// Lineup: exact seating with flex.
{
  const cs = board.players.filter((p) => p.pos.length === 1 && p.pos[0] === "C").slice(0, 4);
  const lineup = buildLineup(board, cs);
  assert.equal(lineup.starters.C.length, 2, "two C seats");
  assert.equal(lineup.starters.F.length, 1, "third C → F");
  assert.equal(lineup.starters.Util.length, 1, "fourth C → Util");
  assert.equal(lineup.bench.length, 0);
  assert.deepEqual(
    lineup.starters.C.map((p) => p.id),
    cs.slice(0, 2).map((p) => p.id),
    "best two keep the C seats",
  );
  const d = board.players.filter((p) => p.pos.includes("D")).slice(0, 6);
  const lineupD = buildLineup(board, d);
  assert.equal(lineupD.starters.D.length, 4);
  assert.equal(lineupD.starters.Util.length, 1, "fifth D → Util");
  assert.equal(lineupD.bench.length, 1, "sixth D → bench");
  assert.equal(filledStarterCount(lineupD), 5);
}

// Strength: an empty team is exactly average; picks move their categories.
{
  const empty = teamCategoryStrength(board, buildLineup(board, []));
  assert.equal(empty.length, board.categories.skater.length + board.categories.goalie.length);
  for (const s of empty) {
    assert.ok(Math.abs(s.diff) < 1e-9, `empty team diff ${s.cat}`);
    assert.ok(Math.abs(s.mineTotal - s.averageTotal) < 1e-6, `empty team total ${s.cat}`);
  }
  const blocker = board.players.find((p) => p.pos.includes("D") && p.z[5]! > 4)!;
  const withD = teamCategoryStrength(board, buildLineup(board, [blocker]));
  const blk = withD.find((s) => s.cat === "blocks")!;
  assert.ok(blk.diff > 0, "a big blocker lifts BLK");
  const g = board.players.find((p) => p.pos.includes("G"))!;
  const withG = teamCategoryStrength(board, buildLineup(board, [g]));
  const sv = withG.find((s) => s.cat === "savePct")!;
  assert.ok(sv.mineTotal > sv.averageTotal, "elite goalie raises team SV%");
  const gaa = withG.find((s) => s.cat === "goalsAgainstAverage")!;
  assert.ok(gaa.mineTotal < gaa.averageTotal && gaa.diff > 0, "…and lowers GAA (positive diff)");
  const snipers = board.players.filter((p) => !p.pos.includes("G") && !p.pos.includes("D")).slice(0, 7);
  const targets = categoryTargets(teamCategoryStrength(board, buildLineup(board, snipers)));
  assert.ok(targets.includes("blocks"), `seven top forwards → target BLK (${targets})`);
}

// A seat is only filled when the player beats its waiver replacement: a
// fifth D below the Util level sits on the bench (bench share), not at Util
// with a negative slot VOR.
{
  const util = board.replacement.Util!;
  const fourD = board.players.filter((p) => p.pos.includes("D")).slice(0, 4);
  const weakD = board.players.find((p) => p.pos.includes("D") && p.vor > 0 && p.value < util)!;
  assert.ok(weakD, "a positive-VOR D below the Util replacement exists");
  const roster = [...fourD, ...board.players.filter((p) => p.pos.includes("C")).slice(0, 2)];
  const before = lineupScore(board, buildLineup(board, roster));
  const lineup = buildLineup(board, [...roster, weakD]);
  assert.equal(lineup.starters.Util.length, 0, "Util left to waivers");
  assert.ok(lineup.bench.some((p) => p.id === weakD.id), "weak fifth D benched");
  const gain = lineupScore(board, lineup) - before;
  assert.ok(Math.abs(gain - BENCH_SKATER_SHARE * weakD.vor) < 1e-9, `gain = bench share (${gain})`);
  // Two such D for the last D seat + Util: the better one keeps the D
  // seat, the other is benched (Util stays with waivers).
  const [hi, lo] = board.players.filter((p) => p.pos.includes("D") && p.vor > 0 && p.value < util).slice(0, 2);
  const strongD = board.players.filter((p) => p.pos.includes("D")).slice(0, 3);
  for (const order of [[lo!, hi!], [hi!, lo!]]) {
    const pair = buildLineup(board, [...strongD, ...order]);
    assert.ok(pair.starters.D.some((p) => p.id === hi!.id), "better weak D keeps the D seat");
    assert.ok(pair.bench.some((p) => p.id === lo!.id), "worse weak D benched");
    assert.equal(pair.starters.Util.length, 0);
  }
  for (const slot of ["C", "LW", "RW", "F", "D", "Util", "G"] as const) {
    for (const p of lineup.starters[slot]) {
      assert.ok(p.value - (board.replacement[slot] ?? 0) >= 0, `${p.name} seated at ${slot} below replacement`);
    }
  }
}

// Lineup score: empty seats = 0, bench shares.
{
  assert.equal(lineupScore(board, buildLineup(board, [])), 0);
  const goalies = board.players.filter((p) => p.pos.includes("G")).slice(0, 4);
  const two = lineupScore(board, buildLineup(board, goalies.slice(0, 2)));
  const three = lineupScore(board, buildLineup(board, goalies.slice(0, 3)));
  assert.ok(
    Math.abs(three - two - BENCH_GOALIE_SHARES[0] * goalies[2]!.vor) < 1e-9,
    "third goalie counts at the bench-goalie share",
  );
  const four = lineupScore(board, buildLineup(board, goalies));
  assert.ok(Math.abs(four - three - BENCH_GOALIE_SHARES[1] * goalies[3]!.vor) < 1e-9);
  assert.ok(BENCH_SKATER_SHARE > 0 && BENCH_SKATER_SHARE < 1);
}

// Timeline.
{
  let s = setDraftSlot(EMPTY_DRAFT_STATE, 12, 12);
  let t = draftTimeline(board, s);
  assert.equal(t.targetPick, 12);
  assert.equal(t.followingPick, 13);
  assert.equal(t.onTheClock, false);
  s = pick(s, board.players.slice(0, 11).map((p) => p.name), false);
  t = draftTimeline(board, s);
  assert.equal(t.currentPick, 12);
  assert.equal(t.onTheClock, true, "12th pick of slot 12 is ours");
  const noSlot = draftTimeline(board, EMPTY_DRAFT_STATE);
  assert.equal(noSlot.targetPick, null);
  assert.equal(noSlot.onTheClock, false);
}

// Suggestions.
{
  const first = suggestPicks(board, setDraftSlot(EMPTY_DRAFT_STATE, 1, 12));
  assert.equal(first.timeline.onTheClock, true);
  assert.equal(first.suggestions.length, 5);
  assert.equal(first.suggestions[0]!.player.rank, 1, "pick 1: best VOR on the board");

  const last = suggestPicks(board, setDraftSlot(EMPTY_DRAFT_STATE, 12, 12));
  assert.equal(last.timeline.onTheClock, false);
  for (const sug of last.suggestions) {
    assert.ok(sug.availability >= 0.2, `${sug.player.name} likely there at pick 12`);
  }
  assert.ok(
    !last.suggestions.some((x) => x.player.name === "Nathan MacKinnon"),
    "MacKinnon (ADP 1.5) is not suggested for pick 12",
  );

  // Goalie slots full → a third goalie only earns his bench share, so
  // suggestions turn to open skater seats.
  const goalies = board.players.filter((p) => p.pos.includes("G")).slice(0, 2).map((p) => p.name);
  let s = setDraftSlot(EMPTY_DRAFT_STATE, 1, 12);
  s = pick(s, goalies, true);
  const r = suggestPicks(board, s, 20);
  const g3 = r.suggestions.find((x) => x.player.pos.includes("G"));
  if (g3) {
    assert.equal(g3.seatedAs, "BN");
    assert.ok(g3.gain <= BENCH_GOALIE_SHARES[0] * g3.player.vor + 1e-9);
  }
  assert.ok(!r.suggestions[0]!.player.pos.includes("G"), "top suggestion is a skater");

  // Full forward seats (C2 LW2 RW2 F Util) → an open D seat wins.
  const fwd = board.players
    .filter((p) => !p.pos.includes("G") && !p.pos.includes("D"))
    .slice(0, 8)
    .map((p) => p.name);
  let t = setDraftSlot(EMPTY_DRAFT_STATE, 1, 12);
  t = pick(t, fwd, true);
  const lineup = buildLineup(
    board,
    fwd.map((n) => byName(n)),
  );
  assert.equal(lineup.starters.Util.length, 1, "Util taken by a forward");
  const top = suggestPicks(board, t).suggestions[0]!;
  assert.ok(
    top.player.pos.includes("D") || top.player.pos.includes("G"),
    `forwards full → D or G suggested (${top.player.name})`,
  );
  for (const sug of suggestPicks(board, t, 10).suggestions) {
    assert.ok(Number.isFinite(sug.score) && sug.score >= 0, "finite, non-negative scores");
    assert.ok(sug.scarcity >= 0 && sug.balance >= 0);
  }
}

// Balance rewards what a pick changes in our weak categories, not raw z
// (which carries the F/D offset): a D who is below the average D seat in
// the weak categories gets no balance for filling a D seat.
{
  const mineNames = ["Nikita Kucherov", "Kyle Connor", "Artemi Panarin", "Cole Caufield"];
  const mineIds = new Set(mineNames.map((n) => byName(n).id));
  const others = board.players.filter((p) => !mineIds.has(p.id));
  const mp = myPickNumbers(6, 12, 18);
  let s = setDraftSlot(EMPTY_DRAFT_STATE, 6, 12);
  let oi = 0;
  let mi = 0;
  for (let n = 1; n < 54; n++) {
    s = mp.includes(n) ? markPick(s, byName(mineNames[mi++]!).id, true) : markPick(s, others[oi++]!.id, false);
  }
  const r = suggestPicks(board, s, 60);
  assert.ok(r.timeline.onTheClock);
  const weak = new Set(r.strength.filter((x) => x.diff < 0).map((x) => x.cat));
  assert.ok(weak.has("hits") && weak.has("blocks"), "four scorers → weak HIT and BLK");
  const avgD = board.averageTeam.slots.D!.z;
  const catIdx = (c: string) => board.categories.skater.indexOf(c as never);
  let checked = 0;
  for (const sug of r.suggestions) {
    if (sug.seatedAs === "BN") assert.equal(sug.balance, 0, "a benched pick changes nothing");
    if (sug.seatedAs !== "D") continue;
    const p = sug.player;
    const below = [...weak].every((c) => p.z[catIdx(c)]! <= avgD[catIdx(c)]!);
    if (below) {
      assert.equal(sug.balance, 0, `${p.name}: no balance bonus below the average D seat`);
      checked++;
    }
  }
  assert.ok(checked > 0, "at least one below-average-in-weak-cats D was checked");
  const heiskanen = r.suggestions.find((x) => x.player.name === "Miro Heiskanen");
  if (heiskanen) assert.equal(heiskanen.balance, 0);
}

// Group-relative bars: a D's blocks are measured against defensemen.
{
  const d = board.players.find((p) => p.pos.includes("D"))!;
  const rel = groupRelativeZ(board, d);
  const i = board.categories.skater.indexOf("blocks");
  assert.ok(Math.abs(rel[i]! - (d.z[i]! - board.skaterGroupOffset.D[i]!)) < 0.011);
  const g = board.players.find((p) => p.pos.includes("G"))!;
  assert.deepEqual(groupRelativeZ(board, g), g.z, "goalies unchanged");
  const maxRel = Math.max(
    ...board.players
      .filter((p) => !p.pos.includes("G"))
      .map((p) => Math.max(groupRelativeZ(board, p)[catIdxOf("hits")]!, groupRelativeZ(board, p)[catIdxOf("blocks")]!)),
  );
  assert.ok(maxRel < 2.75 + 0.01, `HIT/BLK soft cap holds relative to peers (${maxRel})`);
}
function catIdxOf(c: string): number {
  return board.categories.skater.indexOf(c as never);
}

console.log("OK: draft-team");
