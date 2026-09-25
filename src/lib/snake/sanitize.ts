/**
 * Public-safety rules for the Snake data (pure; used by the build script and
 * the unit tests). The source DB is a set of automatic French paraphrases
 * attributed to a real person, so before anything is published:
 *
 * - opinions whose attribution to Snake is "incertain" are dropped, and so
 *   are opinions whose player identification is weak: a "basse" name match,
 *   a name the extractor says it inferred (inaudible, deduced from context)
 *   or a context note saying the passage is about a namesake;
 * - an opinion whose own text flags part of it as uncertain is dropped whole
 *   (its projection, strengths and stance come from that same passage);
 * - players left without a publishable opinion are dropped;
 * - a synthesis was written from all of the player's source opinions, so it
 *   may carry what we drop: it is published whole only when every source
 *   opinion is, trimmed to what the published ones support when a few are
 *   not (`./trace`), and otherwise withheld (one published opinion stands
 *   in);
 * - notes about the captions / transcription are removed from public text;
 * - quotation marks are removed from paraphrases so nothing reads as a
 *   verbatim quote (the captions are automatic and often wrong).
 */
import { SNAKE_STANCES, SNAKE_TRENDS, type SnakeStance, type SnakeTrend } from "./types";

/** Opinion as stored in the source DB (`src/data/scouting/snake-boisvert.json`). */
export interface SourceOpinion {
  videoId: string;
  date: string;
  show: string;
  title: string;
  url: string;
  timestamps: string[];
  contextAtTime: string | null;
  opinionFr: string;
  stance: string;
  projection: string | null;
  strengths: string[];
  weaknesses: string[];
  comparables: string[];
  rankMentions: Array<{ list: string; rank: number }>;
  attribution: string;
  nameConfidence: string;
}

export interface SourceSynthesis {
  syntheseFr: string;
  verdict: string;
  tendance: string;
  projection: string | null;
  forces: string[];
  faiblesses: string[];
  comparables: string[];
  contradictions: string | null;
  single?: boolean;
}

export interface SourcePlayer {
  key: string;
  name: string;
  fantraxId: string | null;
  nhlId: string | number | null;
  position: string | null;
  team: string | null;
  draft: string | null;
  opinions: SourceOpinion[];
  synthesis: SourceSynthesis;
}

export interface SourceVideo {
  title: string;
  show: string;
  /** YouTube channel (guest appearances: the host program's channel). */
  channel?: string | null;
  date: string;
  url: string;
  snakePresent: boolean;
}

/** Why an opinion is not published (null = publishable). */
export type OpinionRejection = "uncertain-attribution" | "low-name-confidence" | "invalid" | null;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VIDEO_ID_RE = /^[\w-]{11}$/;

/**
 * Mentions of material whose attribution (or player identification) is
 * uncertain, which is never published: "(attribution incertaine)", "une
 * opinion incertaine", "dont une incertaine", "(incertain, attribué à…)",
 * "l'identification est incertaine". Plain uses of the word about a
 * player's future ("avenir incertain", "top 6 incertain") are content and
 * stay.
 */
export const UNCERTAIN_ATTRIBUTION_RE =
  /attribution\s+(?:de\s+\S+\s+\S+\s+)?(?:jugée\s+|très\s+|est\s+|reste\s+)?incertaine?s?|incertaine?s?\s+quant\s+à\s+l.attribution|\b(?:opinions?|avis|passages?|phrases?|déclarations?|remarques?|extraits?|propos|mentions?|citations?|analyses?)\s+(?:[^\s.;:]+\s+){0,2}incertaine?s?\b|\bdont\s+une?\s+incertaine?s?\b|\(incertaine?s?[,)]|identification\s+(?:est\s+|reste\s+)?incertaine?/i;
const UNCERTAIN_RE = UNCERTAIN_ATTRIBUTION_RE;

/**
 * The extractor says it inferred the player's name (inaudible, missing from
 * the captions, deduced from context or by elimination): the opinion may be
 * about someone else, so it is treated like a weak name match.
 */
export const NAME_INFERRED_RE =
  /\bnom\s+(?:n'est\s+pas\s+prononcé|est\s+inaudible|manque|n'apparaît\s+pas|est\s+absent)|ne\s+donnent\s+pas\s+le\s+nom|déduit\s+(?:du\s+contexte|par\s+élimination)|semble\s+être\s+le\s+sien|le\s+contexte\s+désigne/i;

/**
 * A context note saying the passage is about a namesake ("Ce n'est pas le
 * Jack Hughes des Devils"): the opinion was filed under the wrong player.
 */
export const OTHER_PLAYER_RE =
  /\b(?:[Cc]e\s+n'est|[Ii]l\s+ne\s+s'agit)\s+pas\s+(?:du\s+|de\s+|le\s+|la\s+|l')?[A-ZÀ-Ý][\p{L}'-]+\s+[A-ZÀ-Ý][\p{L}'-]+/u;

export function opinionRejection(
  o: Pick<SourceOpinion, "attribution" | "nameConfidence" | "videoId" | "date" | "opinionFr" | "stance"> &
    Partial<Pick<SourceOpinion, "contextAtTime">>,
  video?: Pick<SourceVideo, "snakePresent"> | null,
): OpinionRejection {
  if (o.attribution !== "certain" && o.attribution !== "probable") return "uncertain-attribution";
  // The opinion flags part of itself as uncertain: its projection, strengths
  // and stance come from that same passage, so none of it is published.
  if (UNCERTAIN_RE.test(o.opinionFr ?? "")) return "uncertain-attribution";
  if (o.nameConfidence === "basse") return "low-name-confidence";
  if (NAME_INFERRED_RE.test(o.opinionFr ?? "") || NAME_INFERRED_RE.test(o.contextAtTime ?? "")) {
    return "low-name-confidence";
  }
  if (OTHER_PLAYER_RE.test(o.contextAtTime ?? "")) return "low-name-confidence";
  if (!VIDEO_ID_RE.test(o.videoId) || !DATE_RE.test(o.date)) return "invalid";
  if (!o.opinionFr || !o.opinionFr.trim()) return "invalid";
  if (!isStance(o.stance)) return "invalid";
  if (video !== undefined && (!video || video.snakePresent !== true)) return "invalid";
  return null;
}

export function isStance(s: unknown): s is SnakeStance {
  return typeof s === "string" && (SNAKE_STANCES as readonly string[]).includes(s);
}

export function isTrend(s: unknown): s is SnakeTrend {
  return typeof s === "string" && (SNAKE_TRENDS as readonly string[]).includes(s);
}

/** "00:15:09" / "15:09" → seconds (NaN when malformed). */
export function timestampSeconds(ts: string): number {
  const parts = ts.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d{1,2}$/.test(p))) return Number.NaN;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

/**
 * Start of the passage in seconds: the `&t=` of the source link when it is a
 * plain YouTube watch URL for this video, else the first timestamp. A 0:00
 * start (the episode's cold open / teaser) gives way to the first later
 * timestamp, which is where the passage actually is.
 */
export function opinionStartSeconds(o: Pick<SourceOpinion, "url" | "videoId" | "timestamps">): number {
  const candidates: number[] = [];
  const m = /^https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})&t=(\d+)s$/.exec(o.url);
  if (m && m[1] === o.videoId) candidates.push(Number(m[2]));
  for (const ts of o.timestamps) {
    const s = timestampSeconds(ts);
    if (Number.isFinite(s)) candidates.push(s);
  }
  return candidates.find((s) => s > 0) ?? 0;
}

/** Split French prose into sentences (keeps the terminal punctuation). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+(?=[A-ZÀ-ÖØ-Þ0-9«"(])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Drop the sentences that talk about uncertain-attribution material.
 * Returns the cleaned text (null when nothing is left) and how many
 * sentences went.
 */
export function scrubUncertain(text: string | null | undefined): { text: string | null; removed: number } {
  return scrubSentences(text, UNCERTAIN_RE);
}

/**
 * Extraction notes about the captions themselves ("passage mal transcrit",
 * "les sous-titres brouillent ce passage", "Il faut les ignorer"): internal
 * caveats, never published. The sentence carrying one goes (its content is
 * what the note doubts).
 */
export const EXTRACTION_NOTE_RE =
  /transcri(?:t|te|ts|tes|ption)\b|sous-titres?\b|inaudible|\bil\s+faut\s+les\s+ignorer\b|par\s+élimination/i;

/** Drop the sentences that carry an extraction note. */
export function scrubNotes(text: string | null | undefined): { text: string | null; removed: number } {
  return scrubSentences(text, EXTRACTION_NOTE_RE);
}

function scrubSentences(text: string | null | undefined, re: RegExp): { text: string | null; removed: number } {
  if (!text || !text.trim()) return { text: null, removed: 0 };
  if (!re.test(text)) return { text: text.trim(), removed: 0 };
  const sentences = splitSentences(text);
  const kept = sentences.filter((s) => !re.test(s));
  return { text: kept.length ? kept.join(" ") : null, removed: sentences.length - kept.length };
}

/**
 * Remove quotation marks around spans (« … », “ … ”, " … ") so a paraphrase
 * never reads as a verbatim quote. The words stay; apostrophes are untouched.
 * Heights (6'2") become primes first (6′2″) so their inch mark is not taken
 * for a quote.
 */
export function unquote(text: string): string {
  return text
    .replace(/(\d)\s?['’′]\s?(\d{1,2})\s?(?:"|”|″|'')/g, "$1′$2″")
    .replace(/«\s*([^»]*?)\s*»/g, "$1")
    .replace(/“\s*([^”]*?)\s*”/g, "$1")
    .replace(/"\s*([^"]*?)\s*"/g, "$1")
    .replace(/[«»“”"]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Public text: scrub uncertain sentences and extraction notes, then unquote. */
export function publicText(text: string | null | undefined): { text: string | null; removed: number } {
  const r = scrubUncertain(text);
  const n = scrubNotes(r.text);
  return { text: n.text ? unquote(n.text) || null : null, removed: r.removed + n.removed };
}

/** Public list: drop items about uncertain material or the captions, unquote, dedupe, cap. */
export function publicList(items: readonly string[] | null | undefined, cap = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items ?? []) {
    if (typeof raw !== "string" || UNCERTAIN_RE.test(raw) || EXTRACTION_NOTE_RE.test(raw)) continue;
    const t = unquote(raw);
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

/** `text` capped at `max` characters on a word boundary (… when cut). */
export function capText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–—-]+$/u, "")}…`;
}

/** One-line summary: first sentence, capped at `max` characters on a word boundary. */
export function oneLine(text: string, max = 140): string {
  return capText(splitSentences(text)[0] ?? text, max);
}

// Cues for picking a one-line summary that agrees with the verdict.
const POSITIVE_CUE_RE =
  /\b(?:ador|aim(?:e|ait|ent|é)\b|apprécie|impressionn|emball|excellent|fan\b|élite|superstar|vedette|coup de c(?:œ|oe)ur|enthousias|admir|croit beaucoup|valoris|convaincu|très bon|bon joueur|brillant|dominant|spectaculaire|meilleur)/i;
const NEGATIVE_CUE_RE =
  /\b(?:dout|sceptique|déçu|décevant|déception|négati|n'aime pas|pas convaincu|erreur|surévalu|limité|ne voit pas|n'(?:a|avait|est|était) jamais|ne \S+ jamais|inquiet|inquiète|critiqu|pire|mauvais|faible|lent\b|flop|condamn|ne croit (?:pas|plus)|ne sera pas|n'est pas|n'a pas|pas un\b|au mieux|réserv|nuanc|tempér|refroidi|\bmou\b|\bpeu\b|dilettante|tourné la page|blessures?|ralenti|recul|baisse|moins)/i;
const CONTRAST_CUE_RE = /\b(?:mais|toutefois|cependant|pourtant|quand même|tout en|malgré|reste|demeure)\b/i;
/**
 * Sentences about the past ("Il a longtemps adoré…", "En 2022, il…", "De
 * 2023 à 2024…", "Il le voyait comme…"): a one-liner states his view now.
 */
const HISTORY_CUE_RE =
  /\blongtemps\b|\bà l'époque\b|\bautrefois\b|\bpendant des années\b|^(?:en|dès|de|avant|au départ|d'abord|lors)\b[^,.;:]{0,40}\b(?:19|20)\d\d\b|\b(?:il|snake)\s+(?:le\s+|l'|lui\s+|en\s+)?(?:voyait|approuvait|jugeait|trouvait|croyait|classait|aimait|adorait|prédisait|disait|préférait|plaçait|considérait|estimait|était)\b/i;

function lineAgrees(sentence: string, verdict: string): boolean {
  if (HISTORY_CUE_RE.test(sentence)) return false;
  const pos = POSITIVE_CUE_RE.test(sentence);
  const neg = NEGATIVE_CUE_RE.test(sentence);
  const contrast = CONTRAST_CUE_RE.test(sentence);
  switch (verdict) {
    case "très positif":
    case "positif":
      return !(neg && !pos && !contrast);
    case "mitigé":
      return neg || contrast;
    case "négatif":
    case "très négatif":
      return neg && !(pos && !contrast);
    default:
      return true;
  }
}

/**
 * One-line summary for a verdict chip (/league): the first sentence of the
 * summary that agrees with the verdict and is not about the past, so a
 * "Mitigé ↘" chip never sits on "Snake a longtemps adoré X". Falls back to
 * the projection, then to nothing (the chip and its link stay).
 */
export function verdictLine(text: string, verdict: string, projection: string | null, max = 140): string {
  for (const s of splitSentences(text).slice(0, 4)) {
    if (lineAgrees(s, verdict)) return capText(s, max);
  }
  return projection ? capText(`Projection : ${projection}`, max) : "";
}
