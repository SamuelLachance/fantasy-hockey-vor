/**
 * Captains Dynasty's player table (the unified PlayerTable's Fantrax
 * adapter, model side): rows (pool.json + live rosters and draft picks +
 * the draft helper's odds + Snake and, once published, dynasty data), the
 * filters (parse / serialize / test), columns, presets and the tab views.
 * No React, no DOM: everything here is unit-tested.
 *
 * Statuses follow the live fxea read when there is one: a player drafted or
 * signed since the sync leaves « disponible » at the next poll.
 */
import { compareNames } from "@/lib/player-table/model";
import { matchesQuery, searchHaystack } from "@/lib/player-table/search";
import { ANY_RANGE, type ColumnDef, type ExtraKind, type FilterModel, type PresetDef, type Range, type SortState, type TableSpec } from "@/lib/player-table/types";
import { readFlag, readRange, sameRange, writeFlag, writeRange } from "@/lib/player-table/url";
import { FANTRAX_ICON, NON_PLAYING_ICONS } from "./config";
import type { DailyPlan, PlanLineup, PlanPlayer } from "./daily-plan";
import { draftOutlook, draftValue, type DraftPickInfo } from "./draft";
import { draftIsOpen, draftNeed, draftPoolInputs, planOdds, seasonFp } from "./draft-inputs";
import { dynastyHints, type DynastyHint } from "./dynasty-hints";
import { lookupExtra, VERDICT_POSITIVE, verdictRank, type DynastyIndex, type DynastyInfo, type SnakeIndex, type SnakeInfo } from "./extras";
import { POOL_GROUPS, type PoolGroup, type PoolRosterStatus, type PoolSnapshot, type PoolSource } from "./pool";
import type { StateSnapshot, ValuesSnapshot } from "./snapshot-types";
import { columnCopy, SORT_LABEL } from "./table-copy";

export type { Range } from "@/lib/player-table/types";
/** An open range (no bound). */
export const ANY: Range = ANY_RANGE;

// ------------------------------------------------------------ rows

export interface FantraxRow {
  id: string;
  name: string;
  /** Folded "name team" for the search box (accents, case and punctuation). */
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
  /** « Conseil » (dynasty value and phase), when the dynasty file is published. */
  hint: DynastyHint | null;
}

/** Icons that make a player « blessé » for the « exclure les blessés » toggle (day-to-day is not). */
export const INJURY_ICONS: readonly string[] = [FANTRAX_ICON.nhlInjuredReserve, FANTRAX_ICON.injured];

export interface FantraxDraftOdds {
  next: DraftPickInfo | null;
  following: DraftPickInfo | null;
  picksBefore: number;
  byId: Map<string, { value: number; vona: number | null; available: number }>;
}

/**
 * The draft helper's numbers for EVERY player of its pool (the plan keeps
 * the top 15): same pool, need bonus and pool share as the daily plan, so
 * the table and the draft panel always agree. Null when no draft is open.
 */
export function fantraxDraftOdds(
  state: StateSnapshot,
  values: ValuesSnapshot,
  teamId: string,
  baseLineup: Pick<PlanLineup, "slots"> | null,
): FantraxDraftOdds | null {
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

export interface FantraxRowsInput {
  pool: PoolSnapshot;
  /** Baked state with the live overlay applied; null before it loads. */
  state: StateSnapshot | null;
  values: ValuesSnapshot | null;
  baseLineup: Pick<PlanLineup, "slots"> | null;
  draft: FantraxDraftOdds | null;
  dynasty: DynastyIndex | null;
  snake: SnakeIndex | null;
}

const LETTER: Record<string, PoolRosterStatus> = {
  ACTIVE: "A",
  RESERVE: "R",
  INJURED_RESERVE: "I",
  MINORS: "M",
};

export function buildFantraxRows(input: FantraxRowsInput): FantraxRow[] {
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
  const rows: FantraxRow[] = [];
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
      search: searchHaystack(r.n, r.t),
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
      hint: null,
    });
  }
  if (input.dynasty) {
    const hints = dynastyHints(rows);
    for (const row of rows) row.hint = hints.get(row.id) ?? null;
  }
  return rows;
}

const CLUBLESS = new Set(["", "(N/A)", "FA"]);

function planRow(
  id: string,
  p: PlanPlayer,
  over: Partial<FantraxRow>,
  snake: SnakeIndex | null,
): FantraxRow {
  const team = CLUBLESS.has(p.t) ? "" : p.t;
  const eligible = p.e.split(",");
  const icons = p.icons ?? [];
  return {
    id,
    name: p.n,
    search: searchHaystack(p.n, team),
    team,
    groups: POOL_GROUPS.filter((g) => eligible.includes(g)),
    age: p.age ?? null,
    birthDate: null,
    owner: null,
    rosterStatus: null,
    free: p.st === "WW" ? "WW" : "FA",
    minorsEligible: false,
    injured: icons.some((i) => INJURY_ICONS.includes(i)),
    playing: team !== "" && !icons.some((i) => NON_PLAYING_ICONS.includes(i)),
    icons,
    ros: p.ros ?? null,
    adp: null,
    nhlDraft: null,
    fp: null,
    fpg: p.fpg,
    gp: null,
    value: null,
    vona: null,
    available: null,
    src: p.src === "proj" ? "p" : "n",
    nhl: null,
    dynasty: null,
    snake: lookupExtra(snake, id, undefined),
    hint: null,
    ...over,
  };
}

/**
 * Rows from the plan the page already has (the chosen team's, re-run after
 * the live read), shown until pool.json is in: the draft board (best
 * available, live picks out) or the team's roster. Pool-only fields stay
 * empty.
 */
export function fantraxFallbackRows(plan: DailyPlan | null, kind: "draft" | "team", snake: SnakeIndex | null): FantraxRow[] {
  if (!plan) return [];
  if (kind === "draft") {
    return (plan.draft?.board ?? []).flatMap((b) => {
      const p = plan.players[b.id];
      return p
        ? [planRow(b.id, p, { fp: b.seasonFp, value: b.value, vona: b.vona, available: b.available, src: "p" }, snake)]
        : [];
    });
  }
  return Object.entries(plan.players)
    .filter(([, p]) => p.st !== "FA" && p.st !== "WW")
    .map(([id, p]) => planRow(id, p, { owner: plan.teamId, free: null, rosterStatus: LETTER[p.st] ?? null }, snake));
}

/**
 * A team's whole roster (minors included) for Mon équipe until pool.json
 * is in: the entries of the league state (live read over the snapshot),
 * named from the plan or, for players the planner skipped (most minors),
 * from values.json. The plan alone only holds the players it considered.
 */
export function fantraxRosterRows(
  plan: DailyPlan | null,
  roster: ReadonlyArray<{ id: string; status: string }>,
  values: ValuesSnapshot["players"],
  teamId: string,
  snake: SnakeIndex | null,
): FantraxRow[] {
  return roster.flatMap((e) => {
    const p = plan?.players[e.id];
    const over: Partial<FantraxRow> = { owner: teamId, free: null, rosterStatus: LETTER[e.status] ?? null };
    if (p) return [planRow(e.id, p, over, snake)];
    const v = values[e.id];
    if (!v) return [];
    const base: PlanPlayer = { n: v.n, t: v.t, e: v.e, st: e.status, fpg: 0, src: v.src, age: v.age };
    // No per-game value outside the plan: left empty, not 0.
    return [planRow(e.id, base, { ...over, fpg: null }, snake)];
  });
}

// ------------------------------------------------------------ filters

export type FantraxType = "tous" | "proj" | "espoirs";
export const FANTRAX_TYPES: readonly FantraxType[] = ["tous", "proj", "espoirs"];

/** Status filter keywords; any other value is a fantasy team id. */
export const STATUS_KEYWORDS = ["tous", "dispo", "fa", "ww", "pris", "moi"] as const;
export type StatusKeyword = (typeof STATUS_KEYWORDS)[number];

/** Players with no NHL club (the NHL team filter's extra option). */
export const NO_NHL_TEAM = "aucune";
/** « positif ou mieux » in the Snake verdict filter. */
export { VERDICT_POSITIVE };

export interface FantraxFilters {
  q: string;
  pos: PoolGroup[];
  status: string;
  nhlTeam: string;
  type: FantraxType;
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

export const DEFAULT_FILTERS: FantraxFilters = {
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

/** What the data on hand can show (columns, sorts and filters without data hide). */
export interface FantraxCaps {
  /** The draft is open and I still pick: VONA and odds exist. */
  draft: boolean;
  dynasty: ReadonlySet<string>;
  /** Snake's verdicts are in (the compact file). */
  snake: boolean;
  /** The full Snake index is in (opinion counts). */
  snakeOpinions: boolean;
}

/** What cells and filters need to know about the page. */
export interface FantraxCtx {
  /** Selected team (« mon équipe »). */
  teamId: string;
  draftOpen: boolean;
  nextPick: number | null;
  teamName: (id: string) => string;
  teamIds: readonly string[];
}

const inRange = (x: number | null | undefined, r: Range) =>
  (r.min === null && r.max === null) ||
  (x !== null && x !== undefined && (r.min === null || x >= r.min) && (r.max === null || x <= r.max));

/** Row test (every filter, the text query included). */
export function matchesFilters(r: FantraxRow, f: FantraxFilters, ctx: Pick<FantraxCtx, "teamId">): boolean {
  if (f.q && !matchesQuery(r.search, f.q)) return false;
  if (f.pos.length && !r.groups.some((g) => f.pos.includes(g))) return false;
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
}

export function filterRows(rows: readonly FantraxRow[], f: FantraxFilters, ctx: Pick<FantraxCtx, "teamId">): FantraxRow[] {
  return rows.filter((r) => matchesFilters(r, f, ctx));
}

const RANGE_PARAMS = {
  age: "age",
  fp: "fp",
  fpm: "fpg",
  ros: "ros",
  adp: "adp",
  pnhl: "pNhl",
  eta: "eta",
  dyn: "dyn",
} as const satisfies Record<string, keyof FantraxFilters>;
const RANGE_KEYS = Object.values(RANGE_PARAMS);

const MAX_TEXT = 60;
const isGroup = (g: string): g is PoolGroup => (POOL_GROUPS as readonly string[]).includes(g);
const cleanText = (s: string) => s.slice(0, MAX_TEXT);

function readPos(s: string): PoolGroup[] {
  const pos = [...new Set(s.toUpperCase().split(",").filter(isGroup))];
  return pos.sort((a, b) => POOL_GROUPS.indexOf(a) - POOL_GROUPS.indexOf(b));
}

/** Filters set (the « Réinitialiser » badge): each differing from the base counts once. */
function activeCount(f: FantraxFilters, base: FantraxFilters): number {
  let n = 0;
  if (f.q.trim() !== base.q.trim()) n++;
  if (f.pos.join() !== base.pos.join()) n++;
  if (f.status !== base.status) n++;
  if (f.nhlTeam !== base.nhlTeam) n++;
  if (f.type !== base.type) n++;
  for (const k of RANGE_KEYS) if (!sameRange(f[k], base[k])) n++;
  if (f.minors !== base.minors) n++;
  if (f.healthy !== base.healthy) n++;
  if (f.active !== base.active) n++;
  if (f.verdict !== base.verdict) n++;
  if (f.trend !== base.trend) n++;
  if (f.phase !== base.phase) n++;
  return n;
}

export function sameFilters(a: FantraxFilters, b: FantraxFilters): boolean {
  return activeCount(a, b) === 0;
}

export const FANTRAX_FILTERS: FilterModel<FantraxFilters, FantraxRow, FantraxCaps, FantraxCtx> = {
  params: [
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
  ],
  parse(params, base) {
    const f: FantraxFilters = { ...base };
    const q = params.get("q");
    if (q !== null) f.q = cleanText(q);
    const pos = params.get("pos");
    if (pos !== null) f.pos = readPos(pos);
    const status = params.get("statut");
    if (status !== null && /^[a-z0-9]{1,24}$/i.test(status)) f.status = status;
    const lnh = params.get("lnh");
    if (lnh === "") f.nhlTeam = "";
    else if (lnh && /^[a-z]{2,6}$/i.test(lnh)) f.nhlTeam = lnh.toLowerCase() === NO_NHL_TEAM ? NO_NHL_TEAM : lnh.toUpperCase();
    const type = params.get("type");
    if ((FANTRAX_TYPES as readonly (string | null)[]).includes(type)) f.type = type as FantraxType;
    for (const [param, key] of Object.entries(RANGE_PARAMS)) f[key] = readRange(params, param, base[key]);
    f.minors = readFlag(params, "mineures", base.minors);
    f.healthy = readFlag(params, "sansblesses", base.healthy);
    f.active = readFlag(params, "actifs", base.active);
    for (const [param, key] of [["verdict", "verdict"], ["tendance", "trend"], ["phase", "phase"]] as const) {
      const v = params.get(param);
      if (v !== null) f[key] = cleanText(v);
    }
    return f;
  },
  serialize(f, base) {
    const out: Array<[string, string]> = [];
    if (f.q.trim() !== base.q.trim()) out.push(["q", f.q.trim().slice(0, MAX_TEXT)]);
    if (f.pos.join() !== base.pos.join()) out.push(["pos", f.pos.join(",")]);
    if (f.status !== base.status) out.push(["statut", f.status]);
    if (f.nhlTeam !== base.nhlTeam) out.push(["lnh", f.nhlTeam]);
    if (f.type !== base.type) out.push(["type", f.type]);
    for (const [param, key] of Object.entries(RANGE_PARAMS)) writeRange(out, param, f[key], base[key]);
    writeFlag(out, "mineures", f.minors, base.minors);
    writeFlag(out, "sansblesses", f.healthy, base.healthy);
    writeFlag(out, "actifs", f.active, base.active);
    if (f.verdict !== base.verdict) out.push(["verdict", f.verdict]);
    if (f.trend !== base.trend) out.push(["tendance", f.trend]);
    if (f.phase !== base.phase) out.push(["phase", f.phase]);
    return out;
  },
  normalize(f, { caps, labels, ctx }) {
    const knownStatus = (STATUS_KEYWORDS as readonly string[]).includes(f.status) || ctx.teamIds.includes(f.status);
    const verdicts = labels.verdicts ?? [];
    return {
      ...f,
      status: knownStatus ? f.status : "tous",
      verdict: caps.snake && (f.verdict === VERDICT_POSITIVE || verdicts.includes(f.verdict)) ? f.verdict : "",
      trend: caps.snake && (labels.trends ?? []).includes(f.trend) ? f.trend : "",
      phase: caps.dynasty.has("phase") && (labels.phases ?? []).includes(f.phase) ? f.phase : "",
      pNhl: caps.dynasty.has("pNhl") ? f.pNhl : ANY,
      eta: caps.dynasty.has("eta") ? f.eta : ANY,
      dyn: caps.dynasty.has("value") ? f.dyn : ANY,
    };
  },
  test: matchesFilters,
  activeCount,
  readsExtras(f) {
    const set = (r: Range) => r.min !== null || r.max !== null;
    const out: ExtraKind[] = [];
    if (f.verdict || f.trend) out.push("snake");
    if (f.phase || set(f.pNhl) || set(f.eta) || set(f.dyn)) out.push("dynasty");
    return out;
  },
  query: (f) => f.q,
  withQuery: (f, q) => ({ ...f, q }),
  equal: sameFilters,
};

// ------------------------------------------------------------ columns

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
  "conseil",
  "verdict",
  "tendance",
  "synthese",
  "opinions",
] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];

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

type Col = ColumnDef<FantraxRow, FantraxCaps, FantraxCtx>;

const GROUP = {
  league: "Ligue",
  projection: "Projection",
  draft: "Repêchage",
  profile: "Profil",
  dynasty: "Dynastie",
  snake: "Snake",
} as const;

const COLUMN_GROUP: Record<ColumnKey, string> = {
  statut: GROUP.league,
  valeur: GROUP.projection,
  vona: GROUP.draft,
  dispo: GROUP.draft,
  fp: GROUP.projection,
  fpm: GROUP.projection,
  age: GROUP.profile,
  ros: GROUP.profile,
  adp: GROUP.profile,
  lnh: GROUP.profile,
  dyn: GROUP.dynasty,
  phase: GROUP.dynasty,
  pnhl: GROUP.dynasty,
  eta: GROUP.dynasty,
  fourchette: GROUP.dynasty,
  conseil: GROUP.dynasty,
  verdict: GROUP.snake,
  tendance: GROUP.snake,
  synthese: GROUP.snake,
  opinions: GROUP.snake,
};

const LEFT: ReadonlySet<ColumnKey> = new Set(["statut", "phase", "conseil", "verdict", "tendance", "synthese"]);

type SortSpec = NonNullable<Col["sort"]>;
const SORTS: Partial<Record<ColumnKey, Omit<SortSpec, "label">>> = {
  valeur: { value: (r) => r.value, defaultDir: "desc" },
  vona: { value: (r) => r.vona, defaultDir: "desc" },
  dispo: { value: (r) => r.available, defaultDir: "desc" },
  fp: { value: (r) => r.fp, defaultDir: "desc" },
  fpm: { value: (r) => r.fpg, defaultDir: "desc" },
  age: { value: (r) => r.age, defaultDir: "asc" },
  ros: { value: (r) => r.ros, defaultDir: "desc" },
  adp: { value: (r) => r.adp, defaultDir: "asc" },
  lnh: { value: (r) => r.nhlDraft?.overall, defaultDir: "asc" },
  dyn: { value: (r) => r.dynasty?.value, defaultDir: "desc" },
  pnhl: { value: (r) => r.dynasty?.pNhl, defaultDir: "desc" },
  eta: { value: (r) => r.dynasty?.eta, defaultDir: "asc" },
  // Higher = more positive, so « desc » puts « très positif » first.
  verdict: {
    value: (r) => {
      const rank = verdictRank(r.snake?.verdict);
      return rank === null ? null : -rank;
    },
    defaultDir: "desc",
  },
  opinions: { value: (r) => r.snake?.opinions, defaultDir: "desc" },
};

const NEEDS: Partial<Record<ColumnKey, (c: FantraxCaps) => boolean>> = {
  vona: (c) => c.draft,
  dispo: (c) => c.draft,
  dyn: (c) => c.dynasty.has("value"),
  phase: (c) => c.dynasty.has("phase"),
  pnhl: (c) => c.dynasty.has("pNhl"),
  eta: (c) => c.dynasty.has("eta"),
  fourchette: (c) => c.dynasty.has("p10") || c.dynasty.has("p90"),
  conseil: (c) => c.dynasty.has("value") && c.dynasty.has("phase"),
  verdict: (c) => c.snake,
  tendance: (c) => c.snake,
  synthese: (c) => c.snake,
  opinions: (c) => c.snake,
};

const EXTRAS: Partial<Record<ColumnKey, ExtraKind>> = {
  dyn: "dynasty",
  pnhl: "dynasty",
  eta: "dynasty",
  verdict: "snake",
  opinions: "snake",
};

export const FANTRAX_COLUMNS: readonly Col[] = COLUMN_KEYS.map((key): Col => {
  const sort = SORTS[key];
  return {
    key,
    label: (ctx) => columnCopy(key, ctx.nextPick).label,
    title: (ctx) => columnCopy(key, ctx.nextPick).title,
    align: LEFT.has(key) ? "left" : "right",
    group: COLUMN_GROUP[key],
    ...(sort ? { sort: { ...sort, label: SORT_LABEL[key as SortKey] } } : {}),
    ...(NEEDS[key] ? { needs: NEEDS[key] } : {}),
    ...(key === "opinions" ? { lazy: "snakeFull" as const } : {}),
    ...(EXTRAS[key] ? { readsExtras: EXTRAS[key] } : {}),
    ...(key === "dispo" ? { mobileUnderName: true } : {}),
  };
});

/** Columns only projected players fill. */
export const PROJECTION_COLUMNS: readonly ColumnKey[] = ["valeur", "vona", "dispo", "fp", "fpm"];

/** Statuses that only list available players (the others only owned ones, or both). */
const AVAILABLE_STATUSES = new Set(["dispo", "fa", "ww"]);

/**
 * Default columns that step aside: a prospects-only view drops the
 * projection columns (so age, Ros%, ADP and NHL draft come into view), a
 * view of owned players drops VONA and the odds, and a view of available
 * players drops « Statut » (the name cell marks the few on waivers), so
 * value, VONA and odds fit on a phone.
 */
function autoHide(f: FantraxFilters): ColumnKey[] {
  const out: ColumnKey[] = [];
  if (f.type === "espoirs") out.push(...PROJECTION_COLUMNS);
  if (AVAILABLE_STATUSES.has(f.status)) out.push("statut");
  else if (f.status !== "tous") out.push("vona", "dispo");
  return out;
}

// ------------------------------------------------------------ presets

export type PresetId = "tous" | "repechage" | "espoirs" | "autonomes" | "ballottage-ww" | "equipe";

const REPECHAGE_COLUMNS: readonly ColumnKey[] = ["valeur", "vona", "dispo", "fp", "age", "ros", "adp", "synthese"];
const EQUIPE_COLUMNS: readonly ColumnKey[] = [
  "statut",
  "valeur",
  "fpm",
  "age",
  "ros",
  "dyn",
  "phase",
  "pnhl",
  "eta",
  "conseil",
  "verdict",
];

const prospectSort = (caps: FantraxCaps): SortState =>
  caps.dynasty.has("value") ? { key: "dyn", dir: "desc" } : { key: "ros", dir: "desc" };

/**
 * One-click views (the chips) and each tab's starting view. Prospects sort
 * by dynasty value when that file is published, else by Ros% (the best
 * signal Fantrax gives for them).
 */
export const FANTRAX_PRESETS: readonly PresetDef<FantraxFilters, FantraxCaps>[] = [
  {
    id: "tous",
    label: "Tous les joueurs",
    description: "Tous les joueurs de la ligue, espoirs compris, par valeur.",
    filters: {},
    sort: { key: "valeur", dir: "desc" },
    cols: DEFAULT_COLUMNS,
  },
  {
    id: "repechage",
    label: "Meilleurs disponibles",
    description: (caps) =>
      caps.draft
        ? "Le repêchage au complet : joueurs projetés que personne n'a, actifs dans la LNH, par valeur."
        : "Joueurs projetés que personne n'a, actifs dans la LNH, par valeur.",
    filters: { status: "dispo", type: "proj", active: true },
    sort: { key: "valeur", dir: "desc" },
    cols: REPECHAGE_COLUMNS,
  },
  {
    id: "espoirs",
    label: "Espoirs ≤ 21 ans disponibles",
    description: "Espoirs sans projection LNH, 21 ans ou moins, que personne n'a.",
    filters: { status: "dispo", type: "espoirs", age: { min: null, max: 21 } },
    sort: prospectSort,
    cols: DEFAULT_COLUMNS,
  },
  {
    id: "autonomes",
    label: "Autonomes à ajouter",
    description: "Joueurs autonomes ou au ballottage actifs dans la LNH, par points projetés.",
    filters: { status: "dispo", type: "proj", active: true },
    sort: { key: "fp", dir: "desc" },
    cols: DEFAULT_COLUMNS,
  },
  {
    id: "ballottage-ww",
    label: "Au ballottage",
    description: "Joueurs projetés au ballottage (une réclamation), par points projetés.",
    filters: { status: "ww", type: "proj" },
    sort: { key: "fp", dir: "desc" },
    cols: DEFAULT_COLUMNS,
  },
  {
    id: "equipe",
    label: "Mon équipe",
    description: "Tout votre effectif, mineures comprises.",
    filters: { status: "moi" },
    sort: { key: "valeur", dir: "desc" },
    cols: EQUIPE_COLUMNS,
  },
];

export const PER_PAGE_OPTIONS = [25, 50, 100, 250] as const;

/** Ties: value, then Ros%, then name. */
function tieBreak(a: FantraxRow, b: FantraxRow): number {
  const vx = a.value ?? Number.NEGATIVE_INFINITY;
  const vy = b.value ?? Number.NEGATIVE_INFINITY;
  if (vx !== vy) return vy - vx;
  const rx = a.ros ?? -1;
  const ry = b.ros ?? -1;
  if (rx !== ry) return ry - rx;
  return compareNames(FANTRAX_TABLE, a, b);
}

export const FANTRAX_TABLE: TableSpec<FantraxRow, FantraxFilters, FantraxCaps, FantraxCtx> = {
  id: "fantrax",
  rowKey: (r) => r.id,
  nameOf: (r) => r.name,
  columns: FANTRAX_COLUMNS,
  filterModel: FANTRAX_FILTERS,
  presets: FANTRAX_PRESETS,
  defaults: { filters: DEFAULT_FILTERS, sort: { key: "valeur", dir: "desc" }, cols: DEFAULT_COLUMNS },
  autoHide,
  fallbackSorts: ["valeur", "ros"],
  tieBreak,
  perPageOptions: PER_PAGE_OPTIONS,
};

/** Labels the data uses (their filters take no other value). */
export function fantraxLabels(
  rows: readonly FantraxRow[],
  dynasty: DynastyIndex | null,
  snake: SnakeIndex | null,
): Record<"phases" | "verdicts" | "trends" | "nhlTeams", readonly string[]> {
  return {
    phases: dynasty?.phases ?? [],
    verdicts: snake?.verdicts ?? [],
    trends: snake?.trends ?? [],
    nhlTeams: [...new Set(rows.map((r) => r.team).filter(Boolean))].sort(),
  };
}
