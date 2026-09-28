import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { nhlRostersErrors, type NhlRostersFile } from "../nhl-rosters";
import type { SnakeSummaryFile } from "../snake/types";
import type { Position, ProjectionsDataset } from "../types";
import type { AdpRow } from "./adp-match";
import type { BoardInputs } from "./league-board";
import { parseLeagueProfile } from "./profile";
import { parseRankAdjustments, type RankAdjustmentsFile } from "./rank-adjustments";

/** Node-only: read every committed input of a league board. */

export const LEAGUE_ADP_FILE = join("src", "data", "leagues", "fantrax-adp-2026-09-25.json");

export function leagueProfilePath(slug: string, root = process.cwd()): string {
  return join(root, "src", "data", "leagues", `${slug}.json`);
}

export function leagueBoardPath(slug: string, root = process.cwd()): string {
  return join(root, "public", "leagues", slug, "board.json");
}

/** The rest of the league's players (fetched by the tables, never inlined). */
export function leaguePoolPath(slug: string, root = process.cwd()): string {
  return join(root, "public", "leagues", slug, "pool.json");
}

export const NHL_ROSTERS_FILE = join("src", "data", "nhl-rosters.json");

/** The committed NHL lists snapshot (`npm run nhl:rosters`); null when absent. */
export function loadNhlRosters(root = process.cwd()): NhlRostersFile | null {
  const path = join(root, NHL_ROSTERS_FILE);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const errors = nhlRostersErrors(raw);
  if (errors.length > 0) throw new Error(`${path}: ${errors.slice(0, 5).join("; ")}`);
  return raw as NhlRostersFile;
}

/** Hand rank moves of a league board (optional file, see `rank-adjustments.ts`). */
export function rankAdjustmentsPath(slug: string, root = process.cwd()): string {
  return join(root, "src", "data", "leagues", slug, "rank-adjustments.json");
}

export function loadRankAdjustments(slug: string, root = process.cwd()): RankAdjustmentsFile | null {
  const path = rankAdjustmentsPath(slug, root);
  if (!existsSync(path)) return null;
  return parseRankAdjustments(JSON.parse(readFileSync(path, "utf8")), slug);
}

export function loadBoardInputs(slug: string, root = process.cwd()): BoardInputs {
  const profile = parseLeagueProfile(
    JSON.parse(readFileSync(leagueProfilePath(slug, root), "utf8")),
  );
  const data = JSON.parse(
    readFileSync(join(root, "src", "data", "players.json"), "utf8"),
  ) as ProjectionsDataset;

  const r2: Record<string, number | null> = {};
  for (const group of [data.categoryWeights?.skater, data.categoryWeights?.goalie]) {
    for (const [cat, meta] of Object.entries(group ?? {})) r2[cat] = meta.r2;
  }

  const profiles = JSON.parse(
    readFileSync(join(root, "src", "data", "player-profiles.json"), "utf8"),
  ) as { profiles: Record<string, { id: number; bio?: { birthDate?: string } }> };
  const birthDates = new Map<number, string>();
  for (const p of Object.values(profiles.profiles)) {
    if (p.bio?.birthDate) birthDates.set(p.id, p.bio.birthDate);
  }

  const adp = JSON.parse(readFileSync(join(root, LEAGUE_ADP_FILE), "utf8")) as {
    source: string;
    fetchedAt: string;
    rows: AdpRow[];
  };

  const yahoo = JSON.parse(readFileSync(join(root, "src", "data", "yahoo-positions.json"), "utf8")) as {
    byNhlId?: Record<string, { positions?: Position[] }>;
  };
  const yahooPositions = new Map<number, Position[]>();
  for (const [id, row] of Object.entries(yahoo.byNhlId ?? {})) {
    if (row.positions?.length) yahooPositions.set(Number(id), row.positions);
  }

  const snake = JSON.parse(readFileSync(join(root, "src", "data", "snake-summary.json"), "utf8")) as Pick<
    SnakeSummaryFile,
    "rows" | "nhl"
  >;

  return {
    profile,
    players: data.players,
    projectionsGeneratedAt: data.generatedAt,
    projectionEngine: data.projectionEngine,
    r2,
    birthDates,
    adp,
    rankAdjustments: loadRankAdjustments(slug, root),
    nhlRosters: loadNhlRosters(root),
    yahooPositions,
    snake,
  };
}
