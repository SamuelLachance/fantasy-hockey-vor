import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { loadAiCache } from "../src/lib/ai-projections";
import {
  getMlModels,
  projectGoalieWithMl,
  projectSkaterWithMl,
} from "../src/lib/ml/predict";
import { setInferenceTeamDepthCache, buildTeamDepthFromProfiles } from "../src/lib/ml/team-depth";
import { loadContextCaches } from "../src/lib/ml/enrich-rows";
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

async function loadProfiles(): Promise<{
  profiles: PlayerProfile[];
  collectedAt: string;
}> {
  if (existsSync(PROFILES_PATH)) {
    const data = JSON.parse(readFileSync(PROFILES_PATH, "utf8")) as {
      collectedAt: string;
      profiles: PlayerProfile[];
    };
    const age = Date.now() - new Date(data.collectedAt).getTime();
    if (age < MAX_PROFILE_AGE_MS && data.profiles.length > 0) {
      console.log(`Using cached profiles (${data.profiles.length} players)`);
      return { profiles: data.profiles, collectedAt: data.collectedAt };
    }
  }

  console.log("Building fresh player dossiers (this takes several minutes)...");
  const profiles = await collectAllProfiles((d, t) => {
    if (d % 100 === 0) console.log(`  collecting ${d}/${t}`);
  });

  const collectedAt = new Date().toISOString();
  writeFileAtomic(
    PROFILES_PATH,
    JSON.stringify(
      { collectedAt, count: profiles.length, profiles },
      null,
      2,
    ),
  );
  return { profiles, collectedAt };
}

function buildFromProfile(
  profile: PlayerProfile,
  aiCache: ReturnType<typeof loadAiCache>,
  mlModels: MlModelBundle | null,
  goalieRoleMap: ReturnType<typeof buildGoalieRoleMap>,
  teamGoalies: PlayerProfile[],
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
      ? projectGoalieWithMl(profile, mlModels, goalieRoleMap, teamGoalies)
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

  const { profiles: rawProfiles, collectedAt: profilesCollectedAt } =
    await loadProfiles();
  const profiles = rawProfiles.map(normalizeProfile);
  const goalieRoleMap = buildGoalieRoleMap(profiles);
  const aiCache = loadAiCache();
  const mlModels = getMlModels();
  const aiCount =
    Object.keys(aiCache?.skaters ?? {}).length +
    Object.keys(aiCache?.goalies ?? {}).length;

  const contextCaches = loadContextCaches();
  if (mlModels && !contextCaches) {
    throw new Error(
      "ML models are present but src/data/ml/context-cache.json is missing. " +
        "Inference would silently degrade (neutral age/draft/team context). " +
        "Run `npm run ml:context` first, or restore the committed cache.",
    );
  }

  if (aiCount > 0) {
    console.log(`Using AI projections for ${aiCount} cached players`);
  } else if (mlModels) {
    console.log(
      `Using ML models (${mlModels.skaterModels.length} skater stat models; goalies via lag1 persistence + team-normalized GP, trained ${mlModels.trainedAt})`,
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

  setInferenceTeamDepthCache(buildTeamDepthFromProfiles(profilesWithPositions));

  const teamGoalies = profilesWithPositions.filter((p) => p.isGoalie);
  const raw = profilesWithPositions.map((p) =>
    buildFromProfile(p, aiCache, mlModels, goalieRoleMap, teamGoalies),
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

  // Long-form text lives in a separate lazily-fetched file so the table
  // payload shipped to the client stays small.
  const playerDetails = Object.fromEntries(
    ranked.map((p) => [
      p.id,
      {
        reasoning: p.reasoning ?? "",
        profileSummary: p.profileSummary ?? "",
      },
    ]),
  );
  const slimPlayers = ranked.map((p) => {
    const { reasoning: _reasoning, profileSummary: _profileSummary, ...rest } = p;
    return rest;
  });

  // Provenance manifest: which upstream artifacts fed this dataset, and how
  // fresh each was. Warn on stale/skewed inputs so drift is visible.
  const dataManifest = {
    profilesCollectedAt,
    modelsTrainedAt: mlModels?.trainedAt ?? null,
    contextCacheBuiltAt: contextCaches?.builtAt ?? null,
    yahooPositionsFetchedAt: yahooPositions?.fetchedAt ?? null,
    aiCacheGeneratedAt: aiCache?.generatedAt ?? null,
  };
  const staleDays = (iso: string | null): number | null => {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) ? (Date.now() - t) / (24 * 60 * 60 * 1000) : null;
  };
  for (const [name, iso] of Object.entries(dataManifest)) {
    const days = staleDays(iso);
    if (days != null && days > 30) {
      console.warn(`WARN: ${name} is ${days.toFixed(0)} days old`);
    }
  }

  const dataset = {
    generatedAt: new Date().toISOString(),
    season: PROJECTION_SEASON,
    league: DEFAULT_LEAGUE,
    dataManifest,
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
    players: slimPlayers,
  };

  const outPath = join(process.cwd(), "src", "data", "players.json");
  writeFileAtomic(
    outPath,
    JSON.stringify(
      dataset,
      (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? 0 : v),
      2,
    ),
  );

  writeFileAtomic(
    join(process.cwd(), "public", "player-details.json"),
    JSON.stringify(playerDetails),
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
