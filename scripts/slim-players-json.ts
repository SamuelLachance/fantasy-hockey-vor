/**
 * One-shot: rewrite committed players.json + public/player-details.json
 * without a full regenerate. Moves perStat uncertainty + marketEdge to details.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { splitPublishedPlayer } from "../src/lib/publish-players";
import type { PlayerProjection, ProjectionsDataset } from "../src/lib/types";

const PLAYERS = join(process.cwd(), "src", "data", "players.json");
const DETAILS = join(process.cwd(), "public", "player-details.json");

const before = readFileSync(PLAYERS).length;
const data = JSON.parse(readFileSync(PLAYERS, "utf8")) as ProjectionsDataset;

type ExistingDetail = {
  reasoning?: string;
  profileSummary?: string;
  perStatUncertainty?: PlayerProjection["uncertainty"] extends infer U
    ? U extends { perStat?: infer P }
      ? P
      : never
    : never;
  marketEdge?: PlayerProjection["marketEdge"];
};

const existingDetails: Record<string, ExistingDetail> = existsSync(DETAILS)
  ? (JSON.parse(readFileSync(DETAILS, "utf8")) as Record<string, ExistingDetail>)
  : {};

const boardPlayers: PlayerProjection[] = [];
const details: Record<string, ReturnType<typeof splitPublishedPlayer>["detail"]> =
  {};

for (const p of data.players) {
  const prev = existingDetails[String(p.id)];
  // Rehydrate heavy fields from details so re-slim is idempotent.
  const merged: PlayerProjection = {
    ...p,
    reasoning: p.reasoning ?? prev?.reasoning,
    profileSummary: p.profileSummary ?? prev?.profileSummary,
    marketEdge: p.marketEdge ?? prev?.marketEdge,
    uncertainty: p.uncertainty
      ? {
          ...p.uncertainty,
          perStat:
            (p.uncertainty.perStat &&
            Object.keys(p.uncertainty.perStat).length > 0
              ? p.uncertainty.perStat
              : prev?.perStatUncertainty) ?? p.uncertainty.perStat,
        }
      : p.uncertainty,
  };
  const { board, detail } = splitPublishedPlayer(merged);
  if (!detail.reasoning && prev?.reasoning) detail.reasoning = prev.reasoning;
  if (!detail.profileSummary && prev?.profileSummary) {
    detail.profileSummary = prev.profileSummary;
  }
  if (!detail.perStatUncertainty && prev?.perStatUncertainty) {
    detail.perStatUncertainty = prev.perStatUncertainty;
  }
  if (!detail.marketEdge && prev?.marketEdge) {
    detail.marketEdge = prev.marketEdge;
  }
  boardPlayers.push(board);
  details[String(p.id)] = detail;
}

const out: ProjectionsDataset = { ...data, players: boardPlayers };
writeFileAtomic(
  PLAYERS,
  JSON.stringify(out, (_k, v) =>
    typeof v === "number" && !Number.isFinite(v) ? 0 : v,
  ),
);
writeFileAtomic(DETAILS, JSON.stringify(details));

const after = readFileSync(PLAYERS).length;
console.log(
  `Slimmed players.json ${(before / 1e6).toFixed(2)}MB → ${(after / 1e6).toFixed(2)}MB (${boardPlayers.length} players)`,
);
