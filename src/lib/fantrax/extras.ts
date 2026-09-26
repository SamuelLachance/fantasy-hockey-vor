/**
 * Simon « Snake » Boisvert's verdicts, merged into the player tables' rows:
 * the compact `snake/fantrax.json` (loaded with every Captains page) or
 * `snake/nhl.json`, and the full `snake/index.json` (projection, opinion
 * counts) only when asked for. The files come from another pipeline, so the
 * reader is tolerant (a few spellings per field). The dynasty values have
 * their own reader (`dynasty-index.ts`): this module is in every page's
 * verdict store and stays small.
 */
type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => !!x && typeof x === "object" && !Array.isArray(x);

/** Fantrax ids are short base-36 strings ("05wwg"); NHL ids are 8xxxxxx. */
const FANTRAX_ID = /^[0-9a-z]{5,6}$/;
const NHL_ID = /^8\d{6}$/;

function num(x: unknown): number | undefined {
  if (typeof x === "number") return Number.isFinite(x) ? x : undefined;
  if (typeof x === "string" && x.trim() !== "") {
    const v = Number(x.replace(",", "."));
    return Number.isFinite(v) ? v : undefined;
  }
  return undefined;
}

function pick(rec: Json, keys: readonly string[]): unknown {
  for (const k of keys) if (rec[k] !== undefined && rec[k] !== null) return rec[k];
  return undefined;
}

function orderedLabels(labels: Iterable<string>, order: readonly string[]): string[] {
  const set = new Set(labels);
  const known = order.filter((l) => set.has(l));
  const rest = [...set].filter((l) => !order.includes(l)).sort((a, b) => a.localeCompare(b, "fr"));
  return [...known, ...rest];
}

// ------------------------------------------------------------ Snake

export interface SnakeInfo {
  /** Key of his page: `/snake?p=<key>`. */
  key: string;
  verdict?: string;
  trend?: string;
  projection?: string;
  summary?: string;
  opinions?: number;
  /** Every published opinion's attribution is only « probable ». */
  probable?: boolean;
}

export interface SnakeIndex {
  byFantrax: Map<string, SnakeInfo>;
  byNhl: Map<number, SnakeInfo>;
  verdicts: string[];
  trends: string[];
  hasProjection: boolean;
  /** The file carries opinion counts (the full index does, the compact one not). */
  hasOpinions: boolean;
}

/** Verdict scale, most positive first (the Snake index's own order). */
export const SNAKE_VERDICT_ORDER = ["très positif", "positif", "neutre", "mitigé", "négatif", "très négatif"];
export const SNAKE_TREND_ORDER = ["en hausse", "stable", "variable", "en baisse", "inconnue"];

/** « positif ou mieux » in the Snake verdict filters (every league). */
export const VERDICT_POSITIVE = "positif+";

/** Rank of a verdict (0 = most positive), or null when unknown. */
export function verdictRank(v: string | undefined): number | null {
  if (!v) return null;
  const i = SNAKE_VERDICT_ORDER.indexOf(v);
  return i < 0 ? null : i;
}

/**
 * Rows of the compact files as index rows: `public/snake/fantrax.json`
 * (`{ rows: { fxId: [key, verdict, trend, one-line summary, probable] } }`)
 * and `public/snake/nhl.json` (`{ rows: { nhlId: [key, verdict, trend,
 * probable] } }`).
 */
function compactSnakeRows(rows: Json): Json[] {
  const out: Json[] = [];
  for (const [id, e] of Object.entries(rows)) {
    if (!Array.isArray(e) || typeof e[0] !== "string") continue;
    if (NHL_ID.test(id) && e.length === 4) out.push({ k: e[0], nhl: Number(id), v: e[1], td: e[2], pr: e[3] });
    else out.push({ k: e[0], fx: id, v: e[1], td: e[2], s: e[3], pr: e[4] });
  }
  return out;
}

/**
 * Reads the Snake index: `public/snake/index.json` (`{ rows: [...] }`, v1
 * short keys or long names), or a compact file, Fantrax-keyed
 * `public/snake/fantrax.json` or NHL-keyed `public/snake/nhl.json` (no
 * projection or opinion count: those columns then wait for the index).
 */
export function parseSnakeIndex(json: unknown): SnakeIndex | null {
  const rows = isObj(json) ? (json.rows ?? json.players) : json;
  const compact = isObj(rows) && Object.values(rows).some(Array.isArray);
  const list: Json[] = Array.isArray(rows)
    ? rows.filter(isObj)
    : compact
      ? compactSnakeRows(rows as Json)
      : isObj(rows)
        ? Object.values(rows).filter(isObj)
        : [];
  const index: SnakeIndex = {
    byFantrax: new Map(),
    byNhl: new Map(),
    verdicts: [],
    trends: [],
    hasProjection: false,
    hasOpinions: false,
  };
  const verdicts = new Set<string>();
  const trends = new Set<string>();
  for (const r of list) {
    const key = pick(r, ["k", "key"]);
    if (typeof key !== "string" || !key) continue;
    const fx = pick(r, ["fx", "fantraxId"]);
    // Players Fantrax does not list are keyed by NHL id: "nhl:8470594".
    const nhl = num(pick(r, ["nhl", "nhlId"])) ?? (key.startsWith("nhl:") ? num(key.slice(4)) : undefined);
    const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
    const info: SnakeInfo = { key };
    const verdict = str(pick(r, ["v", "verdict"]));
    const trend = str(pick(r, ["td", "tendance", "trend"]));
    const projection = str(pick(r, ["pj", "projection"]));
    const summary = str(pick(r, ["s", "synthese", "synthèse", "summary"]));
    const opinions = num(pick(r, ["oc", "opinions", "opinionCount"]));
    if (verdict) info.verdict = verdict;
    if (trend) info.trend = trend;
    if (projection) info.projection = projection;
    if (summary) info.summary = summary;
    if (opinions !== undefined) info.opinions = opinions;
    const pr = pick(r, ["pr", "probable"]);
    if (pr === 1 || pr === true) info.probable = true;
    const fxId = typeof fx === "string" && FANTRAX_ID.test(fx) ? fx : key.startsWith("fx:") ? key.slice(3) : undefined;
    if (fxId) index.byFantrax.set(fxId, info);
    if (nhl !== undefined && NHL_ID.test(String(nhl))) index.byNhl.set(nhl, info);
    if (!fxId && nhl === undefined) continue;
    if (verdict) verdicts.add(verdict);
    if (trend) trends.add(trend);
    if (projection) index.hasProjection = true;
    if (opinions !== undefined) index.hasOpinions = true;
  }
  if (index.byFantrax.size === 0 && index.byNhl.size === 0) return null;
  index.verdicts = orderedLabels(verdicts, SNAKE_VERDICT_ORDER);
  index.trends = orderedLabels(trends, SNAKE_TREND_ORDER);
  return index;
}

/**
 * One Snake index over two (the full index's records win, the compact
 * one's fill the gaps; labels and flags combined). Null when both are.
 */
export function mergeSnakeIndex(primary: SnakeIndex | null, fallback: SnakeIndex | null): SnakeIndex | null {
  if (!primary || !fallback) return primary ?? fallback;
  const byFantrax = new Map(fallback.byFantrax);
  for (const [k, v] of primary.byFantrax) byFantrax.set(k, { ...byFantrax.get(k), ...v });
  const byNhl = new Map(fallback.byNhl);
  for (const [k, v] of primary.byNhl) byNhl.set(k, { ...byNhl.get(k), ...v });
  return {
    byFantrax,
    byNhl,
    verdicts: orderedLabels([...primary.verdicts, ...fallback.verdicts], SNAKE_VERDICT_ORDER),
    trends: orderedLabels([...primary.trends, ...fallback.trends], SNAKE_TREND_ORDER),
    hasProjection: primary.hasProjection || fallback.hasProjection,
    hasOpinions: primary.hasOpinions || fallback.hasOpinions,
  };
}

/** The Snake record of a pool player (Fantrax id first, then NHL id). */
export function lookupExtra<T>(
  index: { byFantrax: Map<string, T>; byNhl: Map<number, T> } | null,
  id: string,
  nhl: number | undefined,
): T | null {
  if (!index) return null;
  return index.byFantrax.get(id) ?? (nhl !== undefined ? index.byNhl.get(nhl) : undefined) ?? null;
}
