/**
 * Hand rank adjustments of a league board: the splice (the pasted Yahoo
 * list's algorithm), the bridged VOR, position ranks, the lineup maths that
 * read them, and the committed Light the Lamp file's shape.
 * Run: npx tsx scripts/test-rank-adjustments.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { effectiveValue, modelVor, type DraftBoard, type DraftBoardPlayer } from "../src/lib/draft/board-types";
import { rankAdjustmentText } from "../src/lib/draft/draft-copy";
import { buildLineup, lineupScore, slotVor } from "../src/lib/draft/team";
import { leagueBoardPath, rankAdjustmentsPath } from "../src/lib/leagues/board-inputs";
import { adjustBoardPlayers } from "../src/lib/leagues/league-board";
import {
  applyRankAdjustments,
  bridgeValues,
  parseRankAdjustments,
  rankAdjustmentErrors,
  type RankAdjustmentsFile,
} from "../src/lib/leagues/rank-adjustments";

const ids = (xs: readonly { id: number }[]) => xs.map((x) => x.id);
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

// 1. Remove every listed row, re-insert deepest target first: a shallower
//    re-insert pushes the deeper ones down by one each.
{
  const { order, missing } = applyRankAdjustments(
    rows(10),
    [
      { id: 2, insertAt: 8 },
      { id: 9, insertAt: 3 },
    ],
    (r) => r.id,
  );
  assert.deepEqual(missing, []);
  // Without 2 and 9: 1 3 4 5 6 7 8 10. Insert 2 at index 7 → 1 3 4 5 6 7 8 2 10,
  // then 9 at index 2 → 1 3 9 4 5 6 7 8 2 10: 2 ends at 9, one below its target.
  assert.deepEqual(ids(order), [1, 3, 9, 4, 5, 6, 7, 8, 2, 10]);
}

// 2. Same result whatever the file order; a target past the end appends;
//    unknown ids are reported, not fatal.
{
  const a = applyRankAdjustments(rows(6), [{ id: 1, insertAt: 4 }, { id: 6, insertAt: 2 }], (r) => r.id).order;
  const b = applyRankAdjustments(rows(6), [{ id: 6, insertAt: 2 }, { id: 1, insertAt: 4 }], (r) => r.id).order;
  assert.deepEqual(ids(a), ids(b), "file order does not matter");
  const end = applyRankAdjustments(rows(4), [{ id: 1, insertAt: 99 }], (r) => r.id).order;
  assert.deepEqual(ids(end), [2, 3, 4, 1], "clamped to the end");
  const miss = applyRankAdjustments(rows(3), [{ id: 42, insertAt: 1 }], (r) => r.id);
  assert.deepEqual(miss.missing, [42]);
  assert.deepEqual(ids(miss.order), [1, 2, 3]);
}

// 3. Bridged values: evenly spaced between the unadjusted neighbours; runs at an end take their one neighbour.
{
  const v = bridgeValues([10, 99, 99, 4, 3, -7], [false, true, true, false, false, true]);
  assert.deepEqual(v.map((x) => Math.round(x * 100) / 100), [10, 8, 6, 4, 3, 3]);
  assert.deepEqual(bridgeValues([-5, 9], [true, false]), [9, 9], "top run takes the value below");
}

// 4. Board rows: rank, bridged VOR, marks, position ranks, lineup value.
{
  const mk = (id: number, pos: DraftBoardPlayer["pos"], vor: number, rank: number, posRank: DraftBoardPlayer["posRank"]): DraftBoardPlayer => ({
    id,
    name: `P${id}`,
    team: "MTL",
    pos,
    age: 25,
    gp: 80,
    proj: [],
    z: [],
    value: vor - 4,
    vor,
    vorPos: pos[0]!,
    rank,
    posRank,
    adp: null,
  });
  const engine = [
    mk(1, ["C"], 9, 1, { C: 1, F: 1 }),
    mk(2, ["D"], 8, 2, { D: 1 }),
    mk(3, ["C"], 7, 3, { C: 2, F: 2 }),
    mk(4, ["D"], 6, 4, { D: 2 }),
    mk(5, ["C", "LW"], 2, 5, { C: 3, LW: 1, F: 3 }),
    mk(6, ["D"], 1, 6, { D: 3 }),
  ];
  const file: RankAdjustmentsFile = {
    schema: 1,
    league: "test",
    decidedAt: "2026-09-27",
    adjustments: [{ id: 5, name: "P5", engineRank: 5, insertAt: 2, reason: "Matchs sous-estimés (test)." }],
  };
  const { players, missing } = adjustBoardPlayers(engine, file);
  assert.deepEqual(missing, []);
  assert.deepEqual(ids(players), [1, 5, 2, 3, 4, 6]);
  assert.deepEqual(players.map((p) => p.rank), [1, 2, 3, 4, 5, 6]);
  const p5 = players[1]!;
  assert.equal(p5.vor, 8.5, "bridged between 9 and 8");
  assert.deepEqual(p5.adjusted, { fromRank: 5, vorModel: 2, reason: "Matchs sous-estimés (test)." });
  assert.equal(modelVor(p5), 2);
  assert.equal(effectiveValue(p5), p5.value + 6.5, "value moves with the VOR");
  assert.equal(effectiveValue(players[0]!), players[0]!.value, "unadjusted rows keep their value");
  assert.deepEqual(p5.posRank, { C: 2, LW: 1, F: 2 }, "C 3 → 2 (ahead of P3), F likewise");
  assert.deepEqual(players[3]!.posRank, { C: 3, F: 3 }, "P3 pushed down one");
  assert.deepEqual(players[2]!.posRank, { D: 1 }, "D ranks untouched");
  assert.equal(engine[4]!.rank, 5, "engine rows are not mutated");
  assert.deepEqual(engine[4]!.posRank, { C: 3, LW: 1, F: 3 });
  assert.equal(players[0]!.adjusted, undefined);
  // Nothing to adjust: the same rows.
  assert.deepEqual(adjustBoardPlayers(engine, null).players, engine);
  // The copy the badge shows.
  assert.equal(
    rankAdjustmentText(p5.adjusted!),
    "Rang ajusté à la main (modèle : 5e, VOR 2,00). Matchs sous-estimés (test).",
  );

  // Ranks are the engine's slots, reordered: a goalie the goalie floor keeps
  // past BOARD_DEPTH (engine rank 437, G 51) keeps 437 and G 51 — not his
  // list index — so the availability odds that read the rank do not move.
  const tail = [
    mk(1, ["C"], 9, 1, { C: 1, F: 1 }),
    mk(2, ["C"], 8, 2, { C: 2, F: 2 }),
    mk(3, ["G"], 7, 3, { G: 50 }),
    mk(9, ["G"], -3, 437, { G: 51 }),
  ];
  const moved = adjustBoardPlayers(tail, {
    ...file,
    adjustments: [{ id: 3, name: "P3", engineRank: 3, insertAt: 1, reason: "Test de la queue de gardiens." }],
  }).players;
  assert.deepEqual(ids(moved), [3, 1, 2, 9]);
  assert.deepEqual(moved.map((p) => p.rank), [1, 2, 3, 437], "tail goalie keeps his engine rank");
  assert.deepEqual(moved.map((p) => p.posRank.G ?? null), [50, null, null, 51], "G ranks keep their slots");
  assert.deepEqual(adjustBoardPlayers(tail, null).players.map((p) => p.rank), [1, 2, 3, 437]);
}

// 5. File shape errors.
{
  const ok = {
    schema: 1,
    league: "x",
    decidedAt: "2026-09-27",
    adjustments: [{ id: 1, name: "A", engineRank: 3, insertAt: 1, reason: "Une raison assez longue." }],
  };
  assert.deepEqual(rankAdjustmentErrors(ok, "x"), []);
  assert.ok(rankAdjustmentErrors(ok, "y").some((e) => e.startsWith("league")));
  const dup = { ...ok, adjustments: [ok.adjustments[0], { ...ok.adjustments[0], insertAt: 2 }] };
  assert.ok(rankAdjustmentErrors(dup, "x").some((e) => e.includes("duplicate id")));
  const sameTarget = { ...ok, adjustments: [ok.adjustments[0], { ...ok.adjustments[0], id: 2 }] };
  assert.ok(rankAdjustmentErrors(sameTarget, "x").some((e) => e.includes("duplicate insertAt")));
  const noReason = { ...ok, adjustments: [{ ...ok.adjustments[0], reason: " " }] };
  assert.ok(rankAdjustmentErrors(noReason, "x").some((e) => e.includes("reason")));
  const badRank = { ...ok, adjustments: [{ ...ok.adjustments[0], insertAt: 0 }] };
  assert.ok(rankAdjustmentErrors(badRank, "x").some((e) => e.includes("insertAt")));
  assert.throws(() => parseRankAdjustments(noReason, "x"), /reason/);
}

// 6. The committed Light the Lamp file parses (ids on the board: check:draft-board).
{
  const slug = "light-the-lamp";
  const file = parseRankAdjustments(JSON.parse(readFileSync(rankAdjustmentsPath(slug), "utf8")), slug);
  assert.ok(file.adjustments.length > 0);
  for (const a of file.adjustments) assert.ok(/[a-zé]/.test(a.reason), `${a.name}: French reason`);
}

// 7. The committed board: a VOR sort (ties by rank, as the table breaks
//    them) is the rank order, and the lineup maths count a hand-moved row
//    at his published VOR.
{
  const board = JSON.parse(readFileSync(leagueBoardPath("light-the-lamp"), "utf8")) as DraftBoard;
  // The SV% shrink the method note explains is published with the board.
  const sv = board.goalieSavePctShrink;
  assert.ok(sv.factor > 1 && sv.spread > sv.skillSd && sv.mean > 0.89 && sv.mean < 0.92, "SV% shrink published");
  const byVor = [...board.players].sort((a, b) => b.vor - a.vor || a.rank - b.rank);
  assert.deepEqual(ids(byVor), ids(board.players), "VOR sort = rank order");
  for (const p of board.players.filter((x) => x.adjusted)) {
    assert.ok(Math.abs(slotVor(board, p, p.vorPos) - p.vor) < 0.011, `${p.name}: slot VOR at ${p.vorPos} = published VOR`);
    const alone = lineupScore(board, buildLineup(board, [p]));
    assert.ok(Math.abs(alone - Math.max(0, p.vor)) < 0.011, `${p.name}: alone in a lineup he is worth his published VOR`);
  }
}

console.log("OK: rank adjustments");
