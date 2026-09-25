/**
 * Browser loaders for `public/snake/*` (same pattern as the other lazy
 * payloads: build-time cache buster, 8 s timeout, one retry, cached per page
 * view, a failure can be retried).
 */
import { snakeShardFileForKey } from "./shard";
import type {
  SnakeFantraxFile,
  SnakeIndexFile,
  SnakeNhlFile,
  SnakeOpinion,
  SnakeRankingsFile,
  SnakeRow,
  SnakeShardFile,
  SnakeVideoRef,
} from "./types";
import { snakeDataHref } from "./url";

const cache = new Map<string, Promise<unknown>>();

async function fetchJson<T>(file: string): Promise<T> {
  const url = snakeDataHref(file);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(url, { signal: controller.signal, credentials: "omit" });
      if (!res.ok) throw new Error(`snake/${file} HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 150));
    } finally {
      globalThis.clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to load snake/${file}`);
}

function once<T>(file: string, check: (v: T) => boolean): Promise<T> {
  let p = cache.get(file) as Promise<T> | undefined;
  if (!p) {
    const next = fetchJson<T>(file).then((v) => {
      if (!v || !check(v)) throw new Error(`snake/${file} is malformed`);
      return v;
    });
    p = next.catch((err) => {
      if (cache.get(file) === p) cache.delete(file);
      throw err;
    });
    cache.set(file, p);
  }
  return p;
}

export function loadSnakeIndex(): Promise<SnakeIndexFile> {
  return once<SnakeIndexFile>("index.json", (v) => v.v === 1 && Array.isArray(v.rows));
}

export function loadSnakeRankings(): Promise<SnakeRankingsFile> {
  return once<SnakeRankingsFile>("rankings.json", (v) => v.v === 1 && Array.isArray(v.rankings));
}

export function loadSnakeNhl(): Promise<SnakeNhlFile> {
  return once<SnakeNhlFile>("nhl.json", (v) => v.v === 1 && !!v.rows && typeof v.rows === "object");
}

export function loadSnakeFantrax(): Promise<SnakeFantraxFile> {
  return once<SnakeFantraxFile>("fantrax.json", (v) => v.v === 1 && !!v.rows && typeof v.rows === "object");
}

export interface SnakePlayerRecord {
  /** The player's current key (an old, merged key resolves to it). */
  key: string;
  row: SnakeRow;
  opinions: SnakeOpinion[];
  videos: Record<string, SnakeVideoRef>;
}

/**
 * A player's row and full timeline (null when the key is unknown). An old
 * key folded into another record resolves through its own shard's alias
 * list, so a deep link never waits for the index.
 */
export async function loadSnakePlayer(key: string): Promise<SnakePlayerRecord | null> {
  let k = key;
  for (let hop = 0; hop < 2; hop++) {
    const shard = await once<SnakeShardFile>(snakeShardFileForKey(k), (v) => v.v === 1 && !!v.players);
    const entry = shard.players[k];
    if (entry) return { key: k, row: entry.r, opinions: entry.o, videos: shard.videos };
    const next = shard.aliases?.[k];
    if (!next || next === k) return null;
    k = next;
  }
  return null;
}

/** Test helper: forget every cached payload. */
export function resetSnakeClientCache(): void {
  cache.clear();
}
