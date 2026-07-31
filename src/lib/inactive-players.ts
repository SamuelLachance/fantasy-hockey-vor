import { readFileSync } from "fs";
import { join } from "path";

export interface InactivePlayersFile {
  reason: string;
  ids: number[];
  names?: string[];
}

const PATH = join(process.cwd(), "src", "data", "inactive-player-ids.json");

let cached: Set<number> | null = null;
let cachedFile: InactivePlayersFile | null = null;

export function loadInactivePlayersFile(): InactivePlayersFile {
  if (cachedFile) return cachedFile;
  try {
    cachedFile = JSON.parse(readFileSync(PATH, "utf8")) as InactivePlayersFile;
  } catch {
    cachedFile = { reason: "", ids: [] };
  }
  return cachedFile;
}

/** Structural checks for the curated inactive denylist. */
export function inactiveFileIssues(
  file: InactivePlayersFile = loadInactivePlayersFile(),
): string[] {
  const issues: string[] = [];
  if (!Array.isArray(file.ids)) {
    issues.push("ids must be an array");
    return issues;
  }
  const bad = file.ids.filter((id) => !Number.isFinite(id));
  if (bad.length > 0) issues.push(`${bad.length} non-finite id(s)`);
  if (new Set(file.ids).size !== file.ids.length) {
    issues.push("duplicate ids in inactive denylist");
  }
  if (file.names != null) {
    if (!Array.isArray(file.names)) {
      issues.push("names must be an array when present");
    } else if (file.names.length !== file.ids.length) {
      issues.push(
        `names length ${file.names.length} != ids length ${file.ids.length}`,
      );
    } else if (new Set(file.names.map((n) => n.trim().toLowerCase())).size !== file.names.length) {
      issues.push("duplicate names in inactive denylist");
    }
  }
  return issues;
}

export function loadInactivePlayerIds(): Set<number> {
  if (cached) return cached;
  try {
    const raw = loadInactivePlayersFile();
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
