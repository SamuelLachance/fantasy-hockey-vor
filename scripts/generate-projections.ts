import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { loadAiCache } from "../src/lib/ai-projections";
import {
  getMlModels,
  projectGoalieWithMl,
  projectSkaterWithMl,
} from "../src/lib/ml/predict";
import type { MlModelBundle } from "../src/lib/ml/types";
import {
  projectGoalieFromProfile,
  projectSkaterFromProfile,
} from "../src/lib/contextual-projections";
import { DEFAULT_LEAGUE } from "../src/lib/league";
import { PROJECTION_SEASON } from "../src/lib/nhl-api";
import { collectAllProfiles, normalizeProfile } from "../src/lib/player-profile";
import type { PlayerProfile } from "../src/lib/profile-types";
import { applyVor } from "../src/lib/vor";
import {
  findProjectionIssues,
  clampGoalieProjection,
  clampSkaterProjection,
} from "../src/lib/projection-sanity";
import {
  buildGoalieRoleMap,
  projectedGoalieGames,
} from "../src/lib/projection-gp";
import {
  applyYahooPositionsToPlayer,
  loadYahooPositions,
  yahooPositionsSummary,
} from "../src/lib/yahoo-positions";
import type {
  PlayerProjection,
  Position,
} from "../src/lib/types";

const PROFILES_PATH = join(process.cwd(), "src", "data", "player-profiles.json");
const MAX_PROFILE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function loadProfiles(): Promise<PlayerProfile[]> {
  if (existsSync(PROFILES_PATH)) {
    const data = JSON.parse(readFileSync(PROFILES_PATH, "utf8")) as {
      collectedAt: string;
      profiles: PlayerProfile[];
    };
    const age = Date.now() - new Date(data.collectedAt).getTime();
    if (age < MAX_PROFILE_AGE_MS && data.profiles.length > 0) {
      console.log(`Using cached profiles (${data.profiles.length} players)`);
      return data.profiles;
    }
  }

  console.log("Building fresh player dossiers (this takes several minutes)...");
  const profiles = await collectAllProfiles((d, t) => {
    if (d % 100 === 0) console.log(`  collecting ${d}/${t}`);
  });

  mkdirSync(join(process.cwd(), "src", "data"), { recursive: true });
  writeFileSync(
    PROFILES_PATH,
    JSON.stringify(
      { collectedAt: new Date().toISOString(), count: profiles.length, profiles },
      null,
      2,
    ),
  );
  return profiles;
}

function buildFromProfile(
  profile: PlayerProfile,
  aiCache: ReturnType<typeof loadAiCache>,
  mlModels: MlModelBundle | null,
  goalieRoleMap: ReturnType<typeof buildGoalieRoleMap>,
): Omit<
  PlayerProjection,
  "categoryZScores" | "fantasyValue" | "vor" | "rank" | "positionRank"
> {
  const aiSkater = aiCache?.skaters[profile.id];
  const aiGoalie = aiCache?.goalies[profile.id];

  if (profile.isGoalie && aiGoalie) {
    const gamesPlayed = projectedGoalieGames(profile, goalieRoleMap);
    const gpScale = aiGoalie.gamesPlayed > 0 ? gamesPlayed / aiGoalie.gamesPlayed : 1;
    const projection = clampGoalieProjection(
      {
        wins: Math.round(aiGoalie.wins * gpScale),
        shutouts: Math.round(aiGoalie.shutouts * gpScale),
        saves: Math.round(aiGoalie.saves * gpScale),
        savePct: aiGoalie.savePct,
      },
      gamesPlayed,
    );
    return {
      id: profile.id,
      name: profile.name,
      team: profile.team,
      position: "G",
      positions: ["G"],
      isGoalie: true,
      gamesPlayed,
      projection,
      projectionMethod: "ai",
      confidence: aiGoalie.confidence,
      reasoning: aiGoalie.reasoning,
      profileSummary: profile.contextNarrative,
    };
  }

  if (!profile.isGoalie && aiSkater) {
    const projection = clampSkaterProjection(
      {
        goals: aiSkater.goals,
        assists: aiSkater.assists,
        shots: aiSkater.shots,
        blocks: aiSkater.blocks,
        hits: aiSkater.hits,
        powerplayPoints: aiSkater.powerplayPoints,
        penaltyMinutes: aiSkater.penaltyMinutes,
        faceoffWins: aiSkater.faceoffWins,
      },
      aiSkater.gamesPlayed,
      profile.position,
    );
    return {
      id: profile.id,
      name: profile.name,
      team: profile.team,
      position: profile.position,
      positions: profile.positions,
      isGoalie: false,
      gamesPlayed: aiSkater.gamesPlayed,
      projection,
      projectionMethod: "ai",
      confidence: aiSkater.confidence,
      reasoning: aiSkater.reasoning,
      profileSummary: profile.contextNarrative,
    };
  }

  if (mlModels) {
    const ml = profile.isGoalie
      ? projectGoalieWithMl(profile, mlModels, goalieRoleMap)
      : projectSkaterWithMl(profile, mlModels);
    return {
      id: profile.id,
      name: profile.name,
      team: profile.team,
      position: profile.position,
      positions: profile.positions,
      isGoalie: profile.isGoalie,
      gamesPlayed: ml.gamesPlayed,
      projection: ml.projection,
      projectionMethod: "ml",
      confidence: 0.75,
      reasoning: ml.reasoning,
      profileSummary: profile.contextNarrative,
    };
  }

  const contextual = profile.isGoalie
    ? projectGoalieFromProfile(profile, goalieRoleMap)
    : projectSkaterFromProfile(profile);

  return {
    id: profile.id,
    name: profile.name,
    team: profile.team,
    position: profile.position,
    positions: profile.positions,
    isGoalie: profile.isGoalie,
    gamesPlayed: contextual.gamesPlayed,
    projection: contextual.projection,
    projectionMethod: "contextual",
    confidence: 0.55,
    reasoning: contextual.reasoning,
    profileSummary: profile.contextNarrative,
  };
}

async function main() {
  console.log(`Generating ${PROJECTION_SEASON} projections from full player dossiers...`);

  const profiles = (await loadProfiles()).map(normalizeProfile);
  const goalieRoleMap = buildGoalieRoleMap(profiles);
  const aiCache = loadAiCache();
  const mlModels = getMlModels();
  const aiCount =
    Object.keys(aiCache?.skaters ?? {}).length +
    Object.keys(aiCache?.goalies ?? {}).length;

  if (aiCount > 0) {
    console.log(`Using AI projections for ${aiCount} cached players`);
  } else if (mlModels) {
    console.log(
      `Using trained ML time-series models (${mlModels.skaterModels.length} skater + ${mlModels.goalieModels.length} goalie targets, trained ${mlModels.trainedAt})`,
    );
  } else {
    console.log(
      "No ML models — run npm run ml:dataset && npm run ml:train. Falling back to contextual engine.",
    );
  }

  const yahooPositions = loadYahooPositions();
  console.log(yahooPositionsSummary(yahooPositions));

  const profilesWithPositions = profiles.map((profile) => {
    const mapped = applyYahooPositionsToPlayer(profile, yahooPositions);
    const { positionSource: _, ...rest } = mapped;
    return rest;
  });

  const raw = profilesWithPositions.map((p) =>
    buildFromProfile(p, aiCache, mlModels, goalieRoleMap),
  );

  const withYahooPositions = raw.map((player) =>
    applyYahooPositionsToPlayer(player, yahooPositions),
  );
  const { players: ranked, categoryWeights } = applyVor(
    withYahooPositions,
    DEFAULT_LEAGUE,
  );

  const issues = findProjectionIssues(ranked);
  if (issues.length > 0) {
    console.warn(`Projection sanity check found ${issues.length} issue(s):`);
    for (const issue of issues.slice(0, 10)) {
      console.warn(`  - ${issue.name} (${issue.position}): ${issue.reason}`);
    }
    if (issues.length > 10) {
      console.warn(`  ... and ${issues.length - 10} more`);
    }
    throw new Error("Projection sanity check failed");
  }

  const aiPlayers = ranked.filter((p) => p.projectionMethod === "ai").length;
  const mlPlayers = ranked.filter((p) => p.projectionMethod === "ml").length;
  const engine =
    aiPlayers > ranked.length * 0.5
      ? "openai-dossier"
      : mlPlayers > ranked.length * 0.5
        ? "ml-timeseries"
        : aiPlayers > 0
          ? "hybrid-ai-contextual"
          : mlPlayers > 0
            ? "hybrid-ml-contextual"
            : "contextual-dossier";

  const dataset = {
    generatedAt: new Date().toISOString(),
    season: PROJECTION_SEASON,
    league: DEFAULT_LEAGUE,
    projectionEngine: engine,
    aiModel: aiCache?.model,
    positionSource: yahooPositions ? "yahoo-fantasy" : "nhl-fallback",
    yahooPositionsFetchedAt: yahooPositions?.fetchedAt,
    replacementLevels: Object.fromEntries(
      (["C", "LW", "RW", "D", "G"] as Position[]).map((pos) => {
        const pool = ranked.filter((p) => p.positions.includes(pos));
        const replacement = pool.find(
          (p) =>
            p.positionRank ===
            DEFAULT_LEAGUE.teams * DEFAULT_LEAGUE.roster[pos],
        );
        return [pos, replacement?.fantasyValue ?? 0];
      }),
    ),
    categoryWeights,
    players: ranked,
  };

  const outPath = join(process.cwd(), "src", "data", "players.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      dataset,
      (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? 0 : v),
      2,
    ),
  );

  console.log(
    `Wrote ${ranked.length} projections (${mlPlayers} ML, ${aiPlayers} AI, engine: ${engine})`,
  );
  console.log(
    "Top 5 VOR:",
    ranked
      .slice(0, 5)
      .map(
        (p) =>
          `${p.rank}. ${p.name} (${p.positions.join("/")} VOR@${p.position}) ${p.vor.toFixed(2)} [${p.projectionMethod}]`,
      )
      .join("\n"),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
