/**
 * Paste-ready pre-draft ranking for Yahoo ("Edit Pre-Draft Rankings"): one
 * "N. Name" line per board player, in board order — the published rank,
 * hand adjustments included (`src/data/leagues/<slug>/rank-adjustments.json`).
 *
 * Names come from `src/data/yahoo-positions.json` byNhlId whenever the player
 * is there: the board carries the projection dataset's spellings, and Yahoo
 * writes Stutzle, Lafreniere and Fehervary without diacritics, so a list keyed
 * on the board's own strings silently drops those rows on import. Two players
 * sharing a name (Matt Murray) get their team in parentheses. Team codes are
 * deliberately NOT taken from Yahoo — that file is a few months old, so its
 * teams can be stale even where its eligibility is right.
 *
 * Run: npm run draft:ranking -- [slug] [--depth N] [--plain | --table]
 *   --plain  names only, no numbers
 *   --table  rank, name, positions, team, VOR, ADP and the hand moves
 */
import { readFileSync } from "fs";
import { join } from "path";
import { modelVor, type DraftBoard, type DraftBoardPlayer } from "../src/lib/draft/board-types";
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
const ordered = [...board.players].sort((a, b) => a.rank - b.rank);
const rows = depth > 0 ? ordered.slice(0, depth) : ordered;

const yahooName = (p: DraftBoardPlayer) => yahoo?.byNhlId[p.id]?.name ?? p.name;
const nameCount = new Map<string, number>();
for (const p of ordered) nameCount.set(yahooName(p), (nameCount.get(yahooName(p)) ?? 0) + 1);
const label = (p: DraftBoardPlayer) => {
  const name = yahooName(p);
  return (nameCount.get(name) ?? 0) > 1 ? `${name} (${p.team})` : name;
};

rows.forEach((p, i) => {
  if (flag("table")) {
    console.log(
      [
        String(p.rank).padStart(3),
        label(p).padEnd(24),
        p.pos.join("/").padEnd(8),
        p.team.padEnd(4),
        `VOR ${p.vor.toFixed(2).padStart(6)}`,
        `ADP ${p.adp == null ? "—" : p.adp.toFixed(1)}`,
        p.adjusted ? `ajusté (modèle : rang ${p.adjusted.fromRank}, VOR ${modelVor(p).toFixed(2)})` : "",
      ]
        .join("  ")
        .trimEnd(),
    );
  } else if (flag("plain")) {
    console.log(label(p));
  } else {
    console.log(`${i + 1}. ${label(p)}`);
  }
});
const adjusted = rows.filter((p) => p.adjusted).length;
console.error(
  `${rows.length} names for ${board.leagueName} (${join("public", "leagues", slug)})${adjusted ? `, ${adjusted} hand-adjusted` : ""}`,
);
