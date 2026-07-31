import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { loadAiCache } from "../src/lib/ai-projections";
import {
  getMlModels,
  projectGoalieWithMl,
  projectSkaterWithMl,
} from "../src/lib/ml/predict";
import {
  getV2Runtime,
  projectGoalieV2,
  projectSkaterV2,
} from "../src/lib/ml/predict-v2";
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
import { attachDraftEdge } from "../src/lib/draft-edge";
import {
  filterActivePlayers,
  loadInactivePlayerIds,
} from "../src/lib/inactive-players";
import { splitPublishedPlayer } from "../src/lib/publish-players";
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
import type { Category, PlayerProjection } from "../src/lib/types";

const PROFILES_PATH = join(process.cwd(), "src", "data", "player-profiles.json");
/** Hard rebuild after this; warn-but-reuse between soft and hard (matches site stale banner). */
const PROFILE_SOFT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PROFILE_HARD_AGE_MS = 21 * 24 * 60 * 60 * 1000;

async function loadProfiles(): Promise<{
  profiles: PlayerProfile[];
  collectedAt: string;
}> {
  if (existsSync(PROFILES_PATH) && process.env.FORCE_PROFILES !== "1") {
    const data = JSON.parse(readFileSync(PROFILES_PATH, "utf8")) as {
      collectedAt: string;
      profiles: PlayerProfile[];
    };
    const age = Date.now() - new Date(data.collectedAt).getTime();
    if (data.profiles.length > 0 && age < PROFILE_HARD_AGE_MS) {
      const days = age / (24 * 60 * 60 * 1000);
      if (age >= PROFILE_SOFT_AGE_MS) {
        console.warn(
          `WARN: using profiles ${days.toFixed(0)}d old (force refresh with FORCE_PROFILES=1)`,
        );
      } else {
        console.log(`Using cached profiles (${data.profiles.length} players)`);
      }
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
  // v2 stacked ensemble is the primary engine for players with NHL history.
  const v2 = profile.isGoalie ? projectGoalieV2(profile) : projectSkaterV2(profile);
  if (v2) {
    const projection = profile.isGoalie
      ? clampGoalieProjection(v2.projection as never, v2.gamesPlayed)
      : clampSkaterProjection(v2.projection as never, v2.gamesPlayed, profile.position);
    return {
      id: profile.id,
      name: profile.name,
      team: profile.team,
      position: profile.position,
      positions: profile.positions,
      isGoalie: profile.isGoalie,
      gamesPlayed: v2.gamesPlayed,
      projection,
      projectionMethod: "ml",
      confidence: 0.8,
      reasoning: v2.reasoning,
      profileSummary: profile.contextNarrative,
      ...("marketEdge" in v2 && v2.marketEdge
        ? { marketEdge: v2.marketEdge as Partial<Record<Category, number>> }
        : {}),
      ...("uncertainty" in v2 && v2.uncertainty
        ? { uncertainty: v2.uncertainty }
        : {}),
    };
  }

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
  const aiCount =
    Object.keys(aiCache?.skaters ?? {}).length +
    Object.keys(aiCache?.goalies ?? {}).length;

  // Prefer v2 — skip parsing the legacy v1 models.json when the stacked
  // ensemble is available (cold-start generate is dataset-bound, not v1-bound).
  const v2Runtime = getV2Runtime();
  const mlModels = v2Runtime ? null : getMlModels();
  const contextCaches = loadContextCaches();
  if (mlModels && !contextCaches) {
    throw new Error(
      "ML models are present but src/data/ml/context-cache.json is missing. " +
        "Inference would silently degrade (neutral age/draft/team context). " +
        "Run `npm run ml:context` first, or restore the committed cache.",
    );
  }

  if (v2Runtime) {
    console.log(
      `Using v2 stacked ensemble (trained ${v2Runtime.bundle.trainedAt}, dataset ${v2Runtime.bundle.datasetBuiltAt})`,
    );
  } else if (process.env.ALLOW_NON_V2 !== "1") {
    // dataset.json is gitignored, so a fresh clone would otherwise silently
    // publish v1/contextual rankings under the v2 branding.
    throw new Error(
      "v2 stacked ensemble unavailable (src/data/ml/v2-bundle.json or src/data/ml/dataset.json missing or unreadable). " +
        "Refusing to silently fall back to v1/contextual projections. " +
        "Run `npm run ml:dataset` first, or set ALLOW_NON_V2=1 to override.",
    );
  }
  if (aiCount > 0) {
    console.log(`Using AI projections for ${aiCount} cached players`);
  } else if (mlModels) {
    console.log(
      `Fallback ML models available (${mlModels.skaterModels.length} skater stat models, trained ${mlModels.trainedAt})`,
    );
  } else if (!v2Runtime) {
    console.log(
      "No ML models — run npm run ml:dataset && npm run ml:train-v2. Falling back to contextual engine.",
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

  // Team tandem: goalie GP on a club should sum near a full season.
  const { renormalizeGoalieGamesByTeam } = await import("../src/lib/ml/goalie-v2");
  const prevGp = new Map(withYahooPositions.map((p) => [p.id, p.gamesPlayed]));
  const tandemAdjusted = renormalizeGoalieGamesByTeam(withYahooPositions).map((p) => {
    if (!p.isGoalie) return p;
    const gp = p.gamesPlayed;
    const prev = prevGp.get(p.id) ?? gp;
    if (prev <= 0 || gp === prev) return p;
    const scale = gp / prev;
    const proj = p.projection as {
      wins: number;
      saves: number;
      shutouts: number;
      savePct: number;
    };
    return {
      ...p,
      gamesPlayed: gp,
      projection: {
        wins: Math.max(0, Math.round(proj.wins * scale)),
        saves: Math.max(0, Math.round(proj.saves * scale)),
        shutouts: Math.max(0, Math.round(proj.shutouts * scale)),
        savePct: proj.savePct,
      },
    };
  });

  const inactiveIds = loadInactivePlayerIds();
  const droppedInactive = tandemAdjusted.filter((p) => inactiveIds.has(p.id));
  const activePool = filterActivePlayers(tandemAdjusted);
  if (droppedInactive.length > 0) {
    console.log(
      `Dropped ${droppedInactive.length} curated inactive player(s): ${droppedInactive
        .map((p) => p.name)
        .join(", ")}`,
    );
  }

  const {
    players: ranked,
    categoryWeights,
    replacementLevels,
    draftableIds,
  } = applyVor(activePool, DEFAULT_LEAGUE);

  // Synthetic-market Edge: shared helper keeps generate and vor:reapply aligned.
  attachDraftEdge(ranked, activePool, DEFAULT_LEAGUE, {
    categoryWeights,
    replacementLevels,
    draftableIds,
  });

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
        ? "stacked-ensemble"
        : aiPlayers > 0
          ? "hybrid-ai-contextual"
          : mlPlayers > 0
            ? "hybrid-ml-contextual"
            : "contextual-dossier";

  // Long-form text + per-stat uncertainty live in a lazily-fetched file so
  // the table payload shipped to the client stays small (~half the bytes).
  const playerDetails: Record<
    string,
    ReturnType<typeof splitPublishedPlayer>["detail"]
  > = {};
  const slimPlayers = ranked.map((p) => {
    const { board, detail } = splitPublishedPlayer(p);
    playerDetails[String(p.id)] = detail;
    return board;
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
    replacementLevels,
    categoryWeights,
    players: slimPlayers,
  };

  const outPath = join(process.cwd(), "src", "data", "players.json");
  // Compact JSON: ~half the bytes of indent-2, faster Pages / client parse.
  writeFileAtomic(
    outPath,
    JSON.stringify(dataset, (_k, v) =>
      typeof v === "number" && !Number.isFinite(v) ? 0 : v,
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
  const topG = ranked.filter((p) => p.isGoalie).slice(0, 5);
  console.log(
    "Top 5 G:",
    topG
      .map(
        (p) =>
          `${p.rank}. ${p.name} (${p.team}) GP ${p.gamesPlayed} VOR ${p.vor.toFixed(2)}`,
      )
      .join("\n"),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
