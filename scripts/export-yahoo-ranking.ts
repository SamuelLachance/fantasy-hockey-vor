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
 * A name the board holds once can still be shared with someone off the board
 * in Yahoo's pool (Sebastian Aho: CAR C and PIT D; Elias Pettersson: two VAN
 * players, C and D, where a team suffix would not even help). The printed
 * list is left as it is (it is what was pasted into Yahoo), and each such line
 * is reported on stderr so the pick can be checked in Yahoo by hand.
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

// Yahoo's whole pool (matched and unmatched rows), by name: another player
// under a printed name makes that line ambiguous for a name-based import.
type PoolEntry = { key: string; nhlId: number | null; team: string; pos: string };
const pool = new Map<string, PoolEntry[]>();
const addToPool = (name: string, entry: PoolEntry) => {
  const k = name.trim().toLowerCase();
  pool.set(k, [...(pool.get(k) ?? []), entry]);
};
for (const [id, r] of Object.entries(yahoo?.byNhlId ?? {})) {
  addToPool(r.name, { key: `nhl ${id}`, nhlId: Number(id), team: r.team, pos: r.positions.join("/") });
}
for (const u of yahoo?.unmatchedPlayers ?? []) {
  addToPool(u.name, { key: `yahoo ${u.yahooPlayerId}`, nhlId: null, team: u.team, pos: "" });
}
const ambiguous: string[] = [];

rows.forEach((p, i) => {
  const others = (pool.get(yahooName(p).trim().toLowerCase()) ?? []).filter((e) => e.nhlId !== p.id);
  // A team suffix settles it unless the other player is on the same team.
  const printedTeam = label(p) !== yahooName(p);
  const unresolved = others.filter((e) => !printedTeam || e.team === p.team);
  if (unresolved.length > 0) {
    ambiguous.push(
      `line ${i + 1} « ${label(p)} » is ${p.team} ${p.pos.join("/")}; Yahoo also lists ${unresolved
        .map((e) => `${yahooName(p)} (${[e.team, e.pos].filter(Boolean).join(" ")}, ${e.key})`)
        .join(", ")}`,
    );
  }

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
for (const line of ambiguous) console.error(`WARN: ambiguous name, check it in Yahoo: ${line}`);
const adjusted = rows.filter((p) => p.adjusted).length;
console.error(
  `${rows.length} names for ${board.leagueName} (${join("public", "leagues", slug)})${adjusted ? `, ${adjusted} hand-adjusted` : ""}`,
);
