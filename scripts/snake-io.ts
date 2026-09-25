/**
 * Shared I/O for the Snake scripts (build + check): build context from the
 * committed data, the exact bytes of every public file, their content hash
 * (cache buster) and the local transcripts for the verbatim guard.
 */
import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { BuildContext, SnakeBuildOutput } from "../src/lib/snake/build";
import { buildBoardNameIndex, normalizePosition, normalizeTeam, type BoardPlayerRef } from "../src/lib/snake/resolve";
import { snakeShardFile } from "../src/lib/snake/shard";
import { ngramSet, transcriptWords, VERBATIM_MAX_RUN } from "../src/lib/snake/verbatim";

export const SNAKE_SOURCE_REL = join("src", "data", "scouting", "snake-boisvert.json");

/** Build context from players.json and the Fantrax → NHL id map. */
export function loadSnakeContext(root: string): BuildContext {
  const nhlIds = JSON.parse(readFileSync(join(root, "src", "data", "fantrax", "nhl-ids.json"), "utf8")) as {
    ids: Record<string, number>;
  };
  const board = JSON.parse(readFileSync(join(root, "src", "data", "players.json"), "utf8")) as {
    players: Array<BoardPlayerRef & { position?: string | null; team?: string | null }>;
  };
  return {
    fantraxToNhl: nhlIds.ids ?? {},
    boardByName: buildBoardNameIndex(board.players),
    boardIds: new Set(board.players.map((p) => p.id)),
    boardPlayers: new Map(
      board.players.map((p) => [p.id, { pos: p.isGoalie ? "G" : normalizePosition(p.position), team: normalizeTeam(p.team) }]),
    ),
  };
}

/** Exact bytes of every file under `public/snake/`, by path relative to it. */
export function publicSnakeBodies(out: SnakeBuildOutput): Map<string, string> {
  const body = (d: unknown) => `${JSON.stringify(d)}\n`;
  const m = new Map<string, string>();
  m.set("index.json", body(out.index));
  out.shards.forEach((s, i) => m.set(snakeShardFile(i), body(s)));
  m.set("rankings.json", body(out.rankings));
  m.set("nhl.json", body(out.nhl));
  m.set("fantrax.json", body(out.fantrax));
  return m;
}

/** The same map read back from disk (missing files are simply absent). */
export function readPublicSnakeBodies(root: string): Map<string, string> {
  const dir = join(root, "public", "snake");
  const m = new Map<string, string>();
  for (const rel of ["index.json", "rankings.json", "nhl.json", "fantrax.json"]) {
    if (existsSync(join(dir, rel))) m.set(rel, readFileSync(join(dir, rel), "utf8"));
  }
  if (existsSync(join(dir, "o"))) {
    for (const f of readdirSync(join(dir, "o"))) m.set(`o/${f}`, readFileSync(join(dir, "o", f), "utf8"));
  }
  return m;
}

/** Content hash of the public files (12 hex chars), for `?v=`. */
export function snakeContentVersion(bodies: ReadonlyMap<string, string>): string {
  const h = createHash("sha256");
  for (const rel of [...bodies.keys()].sort()) {
    h.update(rel);
    h.update("\0");
    h.update(bodies.get(rel)!);
    h.update("\0");
  }
  return h.digest("hex").slice(0, 12);
}

/**
 * n-gram sets of the local transcripts (`<dir>/<videoId>.txt`), cached;
 * null for a video without one. Null overall when `dir` is not usable.
 */
export function transcriptGrams(dir: string | undefined, n = VERBATIM_MAX_RUN): ((vid: string) => Set<string> | null) | null {
  if (!dir || !existsSync(dir)) return null;
  const cache = new Map<string, Set<string> | null>();
  return (vid: string) => {
    if (cache.has(vid)) return cache.get(vid)!;
    const f = join(dir, `${vid}.txt`);
    const set = existsSync(f) ? ngramSet(transcriptWords(readFileSync(f, "utf8")), n) : null;
    cache.set(vid, set);
    return set;
  };
}
