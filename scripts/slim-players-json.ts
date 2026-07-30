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

const existingDetails: Record<string, { reasoning?: string; profileSummary?: string }> =
  existsSync(DETAILS)
    ? (JSON.parse(readFileSync(DETAILS, "utf8")) as Record<
        string,
        { reasoning?: string; profileSummary?: string }
      >)
    : {};

const boardPlayers: PlayerProjection[] = [];
const details: Record<string, ReturnType<typeof splitPublishedPlayer>["detail"]> =
  {};

for (const p of data.players) {
  const merged: PlayerProjection = {
    ...p,
    reasoning: p.reasoning ?? existingDetails[String(p.id)]?.reasoning,
    profileSummary:
      p.profileSummary ?? existingDetails[String(p.id)]?.profileSummary,
  };
  const { board, detail } = splitPublishedPlayer(merged);
  // Preserve existing notes if slim player had none.
  if (!detail.reasoning && existingDetails[String(p.id)]?.reasoning) {
    detail.reasoning = existingDetails[String(p.id)]!.reasoning!;
  }
  if (!detail.profileSummary && existingDetails[String(p.id)]?.profileSummary) {
    detail.profileSummary = existingDetails[String(p.id)]!.profileSummary!;
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
