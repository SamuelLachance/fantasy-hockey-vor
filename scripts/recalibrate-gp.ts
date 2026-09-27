/**
 * Post-hoc GP recalibration on committed players.json (no ML regenerate),
 * then the rate calibration (when the board carries raw model rates) and a
 * full VOR + Edge republish. Idempotent: raw model GP is preserved in
 * modelGamesPlayed and every run recalibrates from it.
 * Run: npx tsx scripts/recalibrate-gp.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { attachDraftEdge } from "../src/lib/draft-edge";
import {
  calibratedGoalieGp,
  decideSkaterGp,
  fitSkaterGpCurve,
  modelGp,
  projectionSeasonIdOf,
  splitSeasonRuleFromFiles,
} from "../src/lib/gp-calibration";
import { projectSkaterFromProfile } from "../src/lib/contextual-projections";
import { filterActivePlayers } from "../src/lib/inactive-players";
import { normalizeProfile } from "../src/lib/player-profile";
import { DEFAULT_LEAGUE } from "../src/lib/league";
import type { PlayerProfile } from "../src/lib/profile-types";
import { loadRateReference } from "../src/lib/ml/rate-reference";
import {
  applyRateCalibration,
  rateCalibrationMeta,
} from "../src/lib/rate-calibration";
import {
  detailCarryFields,
  splitPublishedPlayer,
  type PlayerDetailRecord,
} from "../src/lib/publish-players";
import { applyVor } from "../src/lib/vor";
import type {
  Category,
  GoalieProjection,
  ProjectionsDataset,
  SkaterProjection,
} from "../src/lib/types";
import {
  scaleGoalieProjection,
  scaleSkaterProjection,
} from "../src/lib/gp-calibration";

const PLAYERS = join(process.cwd(), "src", "data", "players.json");
const DETAILS = join(process.cwd(), "public", "player-details.json");
const PROFILES = join(process.cwd(), "src", "data", "player-profiles.json");

const data = JSON.parse(readFileSync(PLAYERS, "utf8")) as ProjectionsDataset;
const details = JSON.parse(readFileSync(DETAILS, "utf8")) as Record<
  string,
  Partial<PlayerDetailRecord>
>;
const profileFile = JSON.parse(readFileSync(PROFILES, "utf8")) as {
  profiles: Record<string, PlayerProfile>;
};
const profilesById = new Map<number, PlayerProfile>(
  Object.values(profileFile.profiles).map((p) => [p.id, p]),
);

// Roster/season come from the dataset; scoring policy (goalieVorFactor)
// always follows the current DEFAULT_LEAGUE so a republish picks up tuning.
const league = {
  ...DEFAULT_LEAGUE,
  season: data.league?.season ?? DEFAULT_LEAGUE.season,
};
const season = league.season;

const { curve, pairCount } = fitSkaterGpCurve(data.players, profilesById, season);
console.log(`Skater isotonic curve: ${curve.length} blocks from ${pairCount} pairs`);

const goalieGp = calibratedGoalieGp(data.players, profilesById, season);

// Split / away last seasons (games in another league): the calibrated
// split-season rule replaces the curve (src/lib/split-season-gp.ts).
const splitRule = splitSeasonRuleFromFiles(projectionSeasonIdOf(season));
if (!splitRule) {
  console.warn(
    "WARN: no split-season rule (src/data/ml/split-season-gp.json or src/data/league-seasons.json missing): every skater gets the curve",
  );
}
let splitCount = 0;

const calibrated = data.players.map((p) => {
  const rawModelGp = modelGp(p);
  // Board `position` is the VOR slot; the projection was built and clamped at
  // the profile's position. Recover it so Edge reconstruction re-clamps with
  // the same rate limits generate used.
  const primaryPosition =
    p.primaryPosition ?? profilesById.get(p.id)?.position ?? p.position;
  const decision = p.isGoalie
    ? null
    : decideSkaterGp(p, profilesById.get(p.id), curve, splitRule);
  const newGp = decision ? decision.gamesPlayed : (goalieGp.get(p.id) ?? p.gamesPlayed);
  // A previous run's rule marker is recomputed, never carried over.
  const { availability: _previous, ...rest } = p;
  const availability = decision?.availability ? { availability: decision.availability } : {};
  if (decision?.availability) splitCount++;
  const prevGp = p.gamesPlayed;
  const profile = profilesById.get(p.id);
  // A contextual projection (no NHL season of 10 games) is re-projected at
  // the rule's games: its totals were rounded per stat at 3-10 games, and
  // scaling them to 40 would multiply the rounding (1 goal in 3 → 16 in 48).
  // A pure function of the profile and the games, so it runs on every pass
  // (a fix to the contextual rates reaches a board whose games are settled).
  const reproject =
    !p.isGoalie && decision?.availability && p.projectionMethod === "contextual" && profile
      ? () =>
          projectSkaterFromProfile({ ...normalizeProfile(profile), position: primaryPosition }, newGp)
            .projection
      : null;
  if (prevGp <= 0 || newGp === prevGp) {
    return {
      ...rest,
      primaryPosition,
      modelGamesPlayed: rawModelGp,
      ...(reproject && prevGp > 0 ? { projection: reproject() } : {}),
      ...availability,
    };
  }
  const ratio = newGp / prevGp;
  const projection = p.isGoalie
    ? scaleGoalieProjection(p.projection as GoalieProjection, ratio)
    : reproject
      ? reproject()
      : scaleSkaterProjection(p.projection as SkaterProjection, ratio);
  const uncertainty = p.uncertainty
    ? {
        ...p.uncertainty,
        total: {
          ...p.uncertainty.total,
          sigma: p.uncertainty.total.sigma * ratio,
          aleatoric: p.uncertainty.total.aleatoric * ratio,
          modelSpread: p.uncertainty.total.modelSpread * ratio,
        },
      }
    : undefined;
  return {
    ...rest,
    primaryPosition,
    modelGamesPlayed: rawModelGp,
    gamesPlayed: newGp,
    projection,
    ...(uncertainty ? { uncertainty } : {}),
    ...availability,
  };
});
console.log(
  `Split-season rule: ${splitCount} skaters (last season split with, or spent in, another league)`,
);

// σ per-stat des détails suit le même ratio que les totaux.
const sigmaRatio = new Map<number, number>();
for (let i = 0; i < data.players.length; i++) {
  const prev = data.players[i].gamesPlayed;
  const next = calibrated[i].gamesPlayed;
  if (prev > 0 && next !== prev) sigmaRatio.set(data.players[i].id, next / prev);
}

const hydrated = filterActivePlayers(
  calibrated.map((p) => {
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
      reasoning: d?.reasoning,
      // generate publishes the profile's narrative: follow it when a profile
      // was re-read since (e.g. its injury profile, npm run collect:leagues).
      profileSummary: profilesById.get(p.id)?.contextNarrative ?? d?.profileSummary,
      ...detailCarryFields(d),
    };
  }),
);

// Same order as generate: GP calibration, then the rate calibration, which
// recomputes the totals of every skater carrying raw model rates at the new
// games (a board without them keeps the GP-scaled totals).
const rates = hydrated.some((p) => p.modelRates)
  ? applyRateCalibration(hydrated, { reference: loadRateReference().reference })
  : null;
const raw = rates ? rates.players : hydrated;
if (rates) {
  console.log(`Rate calibration re-applied to ${rates.calibrated} skaters`);
}

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

const playerDetails: Record<
  string,
  ReturnType<typeof splitPublishedPlayer>["detail"]
> = {};
const slimPlayers = ranked.map((p) => {
  const prev = details[String(p.id)];
  const { board, detail } = splitPublishedPlayer(p);
  if (prev?.perStatSigma && !detail.perStatSigma) {
    const ratio = sigmaRatio.get(p.id) ?? 1;
    const scaled: Partial<Record<Category, number>> = {};
    for (const [cat, sigma] of Object.entries(prev.perStatSigma)) {
      if (typeof sigma === "number") {
        scaled[cat as Category] = Math.round(sigma * ratio * 1000) / 1000;
      }
    }
    detail.perStatSigma = scaled;
  }
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
  gpCalibration: {
    version: 1,
    appliedAt: new Date().toISOString(),
    skaterCurve: curve.map((c) => ({
      x: Math.round(c.x * 100) / 100,
      y: Math.round(c.y * 100) / 100,
    })),
    pairCount,
  },
  ...(rates
    ? {
        rateCalibration: rateCalibrationMeta(
          rates.params,
          rates.calibrated,
          undefined,
          data.rateCalibration?.bootstrap,
        ),
      }
    : {}),
  categoryWeights,
  replacementLevels,
  players: slimPlayers,
};

writeFileAtomic(
  PLAYERS,
  JSON.stringify(out, (_k, v) =>
    typeof v === "number" && !Number.isFinite(v) ? 0 : v,
  ),
);
writeFileAtomic(DETAILS, JSON.stringify(playerDetails));

console.log("Top 10 after gp recalibration + vor:");
for (const p of ranked.slice(0, 10)) {
  console.log(
    `  ${p.rank}. ${p.name} (${p.position}) GP ${p.gamesPlayed} VOR ${p.vor.toFixed(2)}`,
  );
}
const goalieRows = ranked.filter((p) => p.isGoalie).slice(0, 5);
console.log("Top 5 goalies:");
for (const g of goalieRows) {
  console.log(
    `  ${g.rank}. ${g.name} GP ${g.gamesPlayed} W ${(g.projection as GoalieProjection).wins}`,
  );
}
