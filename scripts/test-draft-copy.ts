/**
 * French formatting + board filtering for the draft helper.
 * Run: npx tsx scripts/test-draft-copy.ts
 */
import assert from "node:assert/strict";
import {
  displayRank,
  draftRows,
  matchesDraftFilter,
  matchesDraftQuery,
} from "../src/lib/draft/board-filter";
import type { DraftBoardPlayer } from "../src/lib/draft/board-types";
import {
  CATEGORY_FR,
  CATEGORY_SHORT,
  DRAFT_SHORTCUTS,
  pickOwnerMismatch,
  formatClock,
  formatDateFr,
  formatDraftStartFr,
  formatFr,
  formatPercentFr,
  formatSignedFr,
  formatStat,
  pickLabel,
  picksAwayLabel,
} from "../src/lib/draft/draft-copy";
import { EMPTY_DRAFT_STATE, markPick } from "../src/lib/draft/draft-state";

const NBSP = String.fromCharCode(0xa0);
assert.equal(formatFr(2468.67, 0), `2${NBSP}469`);
assert.equal(formatFr(9.8, 2), "9,80");
assert.equal(formatFr(-0.04, 1), "0,0", "no negative zero");
assert.equal(formatFr(-3.25, 1), "−3,3");
assert.equal(formatSignedFr(2.44), "+2,4");
assert.equal(formatSignedFr(-0.8), "−0,8");
assert.equal(formatSignedFr(0), "0,0");
assert.equal(formatPercentFr(0.643), `64${NBSP}%`);
assert.equal(formatStat("savePct", 0.9224), "0,922");
assert.equal(formatStat("goalsAgainstAverage", 2.004), "2,00");
assert.equal(formatStat("shots", 326), "326");
assert.equal(formatStat("shutouts", 2.46), "2,5", "smoothed shutouts keep one decimal");
// No bare-letter shortcut: letters typed outside a field go to the search.
for (const s of DRAFT_SHORTCUTS) {
  assert.ok(!/^[A-Za-z]$/.test(s.keys), `bare letter shortcut ${s.keys}`);
  assert.ok(!/\bU\b|\bH\b/.test(s.keys), `no U/H shortcut (${s.keys})`);
}
// Pick owner vs snake order.
assert.equal(pickOwnerMismatch(12, 12, true), null);
assert.equal(pickOwnerMismatch(12, 12, false), "my-pick-marked-other");
assert.equal(pickOwnerMismatch(3, 12, true), "marked-mine-not-my-pick");
assert.equal(pickOwnerMismatch(3, null, true), null, "no slot → no warning");
assert.equal(pickLabel(12), `n°${NBSP}12`);
assert.equal(picksAwayLabel(0), "maintenant");
assert.equal(picksAwayLabel(3), `dans 3${NBSP}choix`);
assert.equal(formatClock(75), "1:15");
assert.equal(formatClock(9.7), "0:09");
assert.equal(
  formatDraftStartFr("2026-09-27T14:00:00-04:00"),
  `dimanche 27 septembre 2026, 14${NBSP}h (HAE)`,
);
assert.equal(formatDraftStartFr("2026-12-05T19:30:00-05:00"), `samedi 5 décembre 2026, 19${NBSP}h${NBSP}30 (HNE)`);
assert.equal(formatDateFr("2026-08-11T06:13:44.311Z"), "11 août 2026");
for (const cat of ["goals", "assists", "powerplayPoints", "shots", "hits", "blocks", "wins", "goalsAgainstAverage", "savePct", "shutouts"] as const) {
  assert.ok(CATEGORY_SHORT[cat] && CATEGORY_FR[cat], `labels for ${cat}`);
}
assert.equal(CATEGORY_SHORT.goalsAgainstAverage, "GAA", "Yahoo abbreviations");

// Filtering.
const mk = (id: number, name: string, pos: DraftBoardPlayer["pos"], rank: number): DraftBoardPlayer => ({
  id,
  name,
  team: "MTL",
  pos,
  age: 25,
  gp: 80,
  proj: [],
  z: [],
  value: 0,
  vor: 10 - rank,
  vorPos: pos[0]!,
  rank,
  posRank: Object.fromEntries(pos.map((p) => [p, rank + 1])),
  adp: null,
});
const players = [
  mk(1, "Tim Stützle", ["C", "LW"], 1),
  mk(2, "Lane Hutson", ["D"], 2),
  mk(3, "Jakub Dobeš", ["G"], 3),
  mk(4, "Juraj Slafkovský", ["LW", "RW"], 4),
];
assert.ok(matchesDraftFilter(players[0]!, "F"));
assert.ok(!matchesDraftFilter(players[1]!, "F"));
assert.ok(matchesDraftFilter(players[3]!, "RW"));
assert.ok(matchesDraftQuery(players[0]!, "stutz"), "accent-insensitive");
assert.ok(matchesDraftQuery(players[3]!, "slaf mtl"), "name + team words");
assert.ok(!matchesDraftQuery(players[3]!, "slaf tor"));
// Punctuation folds away on both sides (iOS smart quotes included).
const jt = mk(5, "J.T. Miller", ["C"], 5);
const oreilly = mk(6, "Ryan O'Reilly", ["C"], 6);
const oel = mk(7, "Oliver Ekman-Larsson", ["D"], 7);
for (const q of ["jt miller", "j.t. miller", "JT"]) assert.ok(matchesDraftQuery(jt, q), q);
for (const q of ["oreilly", "o'reilly", "o\u2019reilly", "O’Reilly"]) assert.ok(matchesDraftQuery(oreilly, q), q);
for (const q of ["ekman larsson", "ekman-larsson", "ekmanlarsson"]) assert.ok(matchesDraftQuery(oel, q), q);
assert.ok(!matchesDraftQuery(jt, "o'reilly"));
assert.equal(displayRank(players[0]!, "ALL"), 1);
assert.equal(displayRank(players[0]!, "C"), 2, "position rank under a position filter");

let state = markPick(EMPTY_DRAFT_STATE, 2, false);
state = markPick(state, 4, true);
const hidden = draftRows(players, state, { filter: "ALL", query: "", showDrafted: false });
assert.deepEqual(hidden.map((r) => r.player.id), [1, 3]);
const shown = draftRows(players, state, { filter: "ALL", query: "", showDrafted: true });
assert.deepEqual(
  shown.map((r) => [r.player.id, r.pickNumber, r.mine]),
  [
    [1, null, false],
    [2, 1, false],
    [3, null, false],
    [4, 2, true],
  ],
);
assert.deepEqual(
  draftRows(players, state, { filter: "G", query: "", showDrafted: false }).map((r) => r.player.id),
  [3],
);

console.log("OK: draft-copy");
