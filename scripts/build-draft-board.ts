/**
 * Build a league's draft board from committed data only (projections in
 * players.json, Yahoo eligibility already baked in, profile ages, a Fantrax
 * ADP snapshot). No network, no timestamps → the output is deterministic.
 * `build:pages` runs it before `next build`, so every deploy (including the
 * retrain → deploy path) ships a board that matches players.json; commit the
 * result after regenerating projections to keep git in step.
 * Hand rank moves (`src/data/leagues/<slug>/rank-adjustments.json`) are
 * applied after the engine ranks; the log lists them.
 * Also writes the league's `pool.json` (every other projected player, then
 * the players the NHL ties to a club without a projection, from the
 * committed `src/data/nhl-rosters.json`), which the tables fetch.
 * Run: npm run draft:board [-- <slug>]   (default: every Yahoo categories
 * league of the registry, src/lib/leagues/registry.ts)
 */
import { writeFileAtomic } from "../src/lib/atomic-write";
import { leagueBoardPath, leaguePoolPath, loadBoardInputs } from "../src/lib/leagues/board-inputs";
import { buildLeagueBoard, serializeBoard, serializePool } from "../src/lib/leagues/league-board";
import { LEAGUES } from "../src/lib/leagues/registry";

const slugs = process.argv[2]
  ? [process.argv[2]]
  : LEAGUES.filter((l) => l.kind === "yahoo-categories").map((l) => l.profileSlug ?? l.slug);

for (const slug of slugs) {
  const { board, vor, adp, adjustmentsMissing, pool, teamChanges } = buildLeagueBoard(loadBoardInputs(slug));
  const out = leagueBoardPath(slug);
  writeFileAtomic(out, serializeBoard(board));
  const poolOut = leaguePoolPath(slug);
  writeFileAtomic(poolOut, serializePool(pool));

  const gw = vor.goalieWeight;
  console.log(`${board.leagueName}: ${board.players.length} players → ${out}`);
  const n = (k: string) => pool.unprojected.filter((p) => p.noProj === k).length;
  console.log(
    `pool: ${pool.players.length} more projected players; without a projection, ${n("roster")} rostered, ${n("prospect")} on prospect lists and ${n("org")} elsewhere in an organisation → ${poolOut}`,
  );
  if (teamChanges.size > 0) {
    const byId = new Map([...board.players, ...pool.players].map((p) => [p.id, p.name]));
    console.log(
      `current club (NHL rosters of ${pool.rostersFetchedAt ?? "?"}): ${[...teamChanges]
        .map(([id, [from, to]]) => `${byId.get(id) ?? id} ${from}→${to}`)
        .join(", ")}`,
    );
  }
  console.log(
    `goalie weight ${gw.weight.toFixed(3)} = leverage ${gw.leverageRatio.toFixed(3)} × predictability ${gw.predictabilityRatio.toFixed(3)}`,
  );
  const gs = vor.goalieSavePctShrink;
  console.log(
    `goalie SV% spread ${gs.spread.toFixed(5)} ÷ ${gs.factor.toFixed(3)} toward ${gs.mean.toFixed(4)} (${gs.count} reference goalies)`,
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
  for (const p of board.players.filter((x) => x.adjusted)) {
    console.log(
      `  hand move: ${p.name.padEnd(22)} engine ${String(p.adjusted!.fromRank).padStart(3)} → ${String(p.rank).padStart(3)}  VOR ${p.adjusted!.vorModel.toFixed(2)} → ${p.vor.toFixed(2)}`,
    );
  }
  if (adjustmentsMissing.length > 0) {
    console.warn(`WARN: adjusted ids nobody projects (not in players.json; skipped): ${adjustmentsMissing.join(", ")}`);
  }
  for (const p of board.players.slice(0, 30)) {
    console.log(
      `  ${String(p.rank).padStart(3)}. ${p.name.padEnd(24)} ${p.pos.join("/").padEnd(8)} VOR ${p.vor.toFixed(2).padStart(6)}  ADP ${p.adp ?? "—"}`,
    );
  }
}
