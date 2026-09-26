/**
 * Post-hoc skater rate calibration on the committed players.json (no ML
 * regenerate), then a full VOR + Edge republish. The why and the math are in
 * src/lib/rate-calibration.ts: per meta segment (young / veteran × F / D)
 * and stat, move the residual models' edge onto the healthy reference
 * board's (src/data/ml/rate-reference.json, `npm run rates:reference`),
 * keep the market.
 *
 * Idempotent: the raw v2 rates (`modelRates`, uncapped), edges
 * (`modelMarketEdge`) and segment (`modelSegment`) live in
 * public/player-details.json and every run recalibrates from them
 * (`generate` writes them too). A board published before they existed is
 * bootstrapped once, with the synthetic market rebuilt from the committed
 * profiles (src/lib/ml/market-rebuild.ts, bootstrapModelRates): with a
 * reliable rebuild every cell moves onto the rebuilt market and keeps its
 * edge (the 2026-07-30 dataset had wrong hits / blocks / PPP histories for
 * many regulars), a grossly corrupted cell (Weegar's blocks...) gets the
 * rebuilt market and no edge, and a cell the old rate caps clipped (D goals
 * at 0.18 per game...) gets market + edge. The segment comes from the v2
 * reasoning ("young segment"). The bootstrap refuses to run when the
 * rebuild does not reproduce the market of the cells that are fine.
 *
 * Downstream (in order): npm run draft:board, npm run league:sync (Fantrax
 * values + dynasty), or npm run dynasty:build alone.
 *
 * Run: npm run rates:recalibrate [-- --dry-run]
 */
import { readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { attachDraftEdge } from "../src/lib/draft-edge";
import { filterActivePlayers } from "../src/lib/inactive-players";
import { DEFAULT_LEAGUE } from "../src/lib/league";
import { buildMarketRebuilder, type MarketRebuild } from "../src/lib/ml/market-rebuild";
import { loadRateReference } from "../src/lib/ml/rate-reference";
import { normalizeProfile } from "../src/lib/player-profile";
import type { PlayerProfile } from "../src/lib/profile-types";
import {
  detailCarryFields,
  splitPublishedPlayer,
  type PlayerDetailRecord,
} from "../src/lib/publish-players";
import {
  applyRateCalibration,
  bootstrapModelRates,
  driftShare,
  isReliableRebuild,
  legacyCappedCells,
  meanShiftPer82,
  RATE_SEGMENTS,
  rateCalibrationMeta,
  rateGroup,
  roundRates,
  segmentFromReasoning,
  segmentLevelIssues,
  segmentLevels,
  type RateBootstrapMeta,
} from "../src/lib/rate-calibration";
import type {
  PlayerProjection,
  ProjectionsDataset,
  SkaterCategory,
  SkaterProjection,
} from "../src/lib/types";
import { SKATER_CATEGORIES } from "../src/lib/types";
import { applyVor } from "../src/lib/vor";
import {
  applyYahooPositionsToPlayer,
  loadYahooPositions,
} from "../src/lib/yahoo-positions";

const PLAYERS = join(process.cwd(), "src", "data", "players.json");
const DETAILS = join(process.cwd(), "public", "player-details.json");
const PROFILES = join(process.cwd(), "src", "data", "player-profiles.json");
const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Median |rebuilt − implied| market per game the bootstrap tolerates, per
 * stat, over the reliable uncapped cells of the regulars. On the 2026-08-11
 * board the medians are ~0.007 goals / assists / PPP, 0.015 shots / PIM,
 * 0.01-0.02 blocks and 0.03-0.045 hits (the corrupted cells sit in the
 * tail), about 3x below these limits.
 */
const MAX_MARKET_REBUILD_ERROR: Partial<Record<SkaterCategory, number>> = {
  goals: 0.02,
  assists: 0.025,
  powerplayPoints: 0.02,
  shots: 0.05,
  hits: 0.12,
  blocks: 0.06,
  penaltyMinutes: 0.05,
  faceoffWins: 0.06,
};

const data = JSON.parse(readFileSync(PLAYERS, "utf8")) as ProjectionsDataset;
const details = JSON.parse(readFileSync(DETAILS, "utf8")) as Record<
  string,
  Partial<PlayerDetailRecord>
>;
const profileFile = JSON.parse(readFileSync(PROFILES, "utf8")) as {
  profiles: PlayerProfile[] | Record<string, PlayerProfile>;
};
const profiles = Object.values(profileFile.profiles);
const profilePosition = new Map(profiles.map((p) => [p.id, p.position]));

const league = {
  ...DEFAULT_LEAGUE,
  season: data.league?.season ?? DEFAULT_LEAGUE.season,
};

type Hydrated = Omit<
  PlayerProjection,
  | "categoryZScores"
  | "fantasyValue"
  | "vor"
  | "rank"
  | "positionRank"
  | "vorByPosition"
  | "vorPosition"
  | "syntheticMarketRank"
  | "draftValue"
>;

const hydrated: Hydrated[] = data.players.map((p) => {
  const {
    categoryZScores: _z,
    fantasyValue: _fv,
    vor: _v,
    rank: _r,
    positionRank: _pr,
    vorByPosition: _vbp,
    vorPosition: _vp,
    syntheticMarketRank: _sm,
    draftValue: _dv,
    ...rest
  } = p;
  const d = details[String(p.id)];
  return {
    ...rest,
    primaryPosition: p.primaryPosition ?? profilePosition.get(p.id) ?? p.position,
    reasoning: d?.reasoning,
    profileSummary: d?.profileSummary,
    ...detailCarryFields(d),
  };
});

const isV2Skater = (p: Hydrated) =>
  !p.isGoalie && p.projectionMethod === "ml" && p.marketEdge != null;

// ---- meta segment of every v2 skater (boards before modelSegment: reasoning)
let segmentsFromReasoning = 0;
for (const p of hydrated) {
  if (!isV2Skater(p) || p.modelSegment) continue;
  const seg = segmentFromReasoning(p.reasoning);
  if (seg) {
    p.modelSegment = seg;
    segmentsFromReasoning++;
  }
}
if (segmentsFromReasoning > 0) {
  console.log(`Meta segment read from the v2 reasoning for ${segmentsFromReasoning} skaters`);
}

// ---- bootstrap a legacy board (no raw model state yet)
const legacy = hydrated.filter((p) => isV2Skater(p) && !p.modelRates);
const uncappedLog: string[] = [];
const repairedLog: string[] = [];
let bootstrapMeta: RateBootstrapMeta | undefined = data.rateCalibration?.bootstrap;
if (legacy.length > 0) {
  console.log(`Bootstrapping raw model rates for ${legacy.length} v2 skaters (legacy board)`);
  const yahoo = loadYahooPositions();
  const inferenceProfiles = profiles.map(normalizeProfile).map((profile) => {
    const { positionSource: _, ...rest } = applyYahooPositionsToPlayer(profile, yahoo);
    return rest as PlayerProfile;
  });
  const marketOf = buildMarketRebuilder(inferenceProfiles);

  // Self-check: the rebuilt market must reproduce the implied market
  // (published rate − edge) of the reliable cells no cap touched, for every
  // stat (median: the corrupted cells are a minority in the tail).
  const errors: Partial<Record<SkaterCategory, number[]>> = {};
  const rebuilds = new Map<number, MarketRebuild | null>();
  for (const p of legacy) {
    const rebuild = marketOf(p.id);
    rebuilds.set(p.id, rebuild);
    if (!rebuild || !isReliableRebuild(rebuild) || p.gamesPlayed < 40) continue;
    const proj = p.projection as SkaterProjection;
    const capped = new Set(legacyCappedCells({ ...p, projection: proj }));
    for (const cat of SKATER_CATEGORIES) {
      if (capped.has(cat)) continue;
      if (cat === "faceoffWins" && (p.primaryPosition ?? p.position) !== "C") continue;
      const e = p.marketEdge?.[cat];
      const m = rebuild.rates[cat];
      if (typeof e !== "number" || typeof m !== "number") continue;
      (errors[cat] ??= []).push(Math.abs(m - (proj[cat] / p.gamesPlayed - e)));
    }
  }
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : NaN;
  };
  const failures: string[] = [];
  for (const cat of SKATER_CATEGORIES) {
    const xs = errors[cat] ?? [];
    const med = median(xs);
    const limit = MAX_MARKET_REBUILD_ERROR[cat] ?? Infinity;
    console.log(
      `  market rebuild vs implied (${cat}): median |Δ| ${med.toFixed(4)}/game over ${xs.length} players (limit ${limit})`,
    );
    if (!(med <= limit)) failures.push(`${cat} ${med}`);
  }
  if (failures.length > 0) {
    throw new Error(
      `market rebuild does not reproduce the published market (median error ${failures.join(", ")}); refusing to bootstrap`,
    );
  }

  let uncappedCells = 0;
  let repairedCells = 0;
  let rebasedCells = 0;
  let reliablePlayers = 0;
  const rebasedByCat: Partial<Record<SkaterCategory, number>> = {};
  for (const p of legacy) {
    const rebuild = rebuilds.get(p.id) ?? null;
    const reliable = rebuild != null && isReliableRebuild(rebuild);
    if (reliable) reliablePlayers++;
    const { rates, edge, uncapped, repaired, rebased } = bootstrapModelRates(
      { ...p, projection: p.projection as SkaterProjection },
      (p.marketEdge ?? {}) as Partial<Record<SkaterCategory, number>>,
      rebuild?.rates ?? null,
      reliable,
    );
    p.modelRates = roundRates(rates);
    p.modelMarketEdge = roundRates(edge);
    uncappedCells += uncapped.length;
    repairedCells += repaired.length;
    rebasedCells += rebased.length;
    for (const cat of rebased) rebasedByCat[cat] = (rebasedByCat[cat] ?? 0) + 1;
    const proj = p.projection as SkaterProjection;
    const show = (cat: SkaterCategory) =>
      `${cat} ${(proj[cat] / Math.max(1, p.gamesPlayed)).toFixed(3)}→${rates[cat].toFixed(3)}`;
    if (uncapped.length > 0) uncappedLog.push(`${p.name} (${uncapped.map(show).join(", ")})`);
    if (repaired.length > 0) repairedLog.push(`${p.name} (${repaired.map(show).join(", ")})`);
  }
  console.log(`  reliable rebuilds: ${reliablePlayers} of ${legacy.length} players`);
  console.log(
    `  uncapped (market + edge) ${uncappedCells} cells, ${uncappedLog.length} players: ${uncappedLog.join("; ")}`,
  );
  console.log(
    `  market repaired (rebuilt market, no edge) ${repairedCells} cells, ${repairedLog.length} players: ${repairedLog.join("; ")}`,
  );
  console.log(
    `  market rebased (rebuilt market + edge, moved by more than rounding) ${rebasedCells} cells: ${Object.entries(
      rebasedByCat,
    )
      .map(([c, n]) => `${c} ${n}`)
      .join(", ")}`,
  );
  bootstrapMeta = {
    appliedAt: new Date().toISOString(),
    players: legacy.length,
    uncappedCells,
    repairedCells,
    rebasedCells,
    reliablePlayers,
  };
}

// ---- calibrate from the raw model state
const { reference, note } = loadRateReference();
console.log(`Rate calibration target: ${note}`);
const {
  players: calibrated,
  params,
  calibrated: calibratedCount,
} = applyRateCalibration(hydrated, { reference });
const worst = driftShare(hydrated, params);
console.log(
  `Rate calibration on ${calibratedCount} skaters; largest level shift ${(worst.share * 100).toFixed(0)}% (${worst.key} ${worst.cat})`,
);
const LOG_CATS: SkaterCategory[] = [
  "goals",
  "assists",
  "powerplayPoints",
  "shots",
  "hits",
  "blocks",
  "penaltyMinutes",
  "faceoffWins",
];
for (const seg of RATE_SEGMENTS) {
  const key = params.keyOf[seg];
  console.log(
    `  ${seg} (fit ${key}, n ${params.poolSize[key]}) shift per 82: ${LOG_CATS.filter(
      (c) => c !== "faceoffWins" || !seg.endsWith("D"),
    )
      .map((c) => `${c} ${meanShiftPer82(hydrated, params, key, c).toFixed(1)}`)
      .join(", ")}`,
  );
}
for (const l of segmentLevels(calibrated)) {
  console.log(
    `  level ${l.segment} ${l.cat}: projection / no-growth market ${l.ratio.toFixed(3)} [${l.bounds.join(", ")}]`,
  );
}
for (const issue of segmentLevelIssues(calibrated)) console.warn(`WARN: ${issue}`);

// League level check: per skater-game over the v2 skaters with 40+ games.
function perGameLevel(players: Hydrated[]): string {
  const pool = players.filter((p) => isV2Skater(p) && p.gamesPlayed >= 40);
  const gp = pool.reduce((s, p) => s + p.gamesPlayed, 0);
  const sum = (cat: SkaterCategory) =>
    pool.reduce((s, p) => s + (p.projection as SkaterProjection)[cat], 0) / Math.max(1, gp);
  return `G ${sum("goals").toFixed(3)} A ${sum("assists").toFixed(3)} PPP ${sum("powerplayPoints").toFixed(3)} SOG ${sum("shots").toFixed(2)} HIT ${sum("hits").toFixed(2)} BLK ${sum("blocks").toFixed(2)}`;
}
console.log(`Per skater-game before: ${perGameLevel(hydrated)}`);
console.log(`Per skater-game after:  ${perGameLevel(calibrated)}`);

const beforeById = new Map(hydrated.map((p) => [p.id, p]));
const topDGoals = calibrated
  .filter((p) => !p.isGoalie && rateGroup(p) === "D")
  .sort(
    (a, b) =>
      (b.projection as SkaterProjection).goals - (a.projection as SkaterProjection).goals,
  )
  .slice(0, 12);
console.log(
  "Top D goals:",
  topDGoals
    .map((p) => {
      const was = (beforeById.get(p.id)?.projection as SkaterProjection | undefined)?.goals;
      return `${p.name} ${was}→${(p.projection as SkaterProjection).goals}`;
    })
    .join(", "),
);

if (DRY_RUN) {
  console.log("--dry-run: nothing written");
  process.exit(0);
}

// ---- republish: VOR + Edge, board + details
const raw = filterActivePlayers(calibrated);
const {
  players: ranked,
  categoryWeights,
  replacementLevels,
  draftableIds,
} = applyVor(raw, league);
attachDraftEdge(ranked, raw, league, {
  categoryWeights,
  replacementLevels,
  draftableIds,
});

const playerDetails: Record<string, PlayerDetailRecord> = {};
const slimPlayers = ranked.map((p) => {
  const prev = details[String(p.id)];
  const { board, detail } = splitPublishedPlayer(p);
  if (prev?.perStatSigma && !detail.perStatSigma) detail.perStatSigma = prev.perStatSigma;
  if (prev?.reasoning && !detail.reasoning) detail.reasoning = prev.reasoning;
  if (prev?.profileSummary && !detail.profileSummary) {
    detail.profileSummary = prev.profileSummary;
  }
  playerDetails[String(p.id)] = detail;
  return board;
});

const out: ProjectionsDataset = {
  ...data,
  league,
  generatedAt: new Date().toISOString(),
  rateCalibration: rateCalibrationMeta(params, calibratedCount, undefined, bootstrapMeta),
  categoryWeights,
  replacementLevels,
  players: slimPlayers,
};

writeFileAtomic(
  PLAYERS,
  JSON.stringify(out, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? 0 : v)),
);
writeFileAtomic(DETAILS, JSON.stringify(playerDetails));

console.log("Top 10 after rate calibration + vor:");
for (const p of ranked.slice(0, 10)) {
  console.log(`  ${p.rank}. ${p.name} (${p.position}) GP ${p.gamesPlayed} VOR ${p.vor.toFixed(2)}`);
}
