/**
 * Re-rank committed players.json after VOR scoring changes (no ML regenerate).
 * Run: npx tsx scripts/reapply-vor.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { DEFAULT_LEAGUE } from "../src/lib/league";
import { splitPublishedPlayer } from "../src/lib/publish-players";
import { clampSkaterProjection } from "../src/lib/projection-sanity";
import { applyVor } from "../src/lib/vor";
import type {
  Category,
  PlayerProjection,
  ProjectionsDataset,
} from "../src/lib/types";

const PLAYERS = join(process.cwd(), "src", "data", "players.json");
const DETAILS = join(process.cwd(), "public", "player-details.json");

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

const raw = data.players.map((p) => {
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
});

const league = data.league ?? DEFAULT_LEAGUE;
const {
  players: ranked,
  categoryWeights,
  replacementLevels,
  draftableIds,
} = applyVor(raw, league);

const draftableIdSet = new Set(draftableIds);
const modelDraftable = raw.filter((p) => draftableIdSet.has(p.id));
const marketRaw = raw.map((p) => {
  if (p.isGoalie || !p.marketEdge) return p;
  const edge = p.marketEdge;
  const gp = Math.max(1, p.gamesPlayed);
  const proj = p.projection as unknown as Record<string, number>;
  const uncapped = {
    goals: Math.max(0, (proj.goals / gp - (edge.goals ?? 0)) * gp),
    assists: Math.max(0, (proj.assists / gp - (edge.assists ?? 0)) * gp),
    shots: Math.max(0, (proj.shots / gp - (edge.shots ?? 0)) * gp),
    blocks: Math.max(0, (proj.blocks / gp - (edge.blocks ?? 0)) * gp),
    hits: Math.max(0, (proj.hits / gp - (edge.hits ?? 0)) * gp),
    powerplayPoints: Math.max(
      0,
      (proj.powerplayPoints / gp - (edge.powerplayPoints ?? 0)) * gp,
    ),
    penaltyMinutes: Math.max(
      0,
      (proj.penaltyMinutes / gp - (edge.penaltyMinutes ?? 0)) * gp,
    ),
    faceoffWins: Math.max(
      0,
      (proj.faceoffWins / gp - (edge.faceoffWins ?? 0)) * gp,
    ),
  };
  return {
    ...p,
    projection: clampSkaterProjection(uncapped as never, gp, p.position),
  };
});
const { players: marketRanked } = applyVor(marketRaw, league, {
  categoryWeights,
  replacementLevels,
  zReference: modelDraftable,
});
const marketRankById = new Map<number, number>();
for (const p of marketRanked) marketRankById.set(p.id, p.rank);
for (const p of ranked) {
  if (p.isGoalie || !p.marketEdge) {
    p.syntheticMarketRank = p.rank;
    p.draftValue = 0;
  } else {
    p.syntheticMarketRank = marketRankById.get(p.id) ?? p.rank;
    p.draftValue = p.syntheticMarketRank - p.rank;
  }
}

const playerDetails: Record<
  string,
  ReturnType<typeof splitPublishedPlayer>["detail"]
> = {};
const slimPlayers = ranked.map((p) => {
  const prev = details[String(p.id)];
  const { board, detail } = splitPublishedPlayer(p);
  if (prev?.perStatSigma && !detail.perStatSigma) {
    detail.perStatSigma = prev.perStatSigma;
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
  generatedAt: new Date().toISOString(),
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

console.log("Top 8 after peripheral soft-cap:");
for (const p of ranked.slice(0, 8)) {
  console.log(`  ${p.rank}. ${p.name} (${p.position}) VOR ${p.vor.toFixed(2)}`);
}
