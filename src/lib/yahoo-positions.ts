import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { Position } from "./types";
import type { YahooPlayerRecord, YahooPositionsDataset } from "./yahoo-fantasy";

const DATA_PATH = join(process.cwd(), "src", "data", "yahoo-positions.json");
const STALE_WARN_MS = 30 * 24 * 60 * 60 * 1000;

export function loadYahooPositions(): YahooPositionsDataset | null {
  if (!existsSync(DATA_PATH)) return null;
  try {
    const dataset = JSON.parse(
      readFileSync(DATA_PATH, "utf8"),
    ) as YahooPositionsDataset;
    const age = Date.now() - new Date(dataset.fetchedAt).getTime();
    if (Number.isFinite(age) && age > STALE_WARN_MS) {
      console.warn(
        `WARN: yahoo-positions.json is ${(age / (24 * 60 * 60 * 1000)).toFixed(0)} days old — run npm run yahoo:fetch to refresh position eligibility.`,
      );
    }
    return dataset;
  } catch {
    return null;
  }
}

export function getYahooPositionsForPlayer(
  nhlId: number,
  dataset: YahooPositionsDataset | null,
  fallback: { position: Position; positions: Position[] },
): { position: Position; positions: Position[]; source: "yahoo" | "nhl" } {
  const yahoo = dataset?.byNhlId[nhlId];
  if (!yahoo || yahoo.positions.length === 0) {
    return { ...fallback, source: "nhl" };
  }

  const positions = yahoo.positions;
  const position =
    yahoo.primaryPosition && positions.includes(yahoo.primaryPosition)
      ? yahoo.primaryPosition
      : positions[0];

  return { position, positions, source: "yahoo" };
}

/** Fantasy faceoff eligibility: any C slot on the roster card, not just listed primary. */
export function isCenterEligible(player: {
  position: Position;
  positions: Position[];
}): boolean {
  return player.positions.includes("C") || player.position === "C";
}

export function applyYahooPositionsToPlayer<
  T extends { id: number; position: Position; positions: Position[] },
>(player: T, dataset: YahooPositionsDataset | null): T & { positionSource: "yahoo" | "nhl" } {
  const mapped = getYahooPositionsForPlayer(player.id, dataset, {
    position: player.position,
    positions: player.positions,
  });
  return {
    ...player,
    position: mapped.position,
    positions: mapped.positions,
    positionSource: mapped.source,
  };
}

export function yahooPositionsSummary(dataset: YahooPositionsDataset | null): string {
  if (!dataset) return "No Yahoo positions file — using NHL positions";
  return `Yahoo positions: ${dataset.matched} matched, ${dataset.unmatched} unmatched (fetched ${dataset.fetchedAt})`;
}

export type { YahooPlayerRecord, YahooPositionsDataset };
