import { readFileSync } from "fs";
import { join } from "path";
import summaryJson from "@/data/snake-summary.json";
import type { DraftBoard } from "@/lib/draft/board-types";
import type { LeagueEntry } from "@/lib/leagues/registry";
import { snakeNhlSeed } from "@/lib/snake/league-seed";
import type { SnakeNhlFile, SnakeSummaryFile } from "@/lib/snake/types";

const boards = new Map<string, DraftBoard>();
const seeds = new Map<string, SnakeNhlFile["rows"]>();

/**
 * A categories league's committed draft board (`npm run draft:board`,
 * rebuilt by `build:pages` before `next build`). Read at build time and
 * inlined in the tabs that need it, so the draft helper keeps working
 * offline.
 */
export function categoryBoard(entry: LeagueEntry): DraftBoard {
  const slug = entry.profileSlug ?? entry.slug;
  let board = boards.get(slug);
  if (!board) {
    board = JSON.parse(readFileSync(join(process.cwd(), "public", "leagues", slug, "board.json"), "utf8")) as DraftBoard;
    boards.set(slug, board);
  }
  return board;
}

/**
 * Snake's verdicts for every board player he discussed (build time): the
 * tabs' chips and tables need no fetch, even offline mid-draft.
 */
export function categorySnakeSeed(entry: LeagueEntry): SnakeNhlFile["rows"] {
  const slug = entry.profileSlug ?? entry.slug;
  let seed = seeds.get(slug);
  if (!seed) {
    seed = snakeNhlSeed(
      categoryBoard(entry).players.map((p) => p.id),
      summaryJson as unknown as SnakeSummaryFile,
    );
    seeds.set(slug, seed);
  }
  return seed;
}
