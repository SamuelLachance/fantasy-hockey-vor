/**
 * CI guard for league draft boards (`npm run check:draft-board`): the board
 * built from the committed inputs — exactly what `build:pages` will ship —
 * must pass shape/sanity checks. A committed board.json that lags behind
 * players.json only warns: `build:pages` regenerates it before `next build`,
 * so a projection refresh (retrain.yml, `npm run generate`, …) never blocks
 * the Pages deploy of the main board.
 * Run: npx tsx scripts/check-draft-board.ts [slug]   (default: every Yahoo
 * categories league of the registry)
 */
import { existsSync, readFileSync } from "fs";
import { leagueBoardPath, loadBoardInputs, rankAdjustmentsPath } from "../src/lib/leagues/board-inputs";
import { buildLeagueBoard, serializeBoard } from "../src/lib/leagues/league-board";
import type { DraftBoard } from "../src/lib/draft/board-types";
import { rankAdjustmentErrors } from "../src/lib/leagues/rank-adjustments";
import { LEAGUES } from "../src/lib/leagues/registry";

const slugs = process.argv[2]
  ? [process.argv[2]]
  : LEAGUES.filter((l) => l.kind === "yahoo-categories").map((l) => l.profileSlug ?? l.slug);
const errors: string[] = [];
const warnings: string[] = [];
const summaries: string[] = [];

for (const slug of slugs) {
  const path = leagueBoardPath(slug);

  // Hand rank moves: the file's shape first (loadBoardInputs throws on it).
  const adjPath = rankAdjustmentsPath(slug);
  if (existsSync(adjPath)) {
    const shape = rankAdjustmentErrors(JSON.parse(readFileSync(adjPath, "utf8")), slug);
    for (const e of shape) errors.push(`${adjPath}: ${e}`);
    if (shape.length > 0) continue;
  }

  const inputs = loadBoardInputs(slug);
  const { board: fresh, enginePlayers, adjustmentsMissing } = buildLeagueBoard(inputs);
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
  // Light the Lamp scores neither PIM nor faceoffs (the old main board did).
  const forbidden = slug === "light-the-lamp" ? ["penaltyMinutes", "faceoffWins"] : [];
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
  // Seats that can only hold forwards must share one baseline: which of
  // C/LW/RW/F a multi-eligible forward is seated in is decided by the fill
  // order, so a per-slot line read off one assignment would be an artifact.
  const forwardOnly = (["C", "LW", "RW", "F", "Util"] as const).filter(
    (s) => (board.league.roster[s] ?? 0) > 0 && !board.league.slotEligibility[s].includes("D"),
  );
  const lineOf = (slot: (typeof forwardOnly)[number]) => (board.averageTeam.slots[slot]?.z ?? []).join(",");
  for (const slot of forwardOnly) {
    if (lineOf(slot) !== lineOf(forwardOnly[0]!)) {
      errors.push(`average ${slot} line ≠ average ${forwardOnly[0]} line (per-seat baseline is fill-order dependent)`);
    }
  }
  // Hand rank moves: every listed id is on the board under that name and
  // carries its reason; the moves only reorder rows (the rank slots, overall
  // and per position, are the engine's); the published VOR never rises down
  // the board (a VOR sort agrees with the rank).
  // An id that has left the board (engine rank past BOARD_DEPTH after a
  // retrain, or dropped from players.json) only warns, like the builder that
  // skips it: this check gates every Pages deploy and the daily refresh of
  // the other leagues, which a stale Light the Lamp move must not block.
  const adjustments = inputs.rankAdjustments?.adjustments ?? [];
  for (const id of adjustmentsMissing) {
    const a = adjustments.find((x) => x.id === id);
    warnings.push(`adjusted id ${id}${a ? ` (${a.name})` : ""} is not on the board — move skipped; review ${adjPath}`);
  }
  const byId = new Map(board.players.map((p) => [p.id, p]));
  for (const a of adjustments) {
    const p = byId.get(a.id);
    if (!p) continue;
    if (p.name !== a.name) errors.push(`adjusted id ${a.id}: board name « ${p.name} » ≠ « ${a.name} »`);
    if (!p.adjusted || p.adjusted.reason !== a.reason) errors.push(`${p.name}: adjusted row without its reason`);
    if (p.adjusted && p.adjusted.fromRank !== a.engineRank) {
      warnings.push(
        `${p.name}: hand move decided at engine rank ${a.engineRank}, the engine now says ${p.adjusted.fromRank} — review ${adjPath}`,
      );
    }
  }
  const adjustedRows = board.players.filter((p) => p.adjusted);
  if (adjustedRows.length !== adjustments.length - adjustmentsMissing.length) {
    errors.push(`${adjustedRows.length} adjusted rows for ${adjustments.length} adjustments`);
  }
  for (const p of adjustedRows) {
    if (!p.adjusted!.reason.trim()) errors.push(`${p.name}: empty adjustment reason`);
    if (!Number.isFinite(p.adjusted!.vorModel) || !(p.adjusted!.fromRank >= 1)) errors.push(`${p.name}: adjustment figures`);
  }
  if (adjustments.length > 0) {
    const sorted = (xs: (number | undefined)[]) =>
      xs.filter((r): r is number => r != null).sort((a, b) => a - b).join(",");
    if (board.players.length !== enginePlayers.length) errors.push("hand moves changed the board size");
    // Ranks strictly increase down the board (checked above), so equal slot
    // sets mean the k-th row holds the engine's k-th rank.
    if (sorted(board.players.map((p) => p.rank)) !== sorted(enginePlayers.map((p) => p.rank))) {
      errors.push("hand moves changed the rank slots (ranks must be the engine's, reordered)");
    }
    board.players.forEach((p, i) => {
      if (i > 0 && p.vor > board.players[i - 1]!.vor) errors.push(`VOR rises at ${p.name} (rank ${p.rank})`);
    });
    for (const key of ["C", "LW", "RW", "F", "D", "G"] as const) {
      const got = board.players.filter((p) => p.posRank[key] != null);
      if (sorted(got.map((p) => p.posRank[key])) !== sorted(enginePlayers.map((p) => p.posRank[key]))) {
        errors.push(`position ranks ${key} are not the engine's, reordered`);
      }
    }
  }

  const top150 = board.players.slice(0, 150);
  const withAdp = top150.filter((p) => p.adp != null).length;
  if (withAdp < 120) errors.push(`only ${withAdp}/150 of the top 150 have an ADP`);
  const rounds = board.league.rounds;
  // Light the Lamp: 12 teams × 18 rounds (pinned from the league settings).
  if (slug === "light-the-lamp" && board.league.teams * rounds !== 216) {
    errors.push(`expected 216 picks, got ${board.league.teams * rounds}`);
  }
  summaries.push(
    `${slug}: ${board.players.length} players, ${goalies} G, goalie weight ${w}, ADP ${withAdp}/150, ${adjustedRows.length} hand moves`,
  );
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`FAIL: ${e}`);
  process.exit(1);
}
console.log(`OK: draft boards ${slugs.join(", ")}`);
for (const line of summaries) console.log(`  ${line}`);
