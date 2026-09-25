/**
 * One search rule for every player table: accents, case and the
 * punctuation inside names are folded on both sides, and every word must
 * hit the name or the team. « jt miller » finds J.T. Miller, « oreilly »
 * or « o’reilly » (iOS smart quote) find Ryan O'Reilly. Same results as
 * the Yahoo draft board's `matchesDraftQuery` (tested on its players).
 */
import { foldSearchText } from "@/lib/search-fold";

const NAME_PUNCTUATION = /[.'’‘`´ʼ\-‐‑–—]/g;

/** Accent-, case- and punctuation-folded text (a row's haystack, a query). */
export function foldForSearch(text: string): string {
  return foldSearchText(text).replace(NAME_PUNCTUATION, "");
}

/** Haystack of a row: its name and team, folded once when the row is built. */
export function searchHaystack(name: string, team: string): string {
  return `${foldForSearch(name)} ${foldForSearch(team)}`;
}

let lastQuery = "";
let lastWords: readonly string[] = [];

/** The folded words of a query (the last one is cached: every row asks for it). */
export function queryWords(query: string): readonly string[] {
  if (query !== lastQuery) {
    lastQuery = query;
    lastWords = foldForSearch(query).split(/\s+/).filter(Boolean);
  }
  return lastWords;
}

/** Every word of the query is in the haystack (an empty query matches). */
export function matchesQuery(haystack: string, query: string): boolean {
  const words = queryWords(query);
  return words.every((w) => haystack.includes(w));
}
