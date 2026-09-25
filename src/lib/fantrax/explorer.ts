/**
 * Pure model behind the /league « Explorateur de joueurs »: rows (pool.json
 * + live rosters and draft picks + the draft helper's odds + optional
 * dynasty / Snake data), filters, sorts, presets and the URL query that
 * bookmarks a view. No React, no DOM: everything here is unit-tested.
 *
 * Statuses follow the live fxea read when there is one: a player drafted or
 * signed since the sync leaves « disponible » at the next poll.
 */
import { foldSearchText } from "../search-fold";
import { FANTRAX_ICON, NON_PLAYING_ICONS } from "./config";
import {
  draftIsOpen,
  draftNeed,
  draftPoolInputs,
  planOdds,
  seasonFp,
  type PlanLineup,
} from "./daily-plan";
import { draftOutlook, draftValue, type DraftPickInfo } from "./draft";
import {
  lookupExtra,
  verdictRank,
  type DynastyIndex,
  type DynastyInfo,
  type SnakeIndex,
  type SnakeInfo,
} from "./explorer-extras";
import { POOL_GROUPS, type PoolGroup, type PoolRosterStatus, type PoolSnapshot, type PoolSource } from "./pool";
import type { StateSnapshot, ValuesSnapshot } from "./snapshot-types";

// ------------------------------------------------------------ rows

export interface ExplorerRow {
  id: string;
  name: string;
  /** Folded "name team" for the search box. */
  search: string;
  /** NHL team ("" without one). */
  team: string;
  groups: PoolGroup[];
  age: number | null;
  birthDate: string | null;
  /** Fantasy team rostering him (or that just drafted him); null when available. */
  owner: string | null;
  rosterStatus: PoolRosterStatus | null;
  /** How an unowned player is listed in Fantrax (waivers or free agency). */
  free: "FA" | "WW" | null;
  minorsEligible: boolean;
  /** On the NHL IR or out (day-to-day players may still dress: not counted). */
  injured: boolean;
  /**
   * Playing in the NHL, as the draft and waiver helpers see it: an NHL
   * club, no icon that rules him out (IR, out, suspended, minors, unsigned,
   * inactive) and on Fantrax's player lists at the sync.
   */
  playing: boolean;
  icons: string[];
  ros: number | null;
  adp: number | null;
  nhlDraft: { year: number; overall: number; team: string } | null;
  fp: number | null;
  fpg: number | null;
  gp: number | null;
  /** Season FP with the need bonus (the draft helper's value); projected players only. */
  value: number | null;
  /** Draft pool only, while the draft runs. */
  vona: number | null;
  /** Odds (0..1) he is still there at my next pick (draft pool only). */
  available: number | null;
  src: PoolSource;
  nhl: number | null;
  dynasty: DynastyInfo | null;
  snake: SnakeInfo | null;
}

/** Icons that make a player « blessé » for the « exclure les blessés » toggle (day-to-day is not). */
export const INJURY_ICONS: readonly string[] = [FANTRAX_ICON.nhlInjuredReserve, FANTRAX_ICON.injured];

export interface ExplorerDraft {
  next: DraftPickInfo | null;
  following: DraftPickInfo | null;
  picksBefore: number;
  byId: Map<string, { value: number; vona: number | null; available: number }>;
}

/**
 * The draft helper's numbers for EVERY player of its pool (the panel shows
 * the top 15): same pool, need bonus and pool share as the daily plan, so
 * the explorer and the draft panel always agree. Null when no draft is open.
 */
export function explorerDraft(
  state: StateSnapshot,
  values: ValuesSnapshot,
  teamId: string,
  baseLineup: Pick<PlanLineup, "slots"> | null,
): ExplorerDraft | null {
  if (!state.draft || !draftIsOpen(state)) return null;
  const { pool, poolShare } = draftPoolInputs(state, values);
  const need = baseLineup ? draftNeed(baseLineup) : {};
  const o = draftOutlook(state.draft.picks, teamId, pool, need, { poolShare, boardSize: Number.POSITIVE_INFINITY });
  const sure = o.picksBefore === 0;
  const byId = new Map(
    o.board.map((b) => [
      b.id,
      { value: b.value, vona: b.vona, available: o.next ? planOdds(b.available, sure) : 1 },
    ]),
  );
  return { next: o.next, following: o.following, picksBefore: o.picksBefore, byId };
}

export interface ExplorerRowsInput {
  pool: PoolSnapshot;
  /** Baked state with the live overlay applied; null before it loads. */
  state: StateSnapshot | null;
  values: ValuesSnapshot | null;
  baseLineup: Pick<PlanLineup, "slots"> | null;
  draft: ExplorerDraft | null;
  dynasty: DynastyIndex | null;
  snake: SnakeIndex | null;
}

const LETTER: Record<string, PoolRosterStatus> = {
  ACTIVE: "A",
  RESERVE: "R",
  INJURED_RESERVE: "I",
  MINORS: "M",
};

export function buildExplorerRows(input: ExplorerRowsInput): ExplorerRow[] {
  const { pool, state, values, draft } = input;
  // Owners: live (or baked) rosters, then picks made since the last roster read.
  const owners = new Map<string, { team: string; status: PoolRosterStatus | null }>();
  if (state) {
    for (const [team, roster] of Object.entries(state.rosters)) {
      for (const r of roster) owners.set(r.id, { team, status: LETTER[r.status] ?? null });
    }
    for (const p of state.draft?.picks ?? []) {
      if (p.playerId && !owners.has(p.playerId)) owners.set(p.playerId, { team: p.teamId, status: null });
    }
  }
  const need = input.baseLineup ? draftNeed(input.baseLineup) : {};
  const rows: ExplorerRow[] = [];
  for (const r of pool.players) {
    const groups = POOL_GROUPS.filter((g) => r.pos.includes(g));
    const bakedTeam = r.st !== "FA" && r.st !== "WW" ? r.st : null;
    const own = state ? (owners.get(r.id) ?? null) : bakedTeam ? { team: bakedTeam, status: r.rs ?? null } : null;
    // Dropped since the sync: Fantrax puts him on waivers first.
    const free = own ? null : r.st === "FA" ? "FA" : "WW";
    const icons = r.ic ?? [];
    const rec = values?.players[r.id];
    const fp = r.fp ?? null;
    let value: number | null = null;
    if (fp !== null) {
      const sFp = rec?.src === "proj" ? seasonFp(rec) : fp;
      value = draftValue({ id: r.id, groups, seasonFp: sFp, adp: Number.POSITIVE_INFINITY }, need);
    }
    const d = !own ? draft?.byId.get(r.id) : undefined;
    rows.push({
      id: r.id,
      name: r.n,
      search: foldSearchText(`${r.n} ${r.t}`),
      team: r.t,
      groups,
      age: r.age ?? null,
      birthDate: r.bd ?? null,
      owner: own?.team ?? null,
      rosterStatus: own?.status ?? null,
      free,
      minorsEligible: !!r.me,
      injured: icons.some((i) => INJURY_ICONS.includes(i)),
      playing: r.t !== "" && !icons.some((i) => NON_PLAYING_ICONS.includes(i)) && !r.nl,
      icons,
      ros: r.ros ?? null,
      adp: r.adp ?? null,
      nhlDraft: r.dr ? { year: r.dr[0], overall: r.dr[1], team: r.dr[2] } : null,
      fp,
      fpg: r.fpg ?? null,
      gp: r.gp ?? null,
      value: d ? d.value : value,
      vona: d?.vona ?? null,
      available: d ? d.available : null,
      src: r.src,
      nhl: r.nhl ?? null,
      dynasty: lookupExtra(input.dynasty, r.id, r.nhl),
      snake: lookupExtra(input.snake, r.id, r.nhl),
    });
  }
  return rows;
}

// ------------------------------------------------------------ view

export interface Range {
  min: number | null;
  max: number | null;
}

export const ANY: Range = { min: null, max: null };

export type ExplorerType = "tous" | "proj" | "espoirs";
export const EXPLORER_TYPES: readonly ExplorerType[] = ["tous", "proj", "espoirs"];

/** Status filter keywords; any other value is a fantasy team id. */
export const STATUS_KEYWORDS = ["tous", "dispo", "fa", "ww", "pris", "moi"] as const;
export type StatusKeyword = (typeof STATUS_KEYWORDS)[number];

/** Players with no NHL club (the NHL team filter's extra option). */
export const NO_NHL_TEAM = "aucune";
/** « positif ou mieux » in the Snake verdict filter. */
export const VERDICT_POSITIVE = "positif+";

export interface ExplorerFilters {
  q: string;
  pos: PoolGroup[];
  status: string;
  nhlTeam: string;
  type: ExplorerType;
  age: Range;
  fp: Range;
  fpg: Range;
  ros: Range;
  adp: Range;
  minors: boolean;
  healthy: boolean;
  /** Only players in the NHL now (the draft and waiver helpers' pool rule). */
  active: boolean;
  verdict: string;
  trend: string;
  phase: string;
  /** P(NHL) in percent. */
  pNhl: Range;
  eta: Range;
  dyn: Range;
}

export const SORT_KEYS = [
  "valeur",
  "vona",
  "dispo",
  "fp",
  "fpm",
  "age",
  "adp",
  "ros",
  "lnh",
  "nom",
  "dyn",
  "pnhl",
  "eta",
  "verdict",
  "opinions",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

/** First click direction: best first (low ADP / draft rank / age / ETA come first). */
export const DEFAULT_SORT_DIR: Record<SortKey, SortDir> = {
  valeur: "desc",
  vona: "desc",
  dispo: "desc",
  fp: "desc",
  fpm: "desc",
  age: "asc",
  adp: "asc",
  ros: "desc",
  lnh: "asc",
  nom: "asc",
  dyn: "desc",
  pnhl: "desc",
  eta: "asc",
  verdict: "desc",
  opinions: "desc",
};

export const COLUMN_KEYS = [
  "statut",
  "valeur",
  "vona",
  "dispo",
  "fp",
  "fpm",
  "age",
  "ros",
  "adp",
  "lnh",
  "dyn",
  "phase",
  "pnhl",
  "eta",
  "fourchette",
  "verdict",
  "tendance",
  "opinions",
] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];

export const DEFAULT_COLUMNS: readonly ColumnKey[] = [
  "statut",
  "valeur",
  "vona",
  "dispo",
  "fp",
  "fpm",
  "age",
  "ros",
  "adp",
  "lnh",
  "dyn",
  "phase",
  "verdict",
];

/** The sort a column header toggles (null: not sortable). */
export const COLUMN_SORT: Record<ColumnKey, SortKey | null> = {
  statut: null,
  valeur: "valeur",
  vona: "vona",
  dispo: "dispo",
  fp: "fp",
  fpm: "fpm",
  age: "age",
  ros: "ros",
  adp: "adp",
  lnh: "lnh",
  dyn: "dyn",
  phase: null,
  pnhl: "pnhl",
  eta: "eta",
  fourchette: null,
  verdict: "verdict",
  tendance: null,
  opinions: "opinions",
};

export const PER_PAGE_OPTIONS = [25, 50, 100, 250] as const;
export const DEFAULT_PER_PAGE = 50;

export interface ExplorerView {
  filters: ExplorerFilters;
  sort: { key: SortKey; dir: SortDir };
  /** Visible columns; null = the defaults. */
  cols: ColumnKey[] | null;
  page: number;
  perPage: number;
}

export const DEFAULT_FILTERS: ExplorerFilters = {
  q: "",
  pos: [],
  status: "tous",
  nhlTeam: "",
  type: "tous",
  age: ANY,
  fp: ANY,
  fpg: ANY,
  ros: ANY,
  adp: ANY,
  minors: false,
  healthy: false,
  active: false,
  verdict: "",
  trend: "",
  phase: "",
  pNhl: ANY,
  eta: ANY,
  dyn: ANY,
};

export const DEFAULT_VIEW: ExplorerView = {
  filters: DEFAULT_FILTERS,
  sort: { key: "valeur", dir: "desc" },
  cols: null,
  page: 1,
  perPage: DEFAULT_PER_PAGE,
};

/** What the data on hand can show (columns, sorts and filters without data hide). */
export interface ExplorerCapabilities {
  /** The draft is open and I still pick: VONA and odds exist. */
  draft: boolean;
  dynasty: ReadonlySet<string>;
  snake: boolean;
  /** The Snake file carries opinion counts (the compact one does not). */
  snakeOpinions: boolean;
}

const COLUMN_NEEDS: Partial<Record<ColumnKey, (c: ExplorerCapabilities) => boolean>> = {
  vona: (c) => c.draft,
  dispo: (c) => c.draft,
  dyn: (c) => c.dynasty.has("value"),
  phase: (c) => c.dynasty.has("phase"),
  pnhl: (c) => c.dynasty.has("pNhl"),
  eta: (c) => c.dynasty.has("eta"),
  fourchette: (c) => c.dynasty.has("p10") || c.dynasty.has("p90"),
  verdict: (c) => c.snake,
  tendance: (c) => c.snake,
  opinions: (c) => c.snake && c.snakeOpinions,
};

export function columnAvailable(col: ColumnKey, caps: ExplorerCapabilities): boolean {
  return COLUMN_NEEDS[col]?.(caps) ?? true;
}

export function sortAvailable(key: SortKey, caps: ExplorerCapabilities): boolean {
  const col = sortColumn(key);
  return col ? columnAvailable(col, caps) : true;
}

/** Columns only projected players fill. */
export const PROJECTION_COLUMNS: readonly ColumnKey[] = ["valeur", "vona", "dispo", "fp", "fpm"];

/** Statuses that only list available players (the others only owned ones, or both). */
const AVAILABLE_STATUSES = new Set(["dispo", "fa", "ww"]);

/**
 * Chosen columns (or the defaults) that the data can fill. With the default
 * set, columns that are always empty or the same for the view step aside: a
 * prospects-only view drops the projection columns (so age, Ros%, ADP and
 * NHL draft come into view), a view of owned players drops VONA and the
 * odds, and a view of available players drops « Statut » (the name cell
 * marks the few on waivers), so value, VONA and odds fit on a phone.
 */
export function visibleColumns(view: ExplorerView, caps: ExplorerCapabilities): ColumnKey[] {
  const chosen = new Set(view.cols ?? DEFAULT_COLUMNS);
  if (!view.cols) {
    const f = view.filters;
    if (f.type === "espoirs") for (const c of PROJECTION_COLUMNS) chosen.delete(c);
    if (AVAILABLE_STATUSES.has(f.status)) chosen.delete("statut");
    else if (f.status !== "tous") {
      chosen.delete("vona");
      chosen.delete("dispo");
    }
  }
  return COLUMN_KEYS.filter((c) => chosen.has(c) && columnAvailable(c, caps));
}

/** Labels the optional files actually use (their filters take no other value). */
export interface ExtraLabels {
  phases: readonly string[];
  verdicts: readonly string[];
  trends: readonly string[];
}

/** The column a sort key belongs to (null for the name, which is the row header). */
export function sortColumn(key: SortKey): ColumnKey | null {
  return (COLUMN_KEYS as readonly ColumnKey[]).find((c) => COLUMN_SORT[c] === key) ?? null;
}

/**
 * What a view really does with the data on hand. A bookmark can name what
 * this data cannot show: an unknown team, a dynasty or Snake filter while
 * that file is absent (or a label it does not use), a sort on a missing
 * column. Those fall back here, and the user's URL is left as it was:
 * - unknown status → all players;
 * - dynasty / Snake filters without their data or label → off;
 * - a sort on an unavailable column → the default (value);
 * - a sort on a column the default set hid for this view (value for
 *   prospects, VONA for owned players: empty for every row, so the rows
 *   already fall back to value, then Ros%) → the visible column that
 *   really orders them, so the header arrow tells the truth.
 */
export function effectiveView(
  view: ExplorerView,
  ctx: { caps: ExplorerCapabilities; teamIds: readonly string[]; labels: ExtraLabels },
): { filters: ExplorerFilters; sort: { key: SortKey; dir: SortDir }; columns: ColumnKey[] } {
  const { caps, labels } = ctx;
  const f = view.filters;
  const knownStatus = (STATUS_KEYWORDS as readonly string[]).includes(f.status) || ctx.teamIds.includes(f.status);
  const filters: ExplorerFilters = {
    ...f,
    status: knownStatus ? f.status : "tous",
    verdict:
      caps.snake && (f.verdict === VERDICT_POSITIVE || labels.verdicts.includes(f.verdict)) ? f.verdict : "",
    trend: caps.snake && labels.trends.includes(f.trend) ? f.trend : "",
    phase: caps.dynasty.has("phase") && labels.phases.includes(f.phase) ? f.phase : "",
    pNhl: caps.dynasty.has("pNhl") ? f.pNhl : ANY,
    eta: caps.dynasty.has("eta") ? f.eta : ANY,
    dyn: caps.dynasty.has("value") ? f.dyn : ANY,
  };
  const columns = visibleColumns({ ...view, filters }, caps);
  let sort = sortAvailable(view.sort.key, caps) ? view.sort : DEFAULT_VIEW.sort;
  const col = sortColumn(sort.key);
  if (!view.cols && col && !columns.includes(col)) {
    const key = (["valeur", "ros"] as const).find((k) => columns.includes(k)) ?? "nom";
    sort = { key, dir: DEFAULT_SORT_DIR[key] };
  }
  return { filters, sort, columns };
}

/** Sorts that read the optional dynasty / Snake files. */
const EXTRA_SORTS: ReadonlySet<SortKey> = new Set<SortKey>(["dyn", "pnhl", "eta", "verdict", "opinions"]);

/** The view reads dynasty or Snake data (wait for those files before showing rows). */
export function needsExtras(view: ExplorerView): boolean {
  const f = view.filters;
  const set = (r: Range) => r.min !== null || r.max !== null;
  return !!(f.verdict || f.trend || f.phase) || set(f.pNhl) || set(f.eta) || set(f.dyn) || EXTRA_SORTS.has(view.sort.key);
}

// ------------------------------------------------------------ filtering

const inRange = (x: number | null | undefined, r: Range) =>
  (r.min === null && r.max === null) ||
  (x !== null && x !== undefined && (r.min === null || x >= r.min) && (r.max === null || x <= r.max));

export interface FilterContext {
  /** Selected team (« mon équipe »). */
  teamId: string;
}

export function filterRows(rows: readonly ExplorerRow[], f: ExplorerFilters, ctx: FilterContext): ExplorerRow[] {
  const tokens = foldSearchText(f.q).split(/\s+/).filter(Boolean);
  const pos = new Set(f.pos);
  return rows.filter((r) => {
    if (tokens.length && !tokens.every((t) => r.search.includes(t))) return false;
    if (pos.size && !r.groups.some((g) => pos.has(g))) return false;
    switch (f.status) {
      case "tous":
        break;
      case "dispo":
        if (r.owner !== null) return false;
        break;
      case "fa":
        if (r.owner !== null || r.free !== "FA") return false;
        break;
      case "ww":
        if (r.owner !== null || r.free !== "WW") return false;
        break;
      case "pris":
        if (r.owner === null) return false;
        break;
      case "moi":
        if (r.owner !== ctx.teamId) return false;
        break;
      default:
        if (r.owner !== f.status) return false;
    }
    if (f.nhlTeam && (f.nhlTeam === NO_NHL_TEAM ? r.team !== "" : r.team !== f.nhlTeam)) return false;
    if (f.type === "proj" && r.src !== "p") return false;
    if (f.type === "espoirs" && r.src !== "e") return false;
    if (f.minors && !r.minorsEligible) return false;
    if (f.healthy && r.injured) return false;
    if (f.active && !r.playing) return false;
    if (!inRange(r.age, f.age) || !inRange(r.fp, f.fp) || !inRange(r.fpg, f.fpg)) return false;
    if (!inRange(r.ros, f.ros) || !inRange(r.adp, f.adp)) return false;
    if (f.verdict) {
      if (f.verdict === VERDICT_POSITIVE) {
        const rank = verdictRank(r.snake?.verdict);
        if (rank === null || rank > 1) return false;
      } else if (r.snake?.verdict !== f.verdict) return false;
    }
    if (f.trend && r.snake?.trend !== f.trend) return false;
    if (f.phase && r.dynasty?.phase !== f.phase) return false;
    const pNhl = r.dynasty?.pNhl;
    if (!inRange(pNhl === undefined ? null : Math.round(pNhl * 1000) / 10, f.pNhl)) return false;
    if (!inRange(r.dynasty?.eta, f.eta) || !inRange(r.dynasty?.value, f.dyn)) return false;
    return true;
  });
}

// ------------------------------------------------------------ sorting

const SORT_VALUE: Record<Exclude<SortKey, "nom">, (r: ExplorerRow) => number | null | undefined> = {
  valeur: (r) => r.value,
  vona: (r) => r.vona,
  dispo: (r) => r.available,
  fp: (r) => r.fp,
  fpm: (r) => r.fpg,
  age: (r) => r.age,
  adp: (r) => r.adp,
  ros: (r) => r.ros,
  lnh: (r) => r.nhlDraft?.overall,
  dyn: (r) => r.dynasty?.value,
  pnhl: (r) => r.dynasty?.pNhl,
  eta: (r) => r.dynasty?.eta,
  // Higher = more positive, so « desc » puts « très positif » first.
  verdict: (r) => {
    const rank = verdictRank(r.snake?.verdict);
    return rank === null ? null : -rank;
  },
  opinions: (r) => r.snake?.opinions,
};

const byName = (a: ExplorerRow, b: ExplorerRow) => a.name.localeCompare(b.name, "fr") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Stable sort; players without the sorted number always come last, then
 * ties fall back to value, Ros% and name.
 */
export function sortRows(rows: readonly ExplorerRow[], sort: { key: SortKey; dir: SortDir }): ExplorerRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  if (sort.key === "nom") return [...rows].sort((a, b) => sign * byName(a, b));
  const get = SORT_VALUE[sort.key];
  const num = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? null : x);
  return [...rows].sort((a, b) => {
    const x = num(get(a));
    const y = num(get(b));
    if (x === null || y === null) {
      if (x !== y) return x === null ? 1 : -1;
    } else if (x !== y) return sign * (x - y);
    const vx = num(a.value) ?? Number.NEGATIVE_INFINITY;
    const vy = num(b.value) ?? Number.NEGATIVE_INFINITY;
    if (vx !== vy) return vy - vx;
    const rx = num(a.ros) ?? -1;
    const ry = num(b.ros) ?? -1;
    if (rx !== ry) return ry - rx;
    return byName(a, b);
  });
}

/** Clicking a header: same column flips, a new one starts at its natural direction. */
export function nextSort(current: { key: SortKey; dir: SortDir }, key: SortKey): { key: SortKey; dir: SortDir } {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: DEFAULT_SORT_DIR[key] };
}

export function pageCount(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, perPage)));
}

export function clampPage(page: number, total: number, perPage: number): number {
  return Math.min(Math.max(1, Math.floor(page) || 1), pageCount(total, perPage));
}

/** Number of filters set beyond the defaults (the « Réinitialiser » badge). */
export function activeFilterCount(f: ExplorerFilters): number {
  let n = 0;
  if (f.q.trim()) n++;
  if (f.pos.length) n++;
  if (f.status !== "tous") n++;
  if (f.nhlTeam) n++;
  if (f.type !== "tous") n++;
  for (const r of [f.age, f.fp, f.fpg, f.ros, f.adp, f.pNhl, f.eta, f.dyn]) if (r.min !== null || r.max !== null) n++;
  if (f.minors) n++;
  if (f.healthy) n++;
  if (f.active) n++;
  if (f.verdict) n++;
  if (f.trend) n++;
  if (f.phase) n++;
  return n;
}

// ------------------------------------------------------------ URL

/** Query keys the explorer owns (others, like `team`, are left alone). */
export const EXPLORER_PARAMS = [
  "q",
  "pos",
  "statut",
  "lnh",
  "type",
  "age",
  "fp",
  "fpm",
  "ros",
  "adp",
  "mineures",
  "sansblesses",
  "actifs",
  "verdict",
  "tendance",
  "phase",
  "pnhl",
  "eta",
  "dyn",
  "tri",
  "ordre",
  "cols",
  "page",
  "par",
  // A preset by name (links from the other panels): resolved once the data is in.
  "vue",
] as const;

const RANGE_PARAMS = {
  age: "age",
  fp: "fp",
  fpm: "fpg",
  ros: "ros",
  adp: "adp",
  pnhl: "pNhl",
  eta: "eta",
  dyn: "dyn",
} as const satisfies Record<string, keyof ExplorerFilters>;

const MAX_TEXT = 60;

function fmtBound(x: number | null): string {
  if (x === null || !Number.isFinite(x)) return "";
  return String(Math.round(x * 100) / 100);
}

/** `{ min: 18, max: 21 }` → `18-21`; `18-`, `-21`; "" when open. */
export function encodeRange(r: Range): string {
  if (r.min === null && r.max === null) return "";
  return `${fmtBound(r.min)}-${fmtBound(r.max)}`;
}

/** Inverse of `encodeRange`; a lone number is an exact value. Garbage → open. */
export function decodeRange(s: string | null): Range {
  if (!s) return ANY;
  const one = /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : null;
  if (one !== null) return { min: one, max: one };
  const m = /^(\d+(?:\.\d+)?)?-(\d+(?:\.\d+)?)?$/.exec(s.trim());
  if (!m) return ANY;
  const min = m[1] !== undefined ? Number(m[1]) : null;
  const max = m[2] !== undefined ? Number(m[2]) : null;
  if (min !== null && max !== null && min > max) return { min: max, max: min };
  return { min, max };
}

const isGroup = (g: string): g is PoolGroup => (POOL_GROUPS as readonly string[]).includes(g);
const isSortKey = (k: string | null): k is SortKey => !!k && (SORT_KEYS as readonly string[]).includes(k);
const isColumn = (k: string): k is ColumnKey => (COLUMN_KEYS as readonly string[]).includes(k);
const cleanText = (s: string | null) => (s ?? "").slice(0, MAX_TEXT);

/** Reads the explorer's part of a query string (anything invalid falls back to the default). */
export function parseExplorerParams(params: URLSearchParams): ExplorerView {
  const f: ExplorerFilters = { ...DEFAULT_FILTERS };
  f.q = cleanText(params.get("q"));
  f.pos = [...new Set((params.get("pos") ?? "").toUpperCase().split(",").filter(isGroup))];
  f.pos.sort((a, b) => POOL_GROUPS.indexOf(a) - POOL_GROUPS.indexOf(b));
  const status = params.get("statut");
  f.status = status && /^[a-z0-9]{1,24}$/i.test(status) ? status : "tous";
  const lnh = params.get("lnh");
  f.nhlTeam = lnh && /^[a-z]{2,6}$/i.test(lnh) ? (lnh.toLowerCase() === NO_NHL_TEAM ? NO_NHL_TEAM : lnh.toUpperCase()) : "";
  const type = params.get("type");
  f.type = (EXPLORER_TYPES as readonly string[]).includes(type ?? "") ? (type as ExplorerType) : "tous";
  for (const [param, key] of Object.entries(RANGE_PARAMS)) {
    (f as unknown as Record<string, Range>)[key] = decodeRange(params.get(param));
  }
  f.minors = params.get("mineures") === "1";
  f.healthy = params.get("sansblesses") === "1";
  f.active = params.get("actifs") === "1";
  f.verdict = cleanText(params.get("verdict"));
  f.trend = cleanText(params.get("tendance"));
  f.phase = cleanText(params.get("phase"));
  const tri = params.get("tri");
  const key: SortKey = isSortKey(tri) ? tri : DEFAULT_VIEW.sort.key;
  const ordre = params.get("ordre");
  const dir: SortDir = ordre === "asc" || ordre === "desc" ? ordre : DEFAULT_SORT_DIR[key];
  const colsRaw = params.get("cols");
  const cols = colsRaw === null ? null : colsRaw.split(",").filter(isColumn);
  const page = Number.parseInt(params.get("page") ?? "", 10);
  const par = Number.parseInt(params.get("par") ?? "", 10);
  return {
    filters: f,
    sort: { key, dir },
    cols: cols ? COLUMN_KEYS.filter((c) => cols.includes(c)) : null,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    perPage: (PER_PAGE_OPTIONS as readonly number[]).includes(par) ? par : DEFAULT_PER_PAGE,
  };
}

/** The explorer's non-default settings as query params, in a fixed order. */
export function explorerParams(view: ExplorerView): URLSearchParams {
  const f = view.filters;
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim().slice(0, MAX_TEXT));
  if (f.pos.length) p.set("pos", f.pos.join(","));
  if (f.status !== "tous") p.set("statut", f.status);
  if (f.nhlTeam) p.set("lnh", f.nhlTeam);
  if (f.type !== "tous") p.set("type", f.type);
  for (const [param, key] of Object.entries(RANGE_PARAMS)) {
    const s = encodeRange(f[key] as Range);
    if (s) p.set(param, s);
  }
  if (f.minors) p.set("mineures", "1");
  if (f.healthy) p.set("sansblesses", "1");
  if (f.active) p.set("actifs", "1");
  if (f.verdict) p.set("verdict", f.verdict);
  if (f.trend) p.set("tendance", f.trend);
  if (f.phase) p.set("phase", f.phase);
  if (view.sort.key !== DEFAULT_VIEW.sort.key) p.set("tri", view.sort.key);
  if (view.sort.dir !== DEFAULT_SORT_DIR[view.sort.key]) p.set("ordre", view.sort.dir);
  if (view.cols) {
    const same =
      view.cols.length === DEFAULT_COLUMNS.length && DEFAULT_COLUMNS.every((c) => view.cols!.includes(c));
    if (!same) p.set("cols", view.cols.join(","));
  }
  if (view.page > 1) p.set("page", String(view.page));
  if (view.perPage !== DEFAULT_PER_PAGE) p.set("par", String(view.perPage));
  return p;
}

/**
 * `search` with the explorer's keys replaced by `view` (other keys such as
 * `team` kept, in place): `?team=x&statut=dispo`, or "" when nothing is set.
 */
export function explorerSearch(view: ExplorerView, search: string): string {
  const params = new URLSearchParams(search);
  for (const k of EXPLORER_PARAMS) params.delete(k);
  for (const [k, v] of explorerParams(view)) params.set(k, v);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** `search` already says `view` (same settings, whatever the key order). */
export function sameExplorerSearch(view: ExplorerView, search: string): boolean {
  return explorerParams(parseExplorerParams(new URLSearchParams(search))).toString() === explorerParams(view).toString();
}

export function hasExplorerParams(search: string): boolean {
  const params = new URLSearchParams(search);
  return EXPLORER_PARAMS.some((k) => params.has(k));
}

// ------------------------------------------------------------ presets

export type PresetId = "repechage" | "espoirs" | "autonomes" | "equipe";

export interface ExplorerPreset {
  id: PresetId;
  label: string;
  description: string;
  filters: ExplorerFilters;
  sort: { key: SortKey; dir: SortDir };
}

/**
 * One-click views. Prospects sort by dynasty value when that file is
 * published, else by Ros% (the best signal Fantrax gives for them).
 */
export function explorerPresets(caps: Pick<ExplorerCapabilities, "dynasty" | "draft">): ExplorerPreset[] {
  const prospectSort: SortKey = caps.dynasty.has("value") ? "dyn" : "ros";
  return [
    {
      id: "repechage",
      label: caps.draft ? "Meilleurs disponibles au repêchage" : "Meilleurs disponibles",
      description: caps.draft
        ? "Le tableau du panneau Repêchage au complet : joueurs projetés que personne n'a, actifs dans la LNH, par valeur."
        : "Joueurs projetés que personne n'a, actifs dans la LNH, par valeur.",
      filters: { ...DEFAULT_FILTERS, status: "dispo", type: "proj", active: true },
      sort: { key: "valeur", dir: "desc" },
    },
    {
      id: "espoirs",
      label: "Espoirs ≤ 21 ans disponibles",
      description: "Espoirs sans projection LNH, 21 ans ou moins, que personne n'a.",
      filters: { ...DEFAULT_FILTERS, status: "dispo", type: "espoirs", age: { min: null, max: 21 } },
      sort: { key: prospectSort, dir: DEFAULT_SORT_DIR[prospectSort] },
    },
    {
      id: "autonomes",
      label: "Agents libres à ajouter",
      description: "Joueurs autonomes ou au ballottage actifs dans la LNH, par points projetés.",
      filters: { ...DEFAULT_FILTERS, status: "dispo", type: "proj", active: true },
      sort: { key: "fp", dir: "desc" },
    },
    {
      id: "equipe",
      label: "Mon équipe",
      description: "Tout votre effectif, mineures comprises.",
      filters: { ...DEFAULT_FILTERS, status: "moi" },
      sort: { key: "valeur", dir: "desc" },
    },
  ];
}

export function presetView(preset: ExplorerPreset, current: ExplorerView): ExplorerView {
  return { ...current, filters: { ...preset.filters }, sort: { ...preset.sort }, page: 1 };
}

const sameRange = (a: Range, b: Range) => a.min === b.min && a.max === b.max;

export function sameFilters(a: ExplorerFilters, b: ExplorerFilters): boolean {
  return (
    a.q.trim() === b.q.trim() &&
    a.pos.join() === b.pos.join() &&
    a.status === b.status &&
    a.nhlTeam === b.nhlTeam &&
    a.type === b.type &&
    a.minors === b.minors &&
    a.healthy === b.healthy &&
    a.active === b.active &&
    a.verdict === b.verdict &&
    a.trend === b.trend &&
    a.phase === b.phase &&
    (["age", "fp", "fpg", "ros", "adp", "pNhl", "eta", "dyn"] as const).every((k) => sameRange(a[k], b[k]))
  );
}

export function matchesPreset(view: ExplorerView, preset: ExplorerPreset): boolean {
  return sameFilters(view.filters, preset.filters) && view.sort.key === preset.sort.key && view.sort.dir === preset.sort.dir;
}

const PRESET_IDS: readonly PresetId[] = ["repechage", "espoirs", "autonomes", "equipe"];

/** The preset a `?vue=` link names, or null. */
export function presetFromSearch(search: string): PresetId | null {
  const v = new URLSearchParams(search).get("vue");
  return (PRESET_IDS as readonly (string | null)[]).includes(v) ? (v as PresetId) : null;
}

/**
 * Link from another panel to a preset: `?vue=espoirs#explorateur` (other
 * params such as `team` kept). The preset is named rather than spelled
 * out because its sort depends on data the page loads (dynasty value for
 * prospects once published); the explorer resolves it then and rewrites
 * the address with the full view. A plain click applies it in place.
 */
export function presetLinkHref(id: PresetId, search = ""): string {
  const params = new URLSearchParams(search);
  for (const k of EXPLORER_PARAMS) params.delete(k);
  params.set("vue", id);
  return `?${params.toString()}#explorateur`;
}
