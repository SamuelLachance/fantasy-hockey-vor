import { readFileSync } from "fs";
import { join } from "path";

export interface InactivePlayersFile {
  reason: string;
  ids: number[];
  names?: string[];
}

const PATH = join(process.cwd(), "src", "data", "inactive-player-ids.json");

let cached: Set<number> | null = null;

export function loadInactivePlayerIds(): Set<number> {
  if (cached) return cached;
  try {
    const raw = JSON.parse(readFileSync(PATH, "utf8")) as InactivePlayersFile;
    cached = new Set(raw.ids.filter((id) => Number.isFinite(id)));
  } catch {
    cached = new Set();
  }
  return cached;
}

export function filterActivePlayers<T extends { id: number }>(
  players: T[],
): T[] {
  const inactive = loadInactivePlayerIds();
  if (inactive.size === 0) return players;
  return players.filter((p) => !inactive.has(p.id));
}
