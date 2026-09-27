/**
 * Paste-ready pre-draft ranking for Yahoo ("Edit Pre-Draft Rankings" takes one
 * player name per line, in order).
 *
 * Names come from `src/data/yahoo-positions.json` byNhlId whenever the player
 * is there: the board carries the projection dataset's spellings, and Yahoo
 * writes Stutzle, Lafreniere and Fehervary without diacritics, so a list keyed
 * on the board's own strings silently drops those rows on import. Team codes
 * are deliberately NOT taken from Yahoo — that file is a few months old, so its
 * teams can be stale even where its eligibility is right.
 *
 * Run: npx tsx scripts/export-yahoo-ranking.ts [slug] [--depth N] [--table]
 */
import { readFileSync } from "fs";
import { join } from "path";
import type { DraftBoard } from "../src/lib/draft/board-types";
import { leagueBoardPath } from "../src/lib/leagues/board-inputs";
import { LEAGUES } from "../src/lib/leagues/registry";
import { loadYahooPositions } from "../src/lib/yahoo-positions";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const slug =
  args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--depth") ??
  LEAGUES.filter((l) => l.kind === "yahoo-categories").map((l) => l.profileSlug ?? l.slug)[0]!;
const depth = Number(value("depth") ?? 0);

const board = JSON.parse(readFileSync(leagueBoardPath(slug), "utf8")) as DraftBoard;
const yahoo = loadYahooPositions();
const rows = depth > 0 ? board.players.slice(0, depth) : board.players;

for (const p of rows) {
  const name = yahoo?.byNhlId[p.id]?.name ?? p.name;
  if (flag("table")) {
    console.log(
      [
        String(p.rank).padStart(3),
        name.padEnd(24),
        p.pos.join("/").padEnd(8),
        p.team.padEnd(4),
        `VOR ${p.vor.toFixed(2).padStart(6)}`,
        `ADP ${p.adp == null ? "—" : p.adp.toFixed(1)}`,
      ].join("  "),
    );
  } else {
    console.log(name);
  }
}
if (!flag("table")) {
  console.error(`${rows.length} names for ${board.leagueName} (${join("public", "leagues", slug)})`);
}
