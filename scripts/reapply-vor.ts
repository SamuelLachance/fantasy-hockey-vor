/**
 * Re-rank committed players.json after VOR scoring changes (no ML regenerate).
 * Run: npx tsx scripts/reapply-vor.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { attachDraftEdge } from "../src/lib/draft-edge";
import { filterActivePlayers } from "../src/lib/inactive-players";
import { DEFAULT_LEAGUE } from "../src/lib/league";
import { splitPublishedPlayer } from "../src/lib/publish-players";
import { applyVor } from "../src/lib/vor";
import type { Category, ProjectionsDataset } from "../src/lib/types";

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

const raw = filterActivePlayers(
  data.players.map((p) => {
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

console.log("Top 8 after vor:reapply:");
for (const p of ranked.slice(0, 8)) {
  console.log(`  ${p.rank}. ${p.name} (${p.position}) VOR ${p.vor.toFixed(2)}`);
}
