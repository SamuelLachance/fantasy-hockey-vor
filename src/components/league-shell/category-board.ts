import { existsSync, readFileSync } from "fs";
import { join } from "path";
import summaryJson from "@/data/snake-summary.json";
import type { DraftBoard, LeaguePool } from "@/lib/draft/board-types";
import { isLeaguePool, leaguePoolCounts, type LeaguePoolCounts } from "@/lib/draft/league-pool";
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

const pools = new Map<string, LeaguePool | null>();

/**
 * The league's committed `pool.json` (build time, for wording and links
 * only: the browser fetches the pool itself, it is never inlined). Null
 * without a valid file.
 */
function categoryPool(entry: LeagueEntry): LeaguePool | null {
  const slug = entry.profileSlug ?? entry.slug;
  if (!pools.has(slug)) {
    const path = join(process.cwd(), "public", "leagues", slug, "pool.json");
    const raw: unknown = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
    pools.set(slug, isLeaguePool(raw, slug) ? raw : null);
  }
  return pools.get(slug) ?? null;
}

const poolCounts = new Map<string, LeaguePoolCounts>();

/**
 * How many players the league's lists hold (board + `pool.json`, read at
 * build time for the tabs' wording only). Without the file: the board alone.
 */
export function categoryPoolCounts(entry: LeagueEntry): LeaguePoolCounts {
  const slug = entry.profileSlug ?? entry.slug;
  let counts = poolCounts.get(slug);
  if (!counts) {
    counts = leaguePoolCounts(categoryBoard(entry), categoryPool(entry));
    poolCounts.set(slug, counts);
  }
  return counts;
}

/**
 * NHL ids of every player Snake discussed who is anywhere in the league's
 * lists (the board's seed, then the pool's verdicts): the Snake page's
 * « Dans vos ligues » link to the league's Joueurs tab.
 */
export function categoryListedSnakeIds(entry: LeagueEntry): string[] {
  const ids = new Set(Object.keys(categorySnakeSeed(entry)));
  for (const id of Object.keys(categoryPool(entry)?.snake ?? {})) ids.add(id);
  return [...ids];
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
