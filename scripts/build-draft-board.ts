/**
 * Build a league's draft board from committed data only (projections in
 * players.json, Yahoo eligibility already baked in, profile ages, a Fantrax
 * ADP snapshot). No network, no timestamps → the output is deterministic.
 * `build:pages` runs it before `next build`, so every deploy (including the
 * retrain → deploy path) ships a board that matches players.json; commit the
 * result after regenerating projections to keep git in step.
 * Run: npm run draft:board [-- <slug>]   (default: every Yahoo categories
 * league of the registry, src/lib/leagues/registry.ts)
 */
import { writeFileAtomic } from "../src/lib/atomic-write";
import { leagueBoardPath, loadBoardInputs } from "../src/lib/leagues/board-inputs";
import { buildLeagueBoard, serializeBoard } from "../src/lib/leagues/league-board";
import { LEAGUES } from "../src/lib/leagues/registry";

const slugs = process.argv[2]
  ? [process.argv[2]]
  : LEAGUES.filter((l) => l.kind === "yahoo-categories").map((l) => l.profileSlug ?? l.slug);

for (const slug of slugs) {
  const { board, vor, adp } = buildLeagueBoard(loadBoardInputs(slug));
  const out = leagueBoardPath(slug);
  writeFileAtomic(out, serializeBoard(board));

  const gw = vor.goalieWeight;
  console.log(`${board.leagueName}: ${board.players.length} players → ${out}`);
  console.log(
    `goalie weight ${gw.weight.toFixed(3)} = leverage ${gw.leverageRatio.toFixed(3)} × predictability ${gw.predictabilityRatio.toFixed(3)}`,
  );
  console.log(
    "replacement:",
    Object.entries(board.replacement)
      .map(([k, v]) => `${k} ${v?.toFixed(2)}`)
      .join(" · "),
  );
  console.log(
    `ADP matched ${adp.matches.size} (${board.source.adpMatched} on board, < ceiling); ambiguous: ${adp.ambiguousPlayers.join(", ") || "none"}`,
  );
  for (const p of board.players.slice(0, 30)) {
    console.log(
      `  ${String(p.rank).padStart(3)}. ${p.name.padEnd(24)} ${p.pos.join("/").padEnd(8)} VOR ${p.vor.toFixed(2).padStart(6)}  ADP ${p.adp ?? "—"}`,
    );
  }
}
