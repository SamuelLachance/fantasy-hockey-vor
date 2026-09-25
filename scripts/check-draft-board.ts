/**
 * CI guard for league draft boards (`npm run check:draft-board`): the board
 * built from the committed inputs — exactly what `build:pages` will ship —
 * must pass shape/sanity checks. A committed board.json that lags behind
 * players.json only warns: `build:pages` regenerates it before `next build`,
 * so a projection refresh (retrain.yml, `npm run generate`, …) never blocks
 * the Pages deploy of the main board.
 * Run: npx tsx scripts/check-draft-board.ts [slug]
 */
import { existsSync, readFileSync } from "fs";
import { leagueBoardPath, loadBoardInputs } from "../src/lib/leagues/board-inputs";
import { buildLeagueBoard, serializeBoard } from "../src/lib/leagues/league-board";
import type { DraftBoard } from "../src/lib/draft/board-types";

const slug = process.argv[2] ?? "light-the-lamp";
const path = leagueBoardPath(slug);
const errors: string[] = [];
const warnings: string[] = [];

const { board: fresh } = buildLeagueBoard(loadBoardInputs(slug));
if (!existsSync(path)) {
  // The page imports the file: typecheck and build need it.
  errors.push(`${path} missing — run npm run draft:board`);
} else if (serializeBoard(fresh) !== readFileSync(path, "utf8").replace(/\r\n/g, "\n")) {
  warnings.push(
    "committed board.json lags behind its inputs (build:pages regenerates it; run npm run draft:board and commit to keep git in step)",
  );
}

// Sanity checks run on the fresh build — the board that will be deployed.
const board: DraftBoard = fresh;
const cats = board.categories;
if (board.schema !== 1) errors.push(`schema ${board.schema}`);
if (board.players.length < 300) errors.push(`only ${board.players.length} players`);
const forbidden = ["penaltyMinutes", "faceoffWins"];
for (const c of [...cats.skater, ...cats.goalie]) {
  if (forbidden.includes(c)) errors.push(`category ${c} is not in this league`);
}
for (const g of ["F", "D"] as const) {
  if (board.skaterGroupOffset[g]?.length !== cats.skater.length) errors.push(`group offset ${g} length`);
}
const ids = new Set<number>();
board.players.forEach((p, i) => {
  if (ids.has(p.id)) errors.push(`duplicate id ${p.id}`);
  ids.add(p.id);
  if (i > 0 && board.players[i - 1]!.rank >= p.rank) errors.push(`rank order at ${p.name}`);
  const n = p.pos.includes("G") ? cats.goalie.length : cats.skater.length;
  if (p.proj.length !== n || p.z.length !== n) errors.push(`${p.name}: stat arrays ≠ ${n}`);
  if (![...p.proj, ...p.z, p.value, p.vor].every(Number.isFinite)) {
    errors.push(`${p.name}: non-finite number`);
  }
  if (p.age != null && (p.age < 17 || p.age > 46)) errors.push(`${p.name}: age ${p.age}`);
  if (p.adp != null && !(p.adp >= 1 && p.adp < 300)) errors.push(`${p.name}: adp ${p.adp}`);
  if (p.pos.includes("G") && (p.sv == null || p.ga == null)) errors.push(`${p.name}: goalie volumes`);
  if (!p.pos.includes(p.vorPos)) errors.push(`${p.name}: vorPos ${p.vorPos} not eligible`);
});
if (board.players.slice(0, 5).some((p) => p.pos.includes("G"))) {
  errors.push("a goalie in the top 5 — goalie weight out of band");
}
const goalies = board.players.filter((p) => p.pos.includes("G")).length;
if (goalies < 40) errors.push(`only ${goalies} goalies on the board`);
const w = board.goalieWeight.weight;
if (!(w > 0.3 && w < 1.5)) errors.push(`goalie weight ${w} out of [0.3, 1.5]`);
if (board.goalieWeight.firstGoalieRank == null) errors.push("no goalie ranked");
for (const slot of ["C", "LW", "RW", "F", "D", "Util", "G"] as const) {
  const line = board.averageTeam.slots[slot];
  if (!line) errors.push(`average team missing ${slot}`);
  if (board.replacement[slot] == null) errors.push(`replacement missing ${slot}`);
}
const top150 = board.players.slice(0, 150);
const withAdp = top150.filter((p) => p.adp != null).length;
if (withAdp < 120) errors.push(`only ${withAdp}/150 of the top 150 have an ADP`);
const rounds = board.league.rounds;
if (board.league.teams * rounds !== 216) errors.push(`expected 216 picks, got ${board.league.teams * rounds}`);

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`FAIL: ${e}`);
  process.exit(1);
}
console.log(
  `OK: draft board ${slug} (${board.players.length} players, ${goalies} G, goalie weight ${w}, ADP ${withAdp}/150)`,
);
