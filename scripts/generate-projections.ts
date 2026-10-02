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
import { PROJECTION_SEASON, PROJECTION_SEASON_ID } from "../src/lib/nhl-api";
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
  CALIBRATED_GP_CEILING,
  decideSkaterGp,
  gpCurveFor,
  loadGpCalibration,
  priorSeasonIdsFor,
  scaleSkaterProjection,
  splitSeasonRuleFromFiles,
} from "../src/lib/gp-calibration";
import { datasetMismatch, readDatasetManifest } from "../src/lib/ml/dataset-manifest";
import { NHL_TEAMS } from "../src/lib/nhl-api";
import type { NhlListKind, NhlRostersFile } from "../src/lib/nhl-rosters";
import {
  normalizeTeamSkaterGp,
  rookieGpPrior,
  staleReason,
} from "../src/lib/projection-pool";
import {
  buildGoalieRoleMap,
  projectedGoalieGames,
} from "../src/lib/projection-gp";
import { loadRateReference } from "../src/lib/ml/rate-reference";
import {
  applyRateCalibration,
  driftShare,
  meanShiftPer82,
  RATE_SEGMENTS,
  rateCalibrationMeta,
  roundRates,
} from "../src/lib/rate-calibration";
import {
  applyYahooPositionsToPlayer,
  loadYahooPositions,
  yahooPositionsSummary,
} from "../src/lib/yahoo-positions";
import type {
  Category,
  PlayerProjection,
  SkaterCategory,
} from "../src/lib/types";

const PROFILES_PATH = join(process.cwd(), "src", "data", "player-profiles.json");
const ROSTERS_PATH = join(process.cwd(), "src", "data", "nhl-rosters.json");
/** Largest residual-model level shift the rate calibration may remove (healthy: a few %). */
const MAX_RATE_DRIFT = 0.1;
const NHL_TEAM_SET = new Set<string>(NHL_TEAMS);

/**
 * Who each club lists today (src/data/nhl-rosters.json), or null when the
 * snapshot is missing or predates this season's training camps (then no
 * one is dropped for being on no list).
 */
function loadClubLists(): Map<number, NhlListKind> | null {
  if (!existsSync(ROSTERS_PATH)) {
    console.warn("WARN: src/data/nhl-rosters.json missing: no club-list rules (npm run nhl:rosters)");
    return null;
  }
  const file = JSON.parse(readFileSync(ROSTERS_PATH, "utf8")) as NhlRostersFile;
  const fetched = Date.parse(file.fetchedAt);
  const campsOpen = Date.UTC(Number(PROJECTION_SEASON.slice(0, 4)), 8, 1);
  if (!(fetched >= campsOpen) || Date.now() - fetched > 60 * 24 * 60 * 60 * 1000) {
    console.warn(`WARN: nhl-rosters.json fetched ${file.fetchedAt}: before camps or > 60 days old, no club-list rules`);
    return null;
  }
  return new Map(file.players.map((p) => [p.id, p.list]));
}
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
    // REUSE_PROFILES=1: keep the committed dossiers whatever their age (a
    // full rebuild also scrapes contracts); `npm run collect:missing` tops
    // them up with today's roster players.
    const reuse = process.env.REUSE_PROFILES === "1";
    if (data.profiles.length > 0 && (age < PROFILE_HARD_AGE_MS || reuse)) {
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
    // Raw model state (uncapped per-game rates and edges): the rate
    // calibration below, and every later `rates:recalibrate`, starts from it.
    const modelState =
      "perGame" in v2 && v2.perGame && v2.marketEdge
        ? {
            modelRates: roundRates(v2.perGame as Partial<Record<SkaterCategory, number>>),
            modelMarketEdge: roundRates(
              v2.marketEdge as Partial<Record<SkaterCategory, number>>,
            ),
            ...("segment" in v2 ? { modelSegment: v2.segment } : {}),
          }
        : {};
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
      ...modelState,
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

  // The dataset inference reads must be the one the bundle was trained on
  // (src/lib/ml/dataset-manifest.ts): the 2026-07-30 board was generated
  // with another one and published drifted games and rates.
  const datasetManifest = readDatasetManifest();
  if (v2Runtime) {
    console.log(
      `Using v2 stacked ensemble (trained ${v2Runtime.bundle.trainedAt}, dataset ${v2Runtime.bundle.datasetBuiltAt})`,
    );
    const mismatch = datasetManifest ? datasetMismatch(v2Runtime.bundle, datasetManifest) : "dataset.json missing";
    if (mismatch) {
      if (process.env.ALLOW_DATASET_MISMATCH !== "1") {
        throw new Error(
          `${mismatch}. Refusing to project from a dataset the bundle was not trained on: retrain (npm run ml:train-v2) or restore the training dataset (ALLOW_DATASET_MISMATCH=1 to override, inspection only).`,
        );
      }
      console.warn(`WARN: ${mismatch} (ALLOW_DATASET_MISMATCH=1)`);
    } else {
      console.log(`Dataset matches the bundle (sha1 ${datasetManifest!.sha1.slice(0, 12)}, ${datasetManifest!.rows} rows)`);
    }
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
  const clubLists = loadClubLists();
  const lastTwo = priorSeasonIdsFor(DEFAULT_LEAGUE.season);
  const built = profilesWithPositions.map((p) =>
    buildFromProfile(p, aiCache, mlModels, goalieRoleMap, teamGoalies),
  );
  // A skater without a recent NHL game has no model GP (the contextual path
  // gave all of them 62): his draft slot's first-season games, by the list
  // his club has him on (src/lib/projection-pool.ts).
  let rookies = 0;
  const raw = built.map((p) => {
    const profile = profilesWithPositions.find((q) => q.id === p.id);
    if (p.isGoalie || p.projectionMethod !== "contextual" || !profile) return p;
    const recent = profile.teamHistory.some((h) => !h.isGoalie && h.gamesPlayed > 0);
    if (recent) return p;
    const gp = rookieGpPrior(profile.draft?.overallPick, clubLists?.get(p.id));
    rookies++;
    return { ...p, gamesPlayed: gp, projection: projectSkaterFromProfile(profile, gp).projection };
  });
  console.log(`Rookie games prior: ${rookies} skaters without a recent NHL game`);

  // Stamp the position each projection was clamped at BEFORE Yahoo (and later
  // VOR) can remap `position`; rate limits are position-specific, so any
  // re-clamp downstream must use this one.
  const withYahooPositions = raw.map((player) =>
    applyYahooPositionsToPlayer(
      { ...player, primaryPosition: player.position },
      yahooPositions,
    ),
  );

  // Inactive players leave the pool BEFORE tandem renormalization so a
  // retired/inactive goalie never absorbs part of a team's starts budget.
  const inactiveIds = loadInactivePlayerIds();
  const droppedInactive = withYahooPositions.filter((p) => inactiveIds.has(p.id));
  const profileById = new Map(profilesWithPositions.map((p) => [p.id, p]));
  // On no club list today and no NHL game in two seasons: retired, unsigned
  // or gone to Europe — not projected (src/lib/projection-pool.ts).
  const stale = filterActivePlayers(withYahooPositions)
    .map((p) => ({ p, reason: staleReason(p.id, clubLists, profileById.get(p.id), lastTwo) }))
    .filter((x) => x.reason);
  const staleIds = new Set(stale.map((x) => x.p.id));
  const activeBeforeTandem = filterActivePlayers(withYahooPositions).filter((p) => !staleIds.has(p.id));
  if (droppedInactive.length > 0) {
    console.log(
      `Dropped ${droppedInactive.length} curated inactive player(s): ${droppedInactive
        .map((p) => p.name)
        .join(", ")}`,
    );
  }
  if (stale.length > 0) {
    const big = stale.filter((x) => x.p.gamesPlayed >= 30).map((x) => `${x.p.name} (${x.p.gamesPlayed})`);
    console.log(
      `Dropped ${stale.length} player(s) on no NHL club list and without an NHL game in two seasons${big.length ? `, ${big.length} of them at 30+ GP: ${big.join(", ")}` : ""}`,
    );
  }

  // Team tandem: a club's goalies share its 82 games (the starter keeps
  // most of his model games, src/lib/ml/goalie-v2.ts).
  const { renormalizeGoalieGamesByTeam } = await import("../src/lib/ml/goalie-v2");
  const prevGp = new Map(activeBeforeTandem.map((p) => [p.id, p.gamesPlayed]));
  const tandemAdjusted = renormalizeGoalieGamesByTeam(activeBeforeTandem).map((p) => {
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

  // Post-hoc GP calibration: the GP model predicts the games of a player who
  // plays (trained on 10+ game seasons); the out-of-sample curves of
  // src/data/ml/gp-calibration.json map it onto next season's expected games
  // (0 included), per young / veteran × F / D, preserving per-game rates.
  const profilesById = profileById;
  const gpCal = loadGpCalibration();
  if (!gpCal) {
    throw new Error("src/data/ml/gp-calibration.json missing: run scripts/backtest-skater-oos.ts then npm run gp:fit");
  }
  if (gpCal.bundleTrainedAt && v2Runtime && gpCal.bundleTrainedAt !== v2Runtime.bundle.trainedAt) {
    console.warn(
      `WARN: GP calibration fitted with bundle ${gpCal.bundleTrainedAt}, running ${v2Runtime.bundle.trainedAt} — refit it (scripts/backtest-skater-oos.ts, npm run gp:fit)`,
    );
  }
  console.log(`GP calibration: ${gpCal.source}`);
  const curveOf = (p: (typeof tandemAdjusted)[number]) =>
    p.projectionMethod === "ml" ? gpCurveFor(gpCal, p as Parameters<typeof gpCurveFor>[1]) : [];
  // Split / away last seasons (games in another league) take the calibrated
  // split-season rule instead of the curve (src/lib/split-season-gp.ts).
  const splitRule = splitSeasonRuleFromFiles(PROJECTION_SEASON_ID);
  if (!splitRule) {
    console.warn(
      "WARN: no split-season rule (src/data/ml/split-season-gp.json or src/data/league-seasons.json missing): every skater gets the curve",
    );
  }
  const gpCalibrated = tandemAdjusted.map((p) => {
    // Goalies: the model's games before the team allocation (gp:recalibrate reallocates from it).
    if (p.isGoalie) return { ...p, modelGamesPlayed: prevGp.get(p.id) ?? p.gamesPlayed };
    const decision = decideSkaterGp(p, profilesById.get(p.id), curveOf(p), splitRule);
    const newGp = decision.gamesPlayed;
    const availability = decision.availability ? { availability: decision.availability } : {};
    if (p.gamesPlayed <= 0 || newGp === p.gamesPlayed) {
      return { ...p, modelGamesPlayed: p.gamesPlayed, ...availability };
    }
    const ratio = newGp / p.gamesPlayed;
    const profile = profilesById.get(p.id);
    return {
      ...p,
      modelGamesPlayed: p.gamesPlayed,
      gamesPlayed: newGp,
      // A contextual projection is re-projected at the rule's games rather
      // than scaling totals rounded at 3-10 games (see recalibrate-gp.ts).
      projection:
        decision.availability && p.projectionMethod === "contextual" && profile
          ? projectSkaterFromProfile(profile, newGp).projection
          : scaleSkaterProjection(p.projection as never, ratio),
      ...availability,
    };
  });
  console.log(
    `Split-season rule: ${gpCalibrated.filter((p) => "availability" in p && p.availability).length} skaters`,
  );

  // Club budget: 18 skaters × 82 games, ±5 % (src/lib/projection-pool.ts).
  const teamGp = normalizeTeamSkaterGp(
    gpCalibrated.filter((p) => !p.isGoalie && NHL_TEAM_SET.has(p.team)),
    CALIBRATED_GP_CEILING,
  );
  let budgetMoved = 0;
  const budgeted = gpCalibrated.map((p) => {
    const next = teamGp.get(p.id);
    if (next == null || p.isGoalie || !(p.gamesPlayed > 0)) return p;
    const gp = Math.round(next);
    if (gp === p.gamesPlayed) return p;
    budgetMoved += Math.abs(gp - p.gamesPlayed);
    return {
      ...p,
      gamesPlayed: gp,
      projection: scaleSkaterProjection(p.projection as never, gp / p.gamesPlayed),
    };
  });
  console.log(`Club skater-games budget: ${Math.round(budgetMoved)} games moved`);

  // Post-hoc rate calibration: the edge of the residual models should rank
  // players against the synthetic market, not move the league's level. Per
  // meta segment (young / veteran × F / D) and stat, move the edge's fit
  // against the market onto a healthy board's of the same bundle
  // (src/data/ml/rate-reference.json), then recompute the totals from the
  // raw rates at the calibrated games. RATE_CALIBRATION=0 publishes the raw
  // model (inspection only).
  let rateCalibration: ReturnType<typeof rateCalibrationMeta> | undefined;
  let activePool = budgeted;
  if (process.env.RATE_CALIBRATION !== "0") {
    const { reference, note } = loadRateReference();
    console.log(`Rate calibration target: ${note}`);
    const rates = applyRateCalibration(budgeted, { reference });
    activePool = rates.players;
    rateCalibration = rateCalibrationMeta(rates.params, rates.calibrated);
    const worst = driftShare(budgeted, rates.params);
    console.log(`Rate calibration: ${rates.calibrated} skaters; mean shift removed per 82 GP:`);
    for (const seg of RATE_SEGMENTS) {
      const key = rates.params.keyOf[seg];
      const s = (c: "goals" | "assists" | "shots" | "powerplayPoints") =>
        meanShiftPer82(budgeted, rates.params, key, c).toFixed(1);
      console.log(
        `  ${seg} (fit ${key}, n ${rates.params.poolSize[key]}): goals ${s("goals")}, assists ${s("assists")}, PPP ${s("powerplayPoints")}, shots ${s("shots")}`,
      );
    }
    console.log(`Rate calibration: largest level shift ${(worst.share * 100).toFixed(1)}% (${worst.key} ${worst.cat})`);
    if (worst.share > MAX_RATE_DRIFT) {
      // A healthy regeneration moves the level by a few percent at most. A
      // large shift means the inference dataset no longer matches what the
      // bundle was trained on (the 2026-07-30 board: +50% forward goals), or
      // that the reference was not refitted after a retrain.
      const msg = `residual-model level drift ${(worst.share * 100).toFixed(0)}% on ${worst.key} ${worst.cat} (> ${MAX_RATE_DRIFT * 100}%): rebuild dataset.json and retrain, or refit the reference from this bundle's raw board (RATE_CALIBRATION=0 npm run generate, then npm run rates:reference -- --players … --details …)`;
      if (process.env.ALLOW_RATE_DRIFT !== "1") throw new Error(msg);
      console.warn(`WARN: ${msg} (ALLOW_RATE_DRIFT=1)`);
    }
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
    dataManifest: {
      ...dataManifest,
      // What inference read and what the bundle was trained on (they match:
      // generate refuses otherwise).
      dataset: datasetManifest,
      bundleTrainedAt: v2Runtime?.bundle.trainedAt ?? null,
      bundleDatasetSha1: v2Runtime?.bundle.datasetSha1 ?? null,
    },
    gpCalibration: {
      version: 2 as const,
      appliedAt: new Date().toISOString(),
      fittedAt: gpCal.fittedAt,
      source: gpCal.source,
      skaterCurves: gpCal.curves,
      pairCount: gpCal.pairCount,
    },
    ...(rateCalibration ? { rateCalibration } : {}),
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
  const json = JSON.stringify(dataset, (_k, v) =>
    typeof v === "number" && !Number.isFinite(v) ? 0 : v,
  );
  writeFileAtomic(outPath, json);
  // The pre-season baseline of the daily in-season update
  // (scripts/update-in-season.ts): run `npm run season:update` next during
  // the season, players.json is then actual + rest of season again.
  writeFileAtomic(join(process.cwd(), "src", "data", "players-preseason.json"), json);

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
