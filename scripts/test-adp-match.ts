/**
 * Fantrax ADP ↔ board matching (name keys, groups, duplicates).
 * Run: npx tsx scripts/test-adp-match.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import {
  fantraxToFirstLast,
  matchAdp,
  personNameKey,
  positionGroupOf,
  type AdpRow,
} from "../src/lib/leagues/adp-match";

// Name keys: Fantrax spellings meet NHL spellings.
assert.equal(personNameKey(fantraxToFirstLast("OReilly, Ryan")), personNameKey("Ryan O'Reilly"));
assert.equal(personNameKey(fantraxToFirstLast("Miller, KAndre")), personNameKey("K'Andre Miller"));
assert.equal(personNameKey(fantraxToFirstLast("Miller, J.T.")), personNameKey("J.T. Miller"));
assert.equal(personNameKey(fantraxToFirstLast("Stutzle, Tim")), personNameKey("Tim Stützle"));
assert.equal(personNameKey(fantraxToFirstLast("Slafkovsky, Juraj")), personNameKey("Juraj Slafkovský"));
assert.equal(personNameKey(fantraxToFirstLast("Jones, Zac")), personNameKey("Zachary Jones"));
assert.equal(personNameKey(fantraxToFirstLast("Vladar, Dan")), personNameKey("Daniel Vladar"));
assert.equal(
  personNameKey(fantraxToFirstLast("Dubois, Pierre-Luc")),
  personNameKey("Pierre-Luc Dubois"),
);
assert.equal(personNameKey("Haoxi (Simon) Wang"), personNameKey("Haoxi Wang"));
assert.notEqual(personNameKey("Adam Edstrom"), personNameKey("David Edstrom"), "no fuzzy merge");
assert.equal(fantraxToFirstLast("McDavid, Connor"), "Connor McDavid");
assert.equal(positionGroupOf(["LW", "RW"]), "F");
assert.equal(positionGroupOf(["D"]), "D");
assert.equal(positionGroupOf(["G"]), "G");

const rows: AdpRow[] = [
  { name: "Hughes, Jack", pos: "C", id: "njd", adp: 14.8 },
  { name: "Hughes, Jack", pos: "C", id: "lak", adp: 280 },
  { name: "Pettersson, Elias", pos: "C", id: "c", adp: 60 },
  { name: "Pettersson, Elias", pos: "D", id: "d", adp: 250 },
  { name: "Murray, Matt", pos: "G", id: "mm", adp: 270 },
  { name: "Geertsen, Mason", pos: "D", id: "geer", adp: 289 },
  { name: "Nobody, Prospect", pos: "C", id: "p", adp: 120 },
];
const report = matchAdp(
  [
    { id: 1, name: "Jack Hughes", positions: ["C", "LW"], isGoalie: false },
    { id: 2, name: "Elias Pettersson", positions: ["C"], isGoalie: false },
    { id: 3, name: "Elias Pettersson", positions: ["D"], isGoalie: false },
    { id: 4, name: "Matt Murray", positions: ["G"], isGoalie: true },
    { id: 5, name: "Matt Murray", positions: ["G"], isGoalie: true },
    { id: 6, name: "Mason Geertsen", positions: ["LW"], isGoalie: false },
  ],
  rows,
);
assert.equal(report.matches.get(1)?.adp, 14.8, "duplicate rows: lowest ADP wins");
assert.equal(report.matches.get(2)?.fantraxId, "c", "Pettersson C by group");
assert.equal(report.matches.get(3)?.fantraxId, "d", "Pettersson D by group");
assert.ok(!report.matches.has(4) && !report.matches.has(5), "two pool Matt Murrays → no match");
assert.deepEqual(report.ambiguousPlayers, ["Matt Murray"]);
assert.equal(report.matches.get(6)?.method, "name", "group disagreement → unique name pass");
assert.ok(report.unmatchedRows.some((r) => r.id === "p"), "prospect not in pool stays unmatched");

// Committed snapshot against the committed pool: the ADP top 150 must match.
const snapshot = JSON.parse(
  readFileSync(join(process.cwd(), "src/data/leagues/fantrax-adp-2026-09-25.json"), "utf8"),
) as { rows: AdpRow[] };
const data = JSON.parse(readFileSync(join(process.cwd(), "src/data/players.json"), "utf8")) as {
  players: { id: number; name: string; positions: string[]; isGoalie: boolean }[];
};
const real = matchAdp(
  data.players.map((p) => ({ ...p, positions: p.positions as never })),
  snapshot.rows,
);
const top150 = [...snapshot.rows].sort((a, b) => a.adp - b.adp).slice(0, 150);
const missed = top150.filter((r) => real.unmatchedRows.includes(r));
assert.ok(missed.length <= 3, `ADP top 150 unmatched: ${missed.map((r) => r.name).join(", ")}`);
const ids = [...real.matches.values()].map((m) => m.fantraxId);
assert.equal(new Set(ids).size, ids.length, "each ADP row claimed at most once");

console.log(`OK: adp-match (${real.matches.size} matched, top-150 misses: ${missed.length})`);
