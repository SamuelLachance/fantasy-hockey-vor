/**
 * Re-apply team tandem GP renormalization on committed players.json.
 * Scales volume stats with GP. Run: npx tsx scripts/renorm-goalie-gp.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { renormalizeGoalieGamesByTeam } from "../src/lib/ml/goalie-v2";
import { splitPublishedPlayer } from "../src/lib/publish-players";
import type { GoalieProjection, ProjectionsDataset } from "../src/lib/types";
import { attachDraftEdge } from "../src/lib/draft-edge";
import { DEFAULT_LEAGUE } from "../src/lib/league";
import { applyVor } from "../src/lib/vor";
import type { Category } from "../src/lib/types";

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

const prevGp = new Map(data.players.map((p) => [p.id, p.gamesPlayed]));
const adjusted = renormalizeGoalieGamesByTeam(
  data.players.map((p) => {
    const d = details[String(p.id)];
    return {
      ...p,
      reasoning: d?.reasoning,
      profileSummary: d?.profileSummary,
      ...(d?.marketEdge ? { marketEdge: d.marketEdge } : {}),
    };
  }),
).map((p) => {
  if (!p.isGoalie) return p;
  const gp = p.gamesPlayed;
  const prev = prevGp.get(p.id) ?? gp;
  if (prev <= 0 || gp === prev) return p;
  const scale = gp / prev;
  const proj = p.projection as GoalieProjection;
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

const raw = adjusted.map((p) => {
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
  return rest;
});

const league = data.league ?? DEFAULT_LEAGUE;
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
    detail.perStatSigma = prev.perStatSigma;
  }
  if (prev?.reasoning && !detail.reasoning) detail.reasoning = prev.reasoning;
  if (prev?.profileSummary && !detail.profileSummary) {
    detail.profileSummary = prev.profileSummary;
  }
  playerDetails[String(p.id)] = detail;
  return board;
});

writeFileAtomic(
  PLAYERS,
  JSON.stringify(
    {
      ...data,
      generatedAt: new Date().toISOString(),
      categoryWeights,
      replacementLevels,
      players: slimPlayers,
    },
    (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? 0 : v),
  ),
);
writeFileAtomic(DETAILS, JSON.stringify(playerDetails));

const by: Record<string, number> = {};
for (const g of slimPlayers.filter((p) => p.isGoalie)) {
  by[g.team] = (by[g.team] ?? 0) + g.gamesPlayed;
}
const worst = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
console.log(
  `Goalie team GP max after renorm: ${worst?.[0]} ${worst?.[1]} (target ~80)`,
);
