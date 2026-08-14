/** Fold accents/diacritics for ASCII-friendly board search. */
export function foldSearchText(text: string): string {
  return foldSearchTextWithMap(text).folded;
}

const FOLD_MAP_CACHE_MAX = 4096;
const foldMapCache = new Map<
  string,
  { folded: string; map: number[] }
>();

/**
 * Fold `text` while recording, for each folded character, the start index in
 * the original string (for highlight spans when needle is ASCII-only).
 * Cached: board search + highlight reuse the same player/team/query strings.
 */
export function foldSearchTextWithMap(text: string): {
  folded: string;
  /** foldedIndex → original string index */
  map: number[];
} {
  const hit = foldMapCache.get(text);
  if (hit) return hit;
  let folded = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const step = ch.length;
    const part = ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (let j = 0; j < part.length; j++) {
      map.push(i);
      folded += part[j]!;
    }
    i += step;
  }
  const next = { folded, map };
  if (foldMapCache.size >= FOLD_MAP_CACHE_MAX) {
    const oldest = foldMapCache.keys().next().value;
    if (oldest !== undefined) foldMapCache.delete(oldest);
  }
  foldMapCache.set(text, next);
  return next;
}
