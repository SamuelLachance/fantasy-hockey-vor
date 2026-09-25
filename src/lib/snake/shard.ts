/**
 * Opinion shards: `public/snake/o/<nn>.json`, one per bucket of player keys,
 * so a player's timeline loads without the whole database.
 */

export const SNAKE_SHARD_COUNT = 64;

/** 32-bit FNV-1a over the UTF-16 code units of `s` (stable across runtimes). */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Shard number for a player key. */
export function snakeShardOf(key: string, count = SNAKE_SHARD_COUNT): number {
  return fnv1a32(key) % count;
}

/** Shard file name relative to `public/snake/`, e.g. `o/07.json`. */
export function snakeShardFile(shard: number): string {
  return `o/${String(shard).padStart(2, "0")}.json`;
}

export function snakeShardFileForKey(key: string, count = SNAKE_SHARD_COUNT): string {
  return snakeShardFile(snakeShardOf(key, count));
}
