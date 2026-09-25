/**
 * Optional data the player explorer picks up when it is published next to
 * the site, and hides when it is not (the browser gets a 404):
 *
 * - `public/fantrax/dynasty.json`: a dynasty value per Fantrax id (value,
 *   career phase, ETA, P(NHL), p10/p50/p90);
 * - `public/snake/index.json`: Simon « Snake » Boisvert's scouting index
 *   (verdict, trend, projection, synthesis, opinion count, page key).
 *
 * Both files come from other pipelines, so the readers here are tolerant:
 * a few spellings of each field are accepted, unknown fields are ignored,
 * and the explorer only shows the columns and filters whose field actually
 * appears in the file.
 */

// ------------------------------------------------------------ dynasty

export interface DynastyInfo {
  value?: number;
  /** Career phase label, e.g. "espoir", "en ascension", "prime", "déclin", "fin de carrière". */
  phase?: string;
  /** Expected NHL arrival (season start year). */
  eta?: number;
  /** Probability (0..1) of becoming an NHL regular. */
  pNhl?: number;
  p10?: number;
  p50?: number;
  p90?: number;
}

export type DynastyField = keyof DynastyInfo;

export interface DynastyIndex {
  byFantrax: Map<string, DynastyInfo>;
  byNhl: Map<number, DynastyInfo>;
  /** Fields present on at least one player. */
  fields: Set<DynastyField>;
  /** Phase labels in career order (known ones first). */
  phases: string[];
}

/** Career order for the phase labels the dynasty model is expected to use. */
export const DYNASTY_PHASE_ORDER = ["espoir", "en ascension", "prime", "déclin", "fin de carrière"];

/** Fantrax ids are short base-36 strings ("05wwg"); NHL ids are 8xxxxxx. */
const FANTRAX_ID = /^[0-9a-z]{5,6}$/;
const NHL_ID = /^8\d{6}$/;

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => !!x && typeof x === "object" && !Array.isArray(x);

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

/** `2027`, `"2027-28"`, `"2027"` → 2027. */
function yearOf(x: unknown): number | undefined {
  const n = num(x);
  if (n !== undefined && n >= 1990 && n <= 2100) return Math.round(n);
  if (typeof x === "string") {
    const m = /(19|20)\d{2}/.exec(x);
    if (m) return Number(m[0]);
  }
  return undefined;
}

/** 0..1, accepting a percent (72 → 0.72). */
function probability(x: unknown): number | undefined {
  let n = num(typeof x === "string" ? x.replace("%", "") : x);
  if (n === undefined) return undefined;
  if (n > 1) n /= 100;
  return n >= 0 && n <= 1 ? n : undefined;
}

function dynastyInfo(rec: Json): DynastyInfo | null {
  const out: DynastyInfo = {};
  const value = num(pick(rec, ["dynastyValue", "dynasty", "dv", "value", "score"]));
  if (value !== undefined) out.value = value;
  const phase = pick(rec, ["phase", "phaseLabel", "stage", "careerPhase"]);
  if (typeof phase === "string" && phase.trim()) out.phase = phase.trim();
  const eta = yearOf(pick(rec, ["eta", "etaYear", "etaSeason", "arrival"]));
  if (eta !== undefined) out.eta = eta;
  const p = probability(pick(rec, ["pNhl", "pNHL", "p_nhl", "pnhl", "probNhl", "nhlProbability"]));
  if (p !== undefined) out.pNhl = p;
  const range = pick(rec, ["range", "pct", "percentiles", "p"]);
  const [r10, r50, r90] = Array.isArray(range) ? range.map(num) : [];
  const p10 = num(rec.p10) ?? r10;
  const p50 = num(rec.p50) ?? r50;
  const p90 = num(rec.p90) ?? r90;
  if (p10 !== undefined) out.p10 = p10;
  if (p50 !== undefined) out.p50 = p50;
  if (p90 !== undefined) out.p90 = p90;
  return Object.keys(out).length ? out : null;
}

function orderedLabels(labels: Iterable<string>, order: readonly string[]): string[] {
  const set = new Set(labels);
  const known = order.filter((l) => set.has(l));
  const rest = [...set].filter((l) => !order.includes(l)).sort((a, b) => a.localeCompare(b, "fr"));
  return [...known, ...rest];
}

/**
 * Reads dynasty.json in any of the likely shapes: `{ players: {id: rec} }`,
 * `{ players: [rec] }`, `{ rows: … }`, a bare `{id: rec}` map or `[rec]`.
 * Records are keyed by Fantrax id (or NHL id) through their map key or an
 * `id` / `fantraxId` / `fx` / `nhlId` / `nhl` field. Null when nothing usable.
 */
export function parseDynasty(json: unknown): DynastyIndex | null {
  const root = isObj(json) ? (json.players ?? json.rows ?? json.values ?? json) : json;
  const entries: Array<[string | null, Json]> = Array.isArray(root)
    ? root.filter(isObj).map((r) => [null, r])
    : isObj(root)
      ? Object.entries(root).filter((e): e is [string, Json] => isObj(e[1]))
      : [];
  const index: DynastyIndex = { byFantrax: new Map(), byNhl: new Map(), fields: new Set(), phases: [] };
  const phases = new Set<string>();
  for (const [key, rec] of entries) {
    const info = dynastyInfo(rec);
    if (!info) continue;
    const fx = [rec.fantraxId, rec.fx, rec.id, key].find((k) => typeof k === "string" && FANTRAX_ID.test(k)) as
      | string
      | undefined;
    const nhlRaw = [rec.nhlId, rec.nhl, rec.id, key].map((k) => (typeof k === "number" ? String(k) : k)).find(
      (k) => typeof k === "string" && NHL_ID.test(k),
    ) as string | undefined;
    if (!fx && !nhlRaw) continue;
    if (fx) index.byFantrax.set(fx, info);
    if (nhlRaw) index.byNhl.set(Number(nhlRaw), info);
    for (const f of Object.keys(info) as DynastyField[]) index.fields.add(f);
    if (info.phase) phases.add(info.phase);
  }
  if (index.byFantrax.size === 0 && index.byNhl.size === 0) return null;
  index.phases = orderedLabels(phases, DYNASTY_PHASE_ORDER);
  return index;
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

/** Rank of a verdict (0 = most positive), or null when unknown. */
export function verdictRank(v: string | undefined): number | null {
  if (!v) return null;
  const i = SNAKE_VERDICT_ORDER.indexOf(v);
  return i < 0 ? null : i;
}

/**
 * Rows of the compact `public/snake/fantrax.json` (`{ rows: { fxId: [key,
 * verdict, trend, one-line summary, probable] } }`) as index rows.
 */
function compactSnakeRows(rows: Json): Json[] {
  const out: Json[] = [];
  for (const [fx, e] of Object.entries(rows)) {
    if (!Array.isArray(e) || typeof e[0] !== "string") continue;
    out.push({ k: e[0], fx, v: e[1], td: e[2], s: e[3] });
  }
  return out;
}

/**
 * Reads the Snake index: `public/snake/index.json` (`{ rows: [...] }`, v1
 * short keys or long names), or the compact Fantrax-keyed
 * `public/snake/fantrax.json` (no projection or opinion count: those
 * columns then stay hidden).
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

/** The dynasty / Snake record of a pool player (Fantrax id first, then NHL id). */
export function lookupExtra<T>(
  index: { byFantrax: Map<string, T>; byNhl: Map<number, T> } | null,
  id: string,
  nhl: number | undefined,
): T | null {
  if (!index) return null;
  return index.byFantrax.get(id) ?? (nhl !== undefined ? index.byNhl.get(nhl) : undefined) ?? null;
}
