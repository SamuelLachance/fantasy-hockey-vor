/**
 * Post-hoc GP recalibration on committed players.json (no ML regenerate),
 * then full VOR + Edge republish. Idempotent: raw model GP is preserved in
 * modelGamesPlayed and every run recalibrates from it.
 * Run: npx tsx scripts/recalibrate-gp.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { attachDraftEdge } from "../src/lib/draft-edge";
import {
  calibratedGoalieGp,
  calibratedSkaterGp,
  fitSkaterGpCurve,
  modelGp,
} from "../src/lib/gp-calibration";
import { filterActivePlayers } from "../src/lib/inactive-players";
import { DEFAULT_LEAGUE } from "../src/lib/league";
import type { PlayerProfile } from "../src/lib/profile-types";
import { splitPublishedPlayer } from "../src/lib/publish-players";
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
  {
    reasoning?: string;
    profileSummary?: string;
    perStatSigma?: Partial<Record<Category, number>>;
    marketEdge?: Partial<Record<Category, number>>;
  }
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

const calibrated = data.players.map((p) => {
  const rawModelGp = modelGp(p);
  // Board `position` is the VOR slot; the projection was built and clamped at
  // the profile's position. Recover it so Edge reconstruction re-clamps with
  // the same rate limits generate used.
  const primaryPosition =
    p.primaryPosition ?? profilesById.get(p.id)?.position ?? p.position;
  const newGp = p.isGoalie
    ? (goalieGp.get(p.id) ?? p.gamesPlayed)
    : calibratedSkaterGp(p, profilesById.get(p.id), curve);
  const prevGp = p.gamesPlayed;
  if (prevGp <= 0 || newGp === prevGp) {
    return { ...p, primaryPosition, modelGamesPlayed: rawModelGp };
  }
  const ratio = newGp / prevGp;
  const projection = p.isGoalie
    ? scaleGoalieProjection(p.projection as GoalieProjection, ratio)
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
    ...p,
    primaryPosition,
    modelGamesPlayed: rawModelGp,
    gamesPlayed: newGp,
    projection,
    ...(uncertainty ? { uncertainty } : {}),
  };
});

// σ per-stat des détails suit le même ratio que les totaux.
const sigmaRatio = new Map<number, number>();
for (let i = 0; i < data.players.length; i++) {
  const prev = data.players[i].gamesPlayed;
  const next = calibrated[i].gamesPlayed;
  if (prev > 0 && next !== prev) sigmaRatio.set(data.players[i].id, next / prev);
}

const raw = filterActivePlayers(
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
      profileSummary: d?.profileSummary,
      ...(d?.marketEdge ? { marketEdge: d.marketEdge } : {}),
    };
  }),
);

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
