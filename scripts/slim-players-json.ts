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
  perStatSigma?: Partial<Record<string, number>>;
  perStatUncertainty?: Partial<
    Record<string, { sigma?: number; modelSpread?: number; aleatoric?: number }>
  >;
  marketEdge?: PlayerProjection["marketEdge"];
};

function existingPerStat(
  prev: ExistingDetail | undefined,
): PlayerProjection["uncertainty"] extends infer U
  ? U extends { perStat?: infer P }
    ? P
    : never
  : never {
  if (!prev) return undefined;
  if (prev.perStatSigma && Object.keys(prev.perStatSigma).length > 0) {
    const out: Record<string, { sigma: number; modelSpread: number; aleatoric: number }> =
      {};
    for (const [cat, sigma] of Object.entries(prev.perStatSigma)) {
      if (sigma != null) out[cat] = { sigma, modelSpread: 0, aleatoric: sigma };
    }
    return out as never;
  }
  return prev.perStatUncertainty as never;
}

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
              : existingPerStat(prev)) ?? p.uncertainty.perStat,
        }
      : p.uncertainty,
  };
  const { board, detail } = splitPublishedPlayer(merged);
  if (!detail.reasoning && prev?.reasoning) detail.reasoning = prev.reasoning;
  if (!detail.profileSummary && prev?.profileSummary) {
    detail.profileSummary = prev.profileSummary;
  }
  if (!detail.perStatSigma) {
    if (prev?.perStatSigma) detail.perStatSigma = prev.perStatSigma;
    else if (prev?.perStatUncertainty) {
      const sigma: Partial<Record<string, number>> = {};
      for (const [cat, u] of Object.entries(prev.perStatUncertainty)) {
        if (u?.sigma != null) sigma[cat] = u.sigma;
      }
      if (Object.keys(sigma).length) detail.perStatSigma = sigma;
    }
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
