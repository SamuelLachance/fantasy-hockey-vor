/**
 * Synthesis traceability (pure). A source synthesis was written from every
 * source opinion of a player, including the ones that are not published
 * (uncertain attribution, doubtful player, hand-dropped). When only a few
 * of them were dropped, the synthesis is kept but trimmed to what the
 * published opinions support: a sentence or list item is kept only when
 *
 * 1. none of its content words comes only from unpublished opinions (a word
 *    they use that no published opinion of the player uses: "mégastar",
 *    a comparable's name, a scouting trip…), and
 * 2. most of its content words appear in the published opinions.
 *
 * Otherwise it goes. Too little left, or too large a share of dropped
 * inputs, and the whole synthesis is withheld instead.
 */
import { splitSentences } from "./sanitize";

/** Share of dropped source opinions at or above which nothing is kept. */
export const TRIM_MAX_DROPPED_SHARE = 1 / 3;
/** Share of a unit's content words the published opinions must contain. */
export const TRACE_MIN_COVERAGE = 0.6;

const STOP = new Set(
  (
    "alors aussi autre autres avant avec avoir beaucoup bien cela celle celui cette ceux chez comme dans depuis deux " +
    "donc dont elle elles encore entre etre fait faire faut fois guere ici jamais leur leurs lors lorsque mais meme " +
    "moins nous notre peut peu plus pour pourrait pourtant quand quelque quelques sans selon seul seule seulement " +
    "sera serait sont sous surtout tant tout toute toutes tous tres trop une vers voit voir vous snake juge estime " +
    "pense croit trouve reste etait avait aurait semble dire selon lors joueur joueurs"
  ).split(" "),
);

/** Content-word stems: accents folded, short / function words dropped, crude stemming. */
export function contentStems(text: string, ignore: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>();
  const words = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, " ")
    .split(/[^a-z0-9]+/);
  for (const w of words) {
    if (!w) continue;
    const digits = /^\d+$/.test(w);
    if (!digits && (w.length < 4 || STOP.has(w))) continue;
    const s = digits ? w : w.replace(/(?:s|x)$/, "").slice(0, 6);
    if (ignore.has(s)) continue;
    out.add(s);
  }
  return out;
}

export interface TraceSets {
  /** Stems of the published opinions. */
  published: ReadonlySet<string>;
  /** Stems found only in unpublished opinions. */
  droppedOnly: ReadonlySet<string>;
}

export function traceSets(publishedTexts: readonly string[], droppedTexts: readonly string[], ignore: ReadonlySet<string>): TraceSets {
  const published = new Set<string>();
  for (const t of publishedTexts) for (const s of contentStems(t, ignore)) published.add(s);
  const droppedOnly = new Set<string>();
  for (const t of droppedTexts) for (const s of contentStems(t, ignore)) if (!published.has(s)) droppedOnly.add(s);
  return { published, droppedOnly };
}

/** Whether a synthesis unit is supported by the published opinions alone. */
export function traceable(unit: string, sets: TraceSets, ignore: ReadonlySet<string>): boolean {
  const stems = contentStems(unit, ignore);
  if (stems.size === 0) return true;
  let covered = 0;
  for (const s of stems) {
    if (sets.droppedOnly.has(s)) return false;
    if (sets.published.has(s)) covered++;
  }
  return covered / stems.size >= TRACE_MIN_COVERAGE;
}

/** Keep the traceable sentences of a paragraph (null when none). */
export function traceText(text: string | null, sets: TraceSets, ignore: ReadonlySet<string>): { text: string | null; kept: number; total: number } {
  if (!text) return { text: null, kept: 0, total: 0 };
  const sentences = splitSentences(text);
  const kept = sentences.filter((s) => traceable(s, sets, ignore));
  return { text: kept.length ? kept.join(" ") : null, kept: kept.length, total: sentences.length };
}

/** Keep the traceable items of a list. */
export function traceList(items: readonly string[], sets: TraceSets, ignore: ReadonlySet<string>): string[] {
  return items.filter((it) => traceable(it, sets, ignore));
}
