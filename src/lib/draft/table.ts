/**
 * A Yahoo categories league's player table (the unified PlayerTable's
 * category adapter, model side): the draft board's players valued for the
 * league (VOR, z per category), their draft marks as saved on this device
 * (the draft helper's store, read only), the odds they last to my next
 * pick, and Snake's verdicts. Filters (parse / serialize / test), columns,
 * presets and the tabs' views. No React, no DOM: unit-tested.
 *
 * Parity with the draft board is deliberate (and tested): the rank column
 * is `displayRank`, the position filter `matchesDraftFilter`, the search
 * `matchesDraftQuery`'s rule and the odds `probAvailableAt` at the same pick.
 */
import { SNAKE_TREND_ORDER, SNAKE_VERDICT_ORDER, VERDICT_POSITIVE, verdictRank } from "@/lib/fantrax/extras";
import type { LeagueCategory } from "@/lib/leagues/types";
import { compareNames } from "@/lib/player-table/model";
import { matchesQuery, searchHaystack } from "@/lib/player-table/search";
import { ANY_RANGE, type ColumnDef, type ExtraKind, type FilterModel, type PresetDef, type Range, type TableSpec } from "@/lib/player-table/types";
import { readRange, sameRange, writeRange } from "@/lib/player-table/url";
import type { SnakeNhlEntry } from "@/lib/snake/types";
import { probAvailableAt } from "./availability";
import { DRAFT_FILTERS, displayRank, matchesDraftFilter, type DraftFilter } from "./board-filter";
import { groupRelativeZ, isGoalieBoardPlayer, type DraftBoard, type DraftBoardPlayer } from "./board-types";
import { CATEGORY_FR, CATEGORY_SHORT, pickLabel } from "./draft-copy";
import { UNLISTED_PLAYER_ID, type DraftState } from "./draft-state";

export { VERDICT_POSITIVE };

// ------------------------------------------------------------ the draft's end

// Moved to a module of its own (the home page reads it); kept here for the table's callers.
export { DRAFT_DONE_AFTER_MS, draftDone } from "./draft-done";

/** The timeline fields the table reads (`draftTimeline` in ./suggestions). */
export interface CategoryTimeline {
  currentPick: number;
  targetPick: number | null;
  followingPick: number | null;
  onTheClock: boolean;
}

/**
 * The pick the odds are about, as on the draft board: on the clock, my
 * following pick; otherwise my next one. Null without a slot, in the last
 * round on the clock, and once the draft is over.
 */
export function oddsPickOf(t: CategoryTimeline, done: boolean): number | null {
  if (done) return null;
  return t.onTheClock ? t.followingPick : t.targetPick;
}

// ------------------------------------------------------------ rows

export interface CategorySnake {
  key: string;
  verdict: string;
  trend: string;
  probable: boolean;
}

/** A board player with his league facts for the table. */
export interface CategoryRow extends DraftBoardPlayer {
  /** Row key (the NHL id). */
  key: string;
  goalie: boolean;
  /** Folded "name team" for the search box. */
  search: string;
  /** z against his own group (forwards, defensemen or goalies): the bars. */
  zRel: number[];
  /** Marked on this device: overall pick number and whether it was mine. */
  pick: { number: number; mine: boolean } | null;
  /** Odds (0..1) he is still there at the odds pick; null when drafted or no odds. */
  available: number | null;
  snake: CategorySnake | null;
}

type BaseRow = Omit<CategoryRow, "pick" | "available" | "snake">;
const baseRowsCache = new WeakMap<DraftBoard, BaseRow[]>();

/** The parts of the rows that never change for a board (built once). */
function baseRows(board: DraftBoard): BaseRow[] {
  let rows = baseRowsCache.get(board);
  if (!rows) {
    rows = board.players.map((p) => ({
      ...p,
      key: String(p.id),
      goalie: isGoalieBoardPlayer(p),
      search: searchHaystack(p.name, p.team),
      zRel: groupRelativeZ(board, p),
    }));
    baseRowsCache.set(board, rows);
  }
  return rows;
}

export interface CategoryRowsInput {
  state: DraftState;
  currentPick: number;
  /** See `oddsPickOf`. */
  oddsPick: number | null;
  /** NHL-keyed verdicts (the page's seed and `snake/nhl.json`). */
  snake: Readonly<Record<string, SnakeNhlEntry>> | null;
}

export function buildCategoryRows(board: DraftBoard, input: CategoryRowsInput): CategoryRow[] {
  const picks = new Map<number, { number: number; mine: boolean }>();
  input.state.picks.forEach((p, i) => {
    if (p.id !== UNLISTED_PLAYER_ID) picks.set(p.id, { number: i + 1, mine: p.mine });
  });
  const { currentPick, oddsPick, snake } = input;
  return baseRows(board).map((r) => {
    const pick = picks.get(r.id) ?? null;
    const e = snake?.[r.key];
    return {
      ...r,
      pick,
      available: pick || oddsPick === null ? null : probAvailableAt(r, currentPick, oddsPick),
      snake: e ? { key: e[0], verdict: e[1], trend: e[2], probable: e[3] === 1 } : null,
    };
  });
}

// ------------------------------------------------------------ filters

export const CATEGORY_STATUSES = ["tous", "dispo", "pris", "moi"] as const;
export type CategoryStatus = (typeof CATEGORY_STATUSES)[number];

export interface CategoryFilters {
  q: string;
  /** One position (the draft board's filters: F = any forward). */
  pos: DraftFilter;
  status: CategoryStatus;
  adp: Range;
  age: Range;
  vor: Range;
  verdict: string;
  trend: string;
}

export const DEFAULT_CATEGORY_FILTERS: CategoryFilters = {
  q: "",
  pos: "ALL",
  status: "tous",
  adp: ANY_RANGE,
  age: ANY_RANGE,
  vor: ANY_RANGE,
  verdict: "",
  trend: "",
};

/** What the data on hand can show. */
export interface CategoryCaps {
  /** A slot is entered and the draft is on: odds at my next pick exist. */
  odds: boolean;
  /** The draft is over (every pick marked, or 12 h past the start). */
  done: boolean;
  /** Snake's verdicts are in. */
  snake: boolean;
}

/** What cells, headers and sorts need to know. */
export interface CategoryCtx {
  /** Ranks shown and sorted by this position ("ALL": overall); set per view. */
  rankPos: DraftFilter;
  done: boolean;
  /** The pick the odds are about. */
  oddsPick: number | null;
  skaterCategories: readonly LeagueCategory[];
  goalieCategories: readonly LeagueCategory[];
}

const inRange = (x: number | null | undefined, r: Range) =>
  (r.min === null && r.max === null) ||
  (x !== null && x !== undefined && (r.min === null || x >= r.min) && (r.max === null || x <= r.max));

/** Row test (every filter, the text query included). */
export function matchesCategoryFilters(r: CategoryRow, f: CategoryFilters): boolean {
  if (f.q && !matchesQuery(r.search, f.q)) return false;
  if (!matchesDraftFilter(r, f.pos)) return false;
  if (f.status === "dispo" && r.pick) return false;
  if (f.status === "pris" && !r.pick) return false;
  if (f.status === "moi" && !r.pick?.mine) return false;
  if (!inRange(r.adp, f.adp) || !inRange(r.age, f.age) || !inRange(r.vor, f.vor)) return false;
  if (f.verdict) {
    if (f.verdict === VERDICT_POSITIVE) {
      const rank = verdictRank(r.snake?.verdict);
      if (rank === null || rank > 1) return false;
    } else if (r.snake?.verdict !== f.verdict) return false;
  }
  if (f.trend && r.snake?.trend !== f.trend) return false;
  return true;
}

const RANGE_PARAMS = { adp: "adp", age: "age", vor: "vor" } as const satisfies Record<string, keyof CategoryFilters>;
const MAX_TEXT = 60;
const cleanText = (s: string) => s.slice(0, MAX_TEXT);
const POSITIONS = DRAFT_FILTERS.filter((f) => f !== "ALL");

/** `pos` param: one position, `tous` for all. */
function readPos(s: string): DraftFilter | null {
  const up = s.trim().toUpperCase();
  if (up === "TOUS" || up === "ALL" || up === "") return "ALL";
  return (POSITIONS as readonly string[]).includes(up) ? (up as DraftFilter) : null;
}

function activeCount(f: CategoryFilters, base: CategoryFilters): number {
  let n = 0;
  if (f.q.trim() !== base.q.trim()) n++;
  if (f.pos !== base.pos) n++;
  if (f.status !== base.status) n++;
  for (const k of Object.values(RANGE_PARAMS)) if (!sameRange(f[k], base[k])) n++;
  if (f.verdict !== base.verdict) n++;
  if (f.trend !== base.trend) n++;
  return n;
}

export const CATEGORY_FILTERS: FilterModel<CategoryFilters, CategoryRow, CategoryCaps, CategoryCtx> = {
  params: ["q", "pos", "statut", "adp", "age", "vor", "verdict", "tendance"],
  parse(params, base) {
    const f: CategoryFilters = { ...base };
    const q = params.get("q");
    if (q !== null) f.q = cleanText(q);
    const pos = params.get("pos");
    if (pos !== null) f.pos = readPos(pos) ?? base.pos;
    const status = params.get("statut");
    if ((CATEGORY_STATUSES as readonly (string | null)[]).includes(status)) f.status = status as CategoryStatus;
    for (const [param, key] of Object.entries(RANGE_PARAMS)) f[key] = readRange(params, param, base[key]);
    const verdict = params.get("verdict");
    if (verdict !== null) f.verdict = cleanText(verdict);
    const trend = params.get("tendance");
    if (trend !== null) f.trend = cleanText(trend);
    return f;
  },
  serialize(f, base) {
    const out: Array<[string, string]> = [];
    if (f.q.trim() !== base.q.trim()) out.push(["q", f.q.trim().slice(0, MAX_TEXT)]);
    if (f.pos !== base.pos) out.push(["pos", f.pos === "ALL" ? "tous" : f.pos]);
    if (f.status !== base.status) out.push(["statut", f.status]);
    for (const [param, key] of Object.entries(RANGE_PARAMS)) writeRange(out, param, f[key], base[key]);
    if (f.verdict !== base.verdict) out.push(["verdict", f.verdict]);
    if (f.trend !== base.trend) out.push(["tendance", f.trend]);
    return out;
  },
  normalize(f, { caps, labels }) {
    return {
      ...f,
      verdict:
        caps.snake && (f.verdict === VERDICT_POSITIVE || (labels.verdicts ?? []).includes(f.verdict)) ? f.verdict : "",
      trend: caps.snake && (labels.trends ?? []).includes(f.trend) ? f.trend : "",
    };
  },
  test: (r, f) => matchesCategoryFilters(r, f),
  activeCount,
  readsExtras(f): ExtraKind[] {
    return f.verdict || f.trend ? ["snake"] : [];
  },
  query: (f) => f.q,
  withQuery: (f, q) => ({ ...f, q }),
  equal: (a, b) => activeCount(a, b) === 0,
};

// ------------------------------------------------------------ columns

/** URL key of a category's column: `z-sog`, `z-sv`, `z-gaa`. */
export function categoryColumnKey(c: LeagueCategory): string {
  return `z-${CATEGORY_SHORT[c].toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

type Col = ColumnDef<CategoryRow, CategoryCaps, CategoryCtx>;

const GROUP = {
  rank: "Classement",
  cats: "Catégories",
  draft: "Repêchage",
  profile: "Profil",
  snake: "Snake",
} as const;

const POS_NAME: Record<Exclude<DraftFilter, "ALL">, string> = {
  C: "centre",
  LW: "ailier gauche",
  RW: "ailier droit",
  F: "attaquant",
  D: "défenseur",
  G: "gardien",
};

/** The category a row's `proj` / `z` index (skater or goalie line), or -1. */
function catIndex(board: DraftBoard, r: Pick<CategoryRow, "goalie">, c: LeagueCategory): number {
  return ((r.goalie ? board.categories.goalie : board.categories.skater) as readonly LeagueCategory[]).indexOf(c);
}

/** Every category of the league: skaters', then goalies'. */
export function boardCategories(board: DraftBoard): LeagueCategory[] {
  return [...board.categories.skater, ...board.categories.goalie];
}

/** The projected stat and z of a row in a category (null when not his line). */
export function categoryCell(board: DraftBoard, r: CategoryRow, c: LeagueCategory): { proj: number; z: number } | null {
  const i = catIndex(board, r, c);
  return i < 0 ? null : { proj: r.proj[i] ?? 0, z: r.z[i] ?? 0 };
}

function columns(board: DraftBoard): Col[] {
  const cats = boardCategories(board);
  const z: Col[] = cats.map((c) => ({
    key: categoryColumnKey(c),
    label: CATEGORY_SHORT[c],
    title: `${CATEGORY_FR[c]} : projection de la saison (couleur et tri selon la cote z dans la ligue)`,
    align: "right",
    group: GROUP.cats,
    sort: { value: (r) => categoryCell(board, r, c)?.z ?? null, defaultDir: "desc", label: `${CATEGORY_SHORT[c]} (cote z)` },
  }));
  return [
    {
      key: "rang",
      label: (ctx) => (ctx.rankPos === "ALL" ? "Rang" : `Rang ${ctx.rankPos}`),
      title: (ctx) =>
        ctx.rankPos === "ALL"
          ? "Rang dans la ligue selon la VOR"
          : `Rang parmi les joueurs admissibles au poste ${ctx.rankPos} (${POS_NAME[ctx.rankPos]}), selon la VOR à ce poste`,
      align: "right",
      group: GROUP.rank,
      sort: { value: (r, ctx) => displayRank(r, ctx.rankPos), defaultDir: "asc", label: "Rang" },
    },
    {
      key: "vor",
      label: "VOR",
      title: "VOR : valeur au-dessus du remplaçant (sa valeur moins celle du meilleur joueur laissé au ballottage à son meilleur poste)",
      align: "right",
      group: GROUP.rank,
      sort: { value: (r) => r.vor, defaultDir: "desc" },
    },
    {
      key: "valeur",
      label: "Valeur",
      title: "Valeur : somme de ses cotes z dans les catégories de la ligue (gardiens pondérés)",
      align: "right",
      group: GROUP.rank,
      sort: { value: (r) => r.value, defaultDir: "desc" },
    },
    {
      key: "cats",
      label: "Catégories",
      title: "Écart avec ses pairs (attaquants, défenseurs ou gardiens) dans chaque catégorie, en cotes z",
      align: "left",
      group: GROUP.cats,
    },
    ...z,
    {
      key: "adp",
      label: "ADP",
      title: "ADP : rang moyen de sélection (repêchages Fantrax, un proxy du marché)",
      align: "right",
      group: GROUP.draft,
      sort: { value: (r) => r.adp, defaultDir: "asc" },
    },
    {
      key: "dispo",
      label: (ctx) => (ctx.oddsPick !== null ? `Dispo. au ${pickLabel(ctx.oddsPick)}` : "Dispo."),
      title: (ctx) =>
        `Chance qu’il soit encore disponible à votre ${ctx.oddsPick !== null ? pickLabel(ctx.oddsPick) : "prochain choix"} (d’après l’ADP, approximatif)`,
      align: "right",
      group: GROUP.draft,
      sort: { value: (r) => r.available, defaultDir: "desc", label: "Disponibilité à mon prochain choix" },
      needs: (c) => c.odds,
      mobileUnderName: true,
    },
    {
      key: "statut",
      label: "Statut",
      title: "Disponible, repêché (à quel choix) ou votre choix, d’après les choix marqués sur cet appareil",
      align: "left",
      group: GROUP.draft,
      sort: { value: (r) => r.pick?.number ?? null, defaultDir: "asc", label: "Choix au repêchage" },
    },
    {
      key: "gp",
      label: "PJ",
      title: "Matchs joués projetés",
      align: "right",
      group: GROUP.profile,
      sort: { value: (r) => r.gp, defaultDir: "desc" },
    },
    {
      key: "age",
      label: "Âge",
      title: "Âge au 1er octobre",
      align: "right",
      group: GROUP.profile,
      sort: { value: (r) => r.age, defaultDir: "asc" },
    },
    {
      key: "verdict",
      label: "Snake",
      title: "Verdict de Simon « Snake » Boisvert",
      align: "left",
      group: GROUP.snake,
      // Higher = more positive, so « desc » puts « très positif » first.
      sort: {
        value: (r) => {
          const rank = verdictRank(r.snake?.verdict);
          return rank === null ? null : -rank;
        },
        defaultDir: "desc",
        label: "Verdict de Snake",
      },
      needs: (c) => c.snake,
      readsExtras: "snake",
    },
    {
      key: "tendance",
      label: "Tendance",
      title: "Tendance de l’opinion de Snake",
      align: "left",
      group: GROUP.snake,
      needs: (c) => c.snake,
    },
  ];
}

/**
 * Default columns that step aside for a view: « Statut » when only
 * available players show, the odds when only drafted ones do.
 */
function autoHide(f: CategoryFilters): string[] {
  if (f.status === "dispo") return ["statut"];
  if (f.status === "pris" || f.status === "moi") return ["dispo"];
  return [];
}

// ------------------------------------------------------------ presets

export type CategoryPresetId = "tous" | "disponibles" | "equipe";

const TOUS_COLUMNS = ["rang", "vor", "cats", "adp", "age", "statut", "verdict"];
const DISPO_COLUMNS = ["rang", "vor", "cats", "adp", "dispo", "verdict"];
const EQUIPE_COLUMNS = ["rang", "vor", "cats", "statut", "verdict"];

export const CATEGORY_PRESETS: readonly PresetDef<CategoryFilters, CategoryCaps>[] = [
  {
    id: "tous",
    label: "Tous les joueurs",
    description: "Les joueurs de la liste du repêchage, par rang (VOR).",
    filters: {},
    sort: { key: "rang", dir: "asc" },
    cols: TOUS_COLUMNS,
  },
  {
    id: "disponibles",
    label: (caps) => (caps.done ? "Non repêchés" : "Meilleurs disponibles"),
    description: (caps) =>
      caps.done
        ? "Les joueurs que personne n’a repêchés (d’après les choix marqués sur cet appareil)."
        : "Les joueurs pas encore repêchés, par rang, avec leurs chances d’être là à votre prochain choix.",
    filters: { status: "dispo" },
    sort: { key: "rang", dir: "asc" },
    cols: DISPO_COLUMNS,
  },
  {
    id: "equipe",
    label: "Mon équipe",
    description: "Les joueurs marqués « Mon choix » dans l’onglet Repêchage.",
    filters: { status: "moi" },
    sort: { key: "rang", dir: "asc" },
    cols: EQUIPE_COLUMNS,
  },
];

export const CATEGORY_PER_PAGE = [25, 50, 100, 250] as const;

// One context object per (data context, position): memoized rows stay put while typing.
const viewCtxCache = new WeakMap<CategoryCtx, Map<DraftFilter, CategoryCtx>>();
function viewCtx(ctx: CategoryCtx, f: CategoryFilters): CategoryCtx {
  if (ctx.rankPos === f.pos) return ctx;
  let byPos = viewCtxCache.get(ctx);
  if (!byPos) {
    byPos = new Map();
    viewCtxCache.set(ctx, byPos);
  }
  let out = byPos.get(f.pos);
  if (!out) {
    out = { ...ctx, rankPos: f.pos };
    byPos.set(f.pos, out);
  }
  return out;
}

const specCache = new WeakMap<DraftBoard, TableSpec<CategoryRow, CategoryFilters, CategoryCaps, CategoryCtx>>();

/** The table of a categories league's board (its category columns follow the league). */
export function categoryTable(board: DraftBoard): TableSpec<CategoryRow, CategoryFilters, CategoryCaps, CategoryCtx> {
  let spec = specCache.get(board);
  if (!spec) {
    const s: TableSpec<CategoryRow, CategoryFilters, CategoryCaps, CategoryCtx> = {
      id: "categorie",
      rowKey: (r) => r.key,
      nameOf: (r) => r.name,
      columns: columns(board),
      filterModel: CATEGORY_FILTERS,
      presets: CATEGORY_PRESETS,
      defaults: { filters: DEFAULT_CATEGORY_FILTERS, sort: { key: "rang", dir: "asc" }, cols: TOUS_COLUMNS },
      autoHide,
      fallbackSorts: ["rang", "vor"],
      // Ties: overall rank, then name.
      tieBreak: (a, b) => a.rank - b.rank || compareNames(s, a, b),
      perPageOptions: CATEGORY_PER_PAGE,
      viewCtx,
    };
    spec = s;
    specCache.set(board, spec);
  }
  return spec;
}

/** Verdict and trend labels the rows use (their filters take no other value). */
export function categoryLabels(snake: Readonly<Record<string, SnakeNhlEntry>> | null): Record<"verdicts" | "trends", readonly string[]> {
  const verdicts = new Set<string>();
  const trends = new Set<string>();
  for (const e of Object.values(snake ?? {})) {
    verdicts.add(e[1]);
    trends.add(e[2]);
  }
  const ordered = (set: Set<string>, order: readonly string[]) => [
    ...order.filter((x) => set.has(x)),
    ...[...set].filter((x) => !order.includes(x)).sort(),
  ];
  return { verdicts: ordered(verdicts, SNAKE_VERDICT_ORDER), trends: ordered(trends, SNAKE_TREND_ORDER) };
}

/** « Disponible » / « Repêché (n° 14) » / « Mon choix (n° 27) »; « Non repêché » once the draft is over. */
export function categoryStatusText(r: Pick<CategoryRow, "pick">, done: boolean): string {
  if (!r.pick) return done ? "Non repêché" : "Disponible";
  return `${r.pick.mine ? "Mon choix" : "Repêché"} (${pickLabel(r.pick.number)})`;
}
