import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { DEFAULT_LEAGUE } from "../src/lib/league";
import {
  BASE_SEASON_IDS,
  computeFaceoffWins,
  fetchGoalieSummaries,
  fetchSkaterFaceoffs,
  fetchSkaterRealtime,
  fetchSkaterSummaries,
  fetchTeamRoster,
  mapNhlPosition,
  NHL_TEAMS,
  PROJECTION_SEASON,
  type RawGoalieSummary,
  type RawSkaterSummary,
  type RosterPlayer,
} from "../src/lib/nhl-api";
import {
  projectGoalie,
  projectSkater,
  rookieGoalieProjection,
  rookieSkaterProjection,
  type SeasonGoalieRates,
  type SeasonSkaterRates,
} from "../src/lib/projections";
import { applyVor } from "../src/lib/vor";
import type {
  GoalieProjection,
  PlayerProjection,
  Position,
  SkaterProjection,
} from "../src/lib/types";

function finite(n: number | undefined | null, fallback = 0): number {
  const value = Number(n);
  return Number.isFinite(value) ? value : fallback;
}

interface PlayerRecord {
  id: number;
  name: string;
  team: string;
  position: Position;
  positions: Position[];
  isGoalie: boolean;
  birthDate?: string;
  skaterSeasons: SeasonSkaterRates[];
  goalieSeasons: SeasonGoalieRates[];
}

async function loadSeasonData(seasonId: number) {
  const [skaters, realtime, faceoffs, goalies] = await Promise.all([
    fetchSkaterSummaries(seasonId),
    fetchSkaterRealtime(seasonId),
    fetchSkaterFaceoffs(seasonId),
    fetchGoalieSummaries(seasonId),
  ]);

  const realtimeMap = new Map(realtime.map((r) => [r.playerId, r]));
  const faceoffMap = new Map(faceoffs.map((f) => [f.playerId, f]));

  return { skaters, realtimeMap, faceoffMap, goalies };
}

function mergeSkaterSeason(
  summary: RawSkaterSummary,
  realtimeMap: Map<number, { blockedShots: number; hits: number }>,
  faceoffMap: Map<
    number,
    { totalFaceoffs: number; faceoffWinPct: number | null }
  >,
): SeasonSkaterRates {
  const rt = realtimeMap.get(summary.playerId);
  const fo = faceoffMap.get(summary.playerId);
  return {
    goals: finite(summary.goals),
    assists: finite(summary.assists),
    shots: finite(summary.shots),
    blocks: finite(rt?.blockedShots),
    hits: finite(rt?.hits),
    powerplayPoints: finite(summary.ppPoints),
    penaltyMinutes: finite(summary.penaltyMinutes),
    faceoffWins: computeFaceoffWins(
      fo?.totalFaceoffs ?? 0,
      fo?.faceoffWinPct ?? summary.faceoffWinPct,
    ),
    gamesPlayed: finite(summary.gamesPlayed),
  };
}

function upsertPlayer(
  map: Map<number, PlayerRecord>,
  id: number,
  patch: Partial<PlayerRecord> & { name: string; position: Position },
) {
  const existing = map.get(id);
  if (existing) {
    map.set(id, {
      ...existing,
      ...patch,
      positions: Array.from(
        new Set([...(existing.positions ?? []), ...(patch.positions ?? [])]),
      ),
    });
    return;
  }

  map.set(id, {
    id,
    name: patch.name,
    team: patch.team ?? "FA",
    position: patch.position,
    positions: patch.positions ?? [patch.position],
    isGoalie: patch.isGoalie ?? patch.position === "G",
    birthDate: patch.birthDate,
    skaterSeasons: [],
    goalieSeasons: [],
  });
}

function rosterName(player: RosterPlayer): string {
  return `${player.firstName.default} ${player.lastName.default}`;
}

async function buildPlayerMap(): Promise<Map<number, PlayerRecord>> {
  const players = new Map<number, PlayerRecord>();

  for (const seasonId of BASE_SEASON_IDS) {
    console.log(`Fetching season ${seasonId}...`);
    const { skaters, realtimeMap, faceoffMap, goalies } =
      await loadSeasonData(seasonId);

    for (const skater of skaters) {
      const position = mapNhlPosition(skater.positionCode);
      if (position === "G") continue;

      upsertPlayer(players, skater.playerId, {
        name: skater.skaterFullName,
        team: skater.teamAbbrevs.split(",")[0],
        position,
        positions: [position],
        isGoalie: false,
      });

      const record = players.get(skater.playerId)!;
      record.skaterSeasons.push(
        mergeSkaterSeason(skater, realtimeMap, faceoffMap),
      );
      if (skater.teamAbbrevs) {
        record.team = skater.teamAbbrevs.split(",")[0];
      }
    }

    for (const goalie of goalies) {
      upsertPlayer(players, goalie.playerId, {
        name: goalie.goalieFullName,
        team: goalie.teamAbbrevs.split(",")[0],
        position: "G",
        positions: ["G"],
        isGoalie: true,
      });

      const record = players.get(goalie.playerId)!;
      record.goalieSeasons.push({
        wins: goalie.wins,
        shutouts: goalie.shutouts,
        saves: goalie.saves,
        savePct: goalie.savePct,
        gamesPlayed: goalie.gamesPlayed,
      });
      if (goalie.teamAbbrevs) {
        record.team = goalie.teamAbbrevs.split(",")[0];
      }
    }
  }

  console.log("Fetching team rosters for additional players...");
  for (const team of NHL_TEAMS) {
    await new Promise((r) => setTimeout(r, 350));
    try {
      const roster = await fetchTeamRoster(team);
      for (const player of roster) {
        const position = mapNhlPosition(player.positionCode);
        upsertPlayer(players, player.id, {
          name: rosterName(player),
          team,
          position,
          positions: [position],
          isGoalie: position === "G",
          birthDate: player.birthDate,
        });
      }
    } catch (err) {
      console.warn(`Roster fetch failed for ${team}:`, err);
    }
  }

  return players;
}

function buildProjections(
  players: Map<number, PlayerRecord>,
): Omit<
  PlayerProjection,
  "categoryZScores" | "fantasyValue" | "vor" | "rank" | "positionRank"
>[] {
  const output: Omit<
    PlayerProjection,
    "categoryZScores" | "fantasyValue" | "vor" | "rank" | "positionRank"
  >[] = [];

  for (const player of players.values()) {
    if (player.isGoalie) {
      const hasHistory = player.goalieSeasons.some((s) => s.gamesPlayed > 0);
      const { projection, gamesPlayed } = hasHistory
        ? projectGoalie(player.goalieSeasons, player.birthDate)
        : {
            projection: rookieGoalieProjection(),
            gamesPlayed: 45,
          };

      output.push({
        id: player.id,
        name: player.name,
        team: player.team,
        position: "G",
        positions: ["G"],
        isGoalie: true,
        gamesPlayed,
        projection,
      });
      continue;
    }

    const hasHistory = player.skaterSeasons.some((s) => s.gamesPlayed > 5);
    const { projection, gamesPlayed } = hasHistory
      ? projectSkater(
          player.skaterSeasons,
          player.position,
          player.birthDate,
        )
      : {
          projection: rookieSkaterProjection(player.position),
          gamesPlayed: 55,
        };

    output.push({
      id: player.id,
      name: player.name,
      team: player.team,
      position: player.position,
      positions: player.positions,
      isGoalie: false,
      gamesPlayed,
      projection,
    });
  }

  return output;
}

async function main() {
  console.log(`Generating AI-weighted projections for ${PROJECTION_SEASON}...`);
  const playerMap = await buildPlayerMap();
  console.log(`Found ${playerMap.size} NHL players`);

  const rawProjections = buildProjections(playerMap);
  const ranked = applyVor(rawProjections, DEFAULT_LEAGUE);

  const dataset = {
    generatedAt: new Date().toISOString(),
    season: PROJECTION_SEASON,
    league: DEFAULT_LEAGUE,
    replacementLevels: Object.fromEntries(
      ["C", "LW", "RW", "D", "G"].map((pos) => {
        const pool = ranked.filter((p) => p.positions.includes(pos as Position));
        const replacement = pool.find(
          (p) =>
            p.positionRank ===
            DEFAULT_LEAGUE.teams *
              DEFAULT_LEAGUE.roster[pos as keyof typeof DEFAULT_LEAGUE.roster],
        );
        return [pos, replacement?.fantasyValue ?? 0];
      }),
    ),
    players: ranked,
  };

  const outDir = join(process.cwd(), "src", "data");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "players.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      dataset,
      (_key, value) =>
        typeof value === "number" && !Number.isFinite(value) ? 0 : value,
      2,
    ),
  );
  console.log(`Wrote ${ranked.length} player projections to ${outPath}`);
  console.log(
    "Top 5 VOR:",
    ranked
      .slice(0, 5)
      .map((p) => `${p.rank}. ${p.name} (${p.position}) VOR ${p.vor.toFixed(2)}`)
      .join("\n"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
