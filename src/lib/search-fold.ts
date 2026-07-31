/** Fold accents/diacritics for ASCII-friendly board search. */
export function foldSearchText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Fold `text` while recording, for each folded character, the start index in
 * the original string (for highlight spans when needle is ASCII-only).
 */
export function foldSearchTextWithMap(text: string): {
  folded: string;
  /** foldedIndex → original string index */
  map: number[];
} {
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
  return { folded, map };
}
