import { readFileSync } from "fs";
import { join } from "path";
import type { ProjectionsDataset } from "../types";
import type { AdpRow } from "./adp-match";
import type { BoardInputs } from "./league-board";
import { parseLeagueProfile } from "./profile";

/** Node-only: read every committed input of a league board. */

export const LEAGUE_ADP_FILE = join("src", "data", "leagues", "fantrax-adp-2026-09-25.json");

export function leagueProfilePath(slug: string, root = process.cwd()): string {
  return join(root, "src", "data", "leagues", `${slug}.json`);
}

export function leagueBoardPath(slug: string, root = process.cwd()): string {
  return join(root, "public", "leagues", slug, "board.json");
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

  return {
    profile,
    players: data.players,
    projectionsGeneratedAt: data.generatedAt,
    projectionEngine: data.projectionEngine,
    r2,
    birthDates,
    adp,
  };
}
