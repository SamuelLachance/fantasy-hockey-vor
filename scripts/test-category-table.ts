/**
 * Unit checks for a Yahoo categories league's player table (the category
 * adapter's model): rows from the committed Light the Lamp board and
 * synthetic draft states (statuses, odds at my next pick with the draft
 * board's on-the-clock rule, Snake), parity with the draft board (rank =
 * `displayRank` under each position, position filter = `matchesDraftFilter`,
 * search = `matchesDraftQuery`), one column per league category, the
 * draft's end (by count and by time) and its labels, the URL (diff from
 * the tab's base, off tokens), presets and speed.
 * Run: npx tsx scripts/test-category-table.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { probAvailableAt } from "../src/lib/draft/availability";
import { DRAFT_FILTERS, displayRank, draftRows, matchesDraftFilter, matchesDraftQuery } from "../src/lib/draft/board-filter";
import type { DraftBoard } from "../src/lib/draft/board-types";
import { CATEGORY_SHORT } from "../src/lib/draft/draft-copy";
import { EMPTY_DRAFT_STATE, markPick, setDraftSlot, UNLISTED_PLAYER_ID, type DraftState } from "../src/lib/draft/draft-state";
import { draftTimeline } from "../src/lib/draft/suggestions";
import {
  boardCategories,
  buildCategoryRows,
  CATEGORY_FILTERS,
  categoryColumnKey,
  categoryLabels,
  categoryStatusText,
  categoryTable,
  DEFAULT_CATEGORY_FILTERS,
  DRAFT_DONE_AFTER_MS,
  draftDone,
  oddsPickOf,
  type CategoryCaps,
  type CategoryCtx,
  type CategoryFilters,
  type CategoryRow,
} from "../src/lib/draft/table";
import {
  effectiveView,
  filterRows,
  resolvePreset,
  sortRows,
  tableBase,
  viewContext,
  visibleColumns,
} from "../src/lib/player-table/model";
import { NAME_SORT } from "../src/lib/player-table/types";
import { parseView, viewParams, viewSearch } from "../src/lib/player-table/url";
import type { SnakeNhlFile } from "../src/lib/snake/types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const eq = (a: unknown, b: unknown, msg: string) =>
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const NB = String.fromCharCode(0xa0);

const board = JSON.parse(
  readFileSync(join(process.cwd(), "public", "leagues", "light-the-lamp", "board.json"), "utf8"),
) as DraftBoard;
const spec = categoryTable(board);
const { teams, rounds } = board.league;
const P = board.players;

// ------------------------------------------------------------ synthetic draft states

/** Picks 1..n marked, mine at the given overall pick numbers. */
function marked(n: number, slot: number | null, mineAt: readonly number[] = []): DraftState {
  let s: DraftState = setDraftSlot(EMPTY_DRAFT_STATE, slot, teams);
  for (let i = 0; i < n; i++) s = markPick(s, P[i]!.id, mineAt.includes(i + 1));
  return s;
}

function rowsFor(state: DraftState, done = false, snake: SnakeNhlFile["rows"] | null = null): CategoryRow[] {
  const t = draftTimeline(board, state);
  return buildCategoryRows(board, { state, currentPick: t.currentPick, oddsPick: oddsPickOf(t, done), snake });
}

function ctxFor(state: DraftState, done = false): CategoryCtx {
  const t = draftTimeline(board, state);
  return {
    rankPos: "ALL",
    done,
    oddsPick: oddsPickOf(t, done),
    skaterCategories: board.categories.skater,
    goalieCategories: board.categories.goalie,
  };
}

// ------------------------------------------------------------ rows and statuses

{
  const empty = rowsFor(EMPTY_DRAFT_STATE);
  eq(empty.length, P.length, "one row per board player");
  eq(empty.map((r) => r.key), P.map((p) => String(p.id)), "row keys = NHL ids, board order");
  assert(empty.every((r) => r.pick === null && r.available === null), "no slot: nobody drafted, no odds");
  assert(buildCategoryRows(board, { state: EMPTY_DRAFT_STATE, currentPick: 1, oddsPick: null, snake: null })[0] !== empty[0], "fresh row objects per build");

  // Slot 5, three picks marked (the 3rd one mine is a mismatch the helper warns about; rows just follow).
  let s = marked(3, 5, [3]);
  s = markPick(s, UNLISTED_PLAYER_ID, false);
  const rows = rowsFor(s);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  eq(byKey.get(String(P[0]!.id))!.pick, { number: 1, mine: false }, "pick 1 marked");
  eq(byKey.get(String(P[2]!.id))!.pick, { number: 3, mine: true }, "pick 3 mine");
  eq(byKey.get(String(P[4]!.id))!.pick, null, "unmarked player available");
  eq(categoryStatusText(byKey.get(String(P[0]!.id))!, false), `Repêché (n°${NB}1)`, "drafted label");
  eq(categoryStatusText(byKey.get(String(P[2]!.id))!, false), `Mon choix (n°${NB}3)`, "mine label");
  eq(categoryStatusText(byKey.get(String(P[4]!.id))!, false), "Disponible", "available label");
  eq(categoryStatusText(byKey.get(String(P[4]!.id))!, true), "Non repêché", "post-draft label");
  eq(categoryStatusText(byKey.get(String(P[0]!.id))!, true), `Repêché (n°${NB}1)`, "post-draft drafted label unchanged");

  // Odds: as on the draft board (the unlisted pick counts: current pick 5 = my slot's first pick → on the clock).
  const t = draftTimeline(board, s);
  assert(t.onTheClock && t.currentPick === 5, "slot 5 is on the clock at pick 5");
  const pick = oddsPickOf(t, false);
  eq(pick, t.followingPick, "on the clock: odds at my following pick");
  const helperRows = draftRows(P, s, { filter: "ALL", query: "", showDrafted: true });
  for (const hr of helperRows) {
    const r = byKey.get(String(hr.player.id))!;
    const want = hr.pickNumber != null || pick == null ? null : probAvailableAt(hr.player, t.currentPick, pick);
    if (r.available !== want) {
      assert(false, `odds of ${hr.player.name} = the draft board's`);
      break;
    }
  }
  const off = marked(6, 5);
  const t2 = draftTimeline(board, off);
  assert(!t2.onTheClock, "pick 7 is not slot 5's");
  eq(oddsPickOf(t2, false), t2.targetPick, "off the clock: odds at my next pick");
  eq(oddsPickOf(t2, true), null, "no odds once the draft is over");
  assert(rowsFor(off, true).every((r) => r.available === null), "no odds rows once over");
}

// ------------------------------------------------------------ the draft's end

{
  const start = Date.parse(board.league.draftStartsAt);
  assert(!draftDone(board.league, EMPTY_DRAFT_STATE, null), "not over without a clock");
  assert(!draftDone(board.league, EMPTY_DRAFT_STATE, start + DRAFT_DONE_AFTER_MS), "not over at exactly +12 h");
  assert(draftDone(board.league, EMPTY_DRAFT_STATE, start + DRAFT_DONE_AFTER_MS + 1), "over past +12 h");
  const all: DraftState = { v: 1, slot: 3, picks: Array.from({ length: teams * rounds }, (_, i) => ({ id: i < P.length ? P[i]!.id : 0, mine: false })) };
  assert(draftDone(board.league, all, null), "over once every pick is marked");
  assert(!draftDone(board.league, { ...all, picks: all.picks.slice(1) }, start), "one pick short, during the draft");
}

// ------------------------------------------------------------ parity with the draft board

{
  const rows = rowsFor(EMPTY_DRAFT_STATE);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const pos of DRAFT_FILTERS) {
    const f: CategoryFilters = { ...DEFAULT_CATEGORY_FILTERS, pos };
    const ctx = viewContext(spec, ctxFor(EMPTY_DRAFT_STATE), f);
    eq(ctx.rankPos, pos, `view context ranks by ${pos}`);
    const shown = filterRows(spec, rows, f, ctx);
    eq(shown.map((r) => r.id), P.filter((p) => matchesDraftFilter(p, pos)).map((p) => p.id), `position ${pos} = the draft board's filter`);
    const rangCol = spec.columns.find((c) => c.key === "rang")!;
    const bad = shown.find((r) => rangCol.sort!.value(r, ctx) !== displayRank(P.find((p) => p.id === r.id)!, pos));
    assert(!bad, `rank under ${pos} = displayRank (${bad?.name ?? "ok"})`);
    // Sorted by rank under a position: the position rank's order.
    const sorted = sortRows(spec, shown, { key: "rang", dir: "asc" }, ctx);
    const ranks = sorted.map((r) => displayRank(r, pos));
    assert(ranks.every((x, i) => i === 0 || ranks[i - 1]! <= x), `rank sort under ${pos} is by position rank`);
  }
  // The context object is reused (memoized rows stay put while typing).
  const base = ctxFor(EMPTY_DRAFT_STATE);
  const c1 = viewContext(spec, base, { ...DEFAULT_CATEGORY_FILTERS, pos: "D", q: "a" });
  const c2 = viewContext(spec, base, { ...DEFAULT_CATEGORY_FILTERS, pos: "D", q: "ab" });
  assert(c1 === c2, "same view context for the same position");
  assert(viewContext(spec, base, DEFAULT_CATEGORY_FILTERS) === base, "all positions: the data's context");

  const queries = [
    "jt miller", "oreilly", "o reilly", "mcdavid", "k andre", "larsson", "mtl", "tor", "côté", "st louis",
    "pierre-luc", "suzuki", "nick suz", "caufield", "hughes", "tkachuk", "draisaitl", "makar", "hellebuyck",
    "vasilevskiy", "shesterkin", "kaprizov", "matthews", "marner", "nylander", "pastrnak", "crosby", "malkin",
    "ovechkin", "kucherov", "a", "de", "mac", "van", "nyr bo", "-", ".",
  ];
  for (const q of queries) {
    const shown = filterRows(spec, rows, { ...DEFAULT_CATEGORY_FILTERS, q }, base).map((r) => r.id);
    const want = P.filter((p) => matchesDraftQuery(p, q)).map((p) => p.id);
    eq(shown, want, `search « ${q} » = the draft board's`);
  }
  assert(byKey.size === P.length, "keys unique");
}

// ------------------------------------------------------------ columns

{
  const cats = boardCategories(board);
  const keys = spec.columns.map((c) => c.key);
  eq(
    cats.map(categoryColumnKey),
    ["z-g", "z-a", "z-ppp", "z-sog", "z-hit", "z-blk", "z-w", "z-gaa", "z-sv", "z-sho"],
    "one column per league category (Yahoo codes)",
  );
  assert(cats.every((c) => keys.includes(categoryColumnKey(c))), "category columns in the spec");
  assert(keys.every((k) => !k.includes(":") && /^[a-z0-9-]+$/.test(k)), "URL-stable column keys");
  eq(cats.map((c) => CATEGORY_SHORT[c]), ["G", "A", "PPP", "SOG", "HIT", "BLK", "W", "GAA", "SV%", "SHO"], "labels are Yahoo's codes");
  // A category column sorts skaters by their z; goalies have none (last).
  const rows = rowsFor(EMPTY_DRAFT_STATE);
  const sog = sortRows(spec, rows, { key: "z-sog", dir: "desc" }, ctxFor(EMPTY_DRAFT_STATE));
  const si = board.categories.skater.indexOf("shots");
  const zs = sog.filter((r) => !r.goalie).map((r) => r.z[si]!);
  assert(zs.every((z, i) => i === 0 || zs[i - 1]! >= z), "z-sog sorts by shots z");
  assert(sog.slice(-5).every((r) => r.goalie), "goalies last on a skater category");
  const gi = board.categories.goalie.indexOf("savePct");
  const sv = sortRows(spec, rows, { key: "z-sv", dir: "desc" }, ctxFor(EMPTY_DRAFT_STATE)).filter((r) => r.goalie);
  assert(sv.length > 0 && sv.every((r, i) => i === 0 || sv[i - 1]!.z[gi]! >= r.z[gi]!), "z-sv sorts goalies by SV% z");

  // « Dispo. » needs a slot and a draft still on.
  const env = (state: DraftState, done: boolean) => {
    const ctx = ctxFor(state, done);
    const caps: CategoryCaps = { odds: ctx.oddsPick !== null, done, snake: true };
    return { caps, labels: { verdicts: [], trends: [] }, ctx };
  };
  const dispoBase = tableBase(spec, "disponibles", env(EMPTY_DRAFT_STATE, false).caps, 50);
  const view = parseView(spec, "", dispoBase);
  assert(!effectiveView(spec, view, dispoBase, env(EMPTY_DRAFT_STATE, false)).columns.includes("dispo"), "no slot: no odds column");
  assert(effectiveView(spec, view, dispoBase, env(marked(2, 5), false)).columns.includes("dispo"), "slot entered: odds column");
  assert(!effectiveView(spec, view, dispoBase, env(marked(2, 5), true)).columns.includes("dispo"), "draft over: no odds column");
  assert(!effectiveView(spec, view, dispoBase, env(marked(2, 5), false)).columns.includes("statut"), "available view hides « Statut »");
  const withSort = parseView(spec, "?tri=dispo", dispoBase);
  eq(effectiveView(spec, withSort, dispoBase, env(EMPTY_DRAFT_STATE, false)).sort, { key: "rang", dir: "asc" }, "a sort on missing odds falls back to rank");
  eq(
    visibleColumns(spec, { filters: { ...DEFAULT_CATEGORY_FILTERS, status: "moi" }, cols: null }, { cols: ["rang", "dispo", "statut"] }, env(marked(2, 5), false).caps),
    ["rang", "statut"],
    "my picks: no odds column",
  );
}

// ------------------------------------------------------------ presets and labels

{
  const caps = (done: boolean): CategoryCaps => ({ odds: !done, done, snake: true });
  const label = (id: string, done: boolean) => resolvePreset(spec, spec.presets.find((p) => p.id === id)!, caps(done)).label;
  eq(label("disponibles", false), "Meilleurs disponibles", "available chip (same words as the Captains table)");
  eq(label("disponibles", true), "Non repêchés", "post-draft chip");
  eq(spec.presets.map((p) => p.id), ["tous", "disponibles", "equipe"], "presets");
  const tous = tableBase(spec, "tous", caps(false), 50);
  eq(tous.sort, { key: "rang", dir: "asc" }, "Joueurs: by rank");
  eq(tous.cols, ["rang", "vor", "cats", "adp", "age", "statut", "verdict"], "Joueurs: default columns");
  const s = marked(30, 5, [5, 20]);
  const rows = rowsFor(s);
  const mine = filterRows(spec, rows, tableBase(spec, "equipe", caps(false), 50).filters, ctxFor(s));
  eq(mine.map((r) => r.pick?.number), [5, 20], "« Mon équipe » = my marked picks");
  eq(filterRows(spec, rows, { ...DEFAULT_CATEGORY_FILTERS, status: "pris" }, ctxFor(s)).length, 30, "drafted = every marked listed pick");
  eq(filterRows(spec, rows, { ...DEFAULT_CATEGORY_FILTERS, status: "dispo" }, ctxFor(s)).length, P.length - 30, "available = the rest");
}

// ------------------------------------------------------------ Snake

{
  const snake: SnakeNhlFile["rows"] = {
    [String(P[0]!.id)]: ["nhl:1", "très positif", "en hausse", 0],
    [String(P[1]!.id)]: ["nhl:2", "positif", "stable", 1],
    [String(P[2]!.id)]: ["nhl:3", "négatif", "en baisse", 0],
  };
  const rows = rowsFor(EMPTY_DRAFT_STATE, false, snake);
  eq(rows[1]!.snake, { key: "nhl:2", verdict: "positif", trend: "stable", probable: true }, "Snake record on the row");
  eq(rows[5]!.snake, null, "no record: null");
  eq(categoryLabels(snake), { verdicts: ["très positif", "positif", "négatif"], trends: ["en hausse", "stable", "en baisse"] }, "labels in Snake's order");
  const ctx = ctxFor(EMPTY_DRAFT_STATE);
  eq(filterRows(spec, rows, { ...DEFAULT_CATEGORY_FILTERS, verdict: "positif+" }, ctx).length, 2, "« positif ou mieux »");
  eq(filterRows(spec, rows, { ...DEFAULT_CATEGORY_FILTERS, trend: "en baisse" }, ctx).length, 1, "trend filter");
  const env = { caps: { odds: false, done: false, snake: false }, labels: categoryLabels(snake), ctx };
  eq(CATEGORY_FILTERS.normalize({ ...DEFAULT_CATEGORY_FILTERS, verdict: "positif" }, env).verdict, "", "no Snake data: verdict filter off");
  eq(
    CATEGORY_FILTERS.normalize({ ...DEFAULT_CATEGORY_FILTERS, verdict: "inventé" }, { ...env, caps: { ...env.caps, snake: true } }).verdict,
    "",
    "unknown verdict ignored",
  );
  const sorted = sortRows(spec, rows, { key: "verdict", dir: "desc" }, ctx);
  eq(sorted.slice(0, 3).map((r) => r.snake?.verdict), ["très positif", "positif", "négatif"], "verdict sort: most positive first, then the rest");
}

// ------------------------------------------------------------ URL

{
  const caps: CategoryCaps = { odds: true, done: false, snake: true };
  const tous = tableBase(spec, "tous", caps, 50);
  const dispo = tableBase(spec, "disponibles", caps, 25);
  eq(viewParams(spec, parseView(spec, "", tous), tous), [], "clean URL = the tab's view");
  const v = parseView(spec, "?pos=d&statut=dispo&vor=1-&verdict=positif%2B&tri=z-hit&q=Côté", tous);
  eq(
    [v.filters.pos, v.filters.status, v.filters.vor, v.filters.verdict, v.sort, v.filters.q],
    ["D", "dispo", { min: 1, max: null }, "positif+", { key: "z-hit", dir: "desc" }, "Côté"],
    "parse",
  );
  const round = parseView(spec, viewSearch(spec, v, tous, "?team=x"), tous);
  eq(round, v, "round trip");
  assert(viewSearch(spec, v, tous, "?team=x").startsWith("?team=x&"), "foreign params kept first");
  // Off tokens against a base that turns things on.
  const all = parseView(spec, "?statut=tous", dispo);
  eq(all.filters.status, "tous", "statut=tous turns the base's status off");
  eq(viewParams(spec, all, dispo), [["statut", "tous"]], "…and is written back");
  eq(parseView(spec, "?pos=tous", { ...tous, filters: { ...tous.filters, pos: "C" } }).filters.pos, "ALL", "pos=tous");
  eq(parseView(spec, "?pos=X&statut=nope&vor=abc", tous).filters, tous.filters, "garbage ignored");
  eq(parseView(spec, "?par=25", tous).perPage, 25, "page size");
  eq(parseView(spec, "?tri=rang&ordre=desc", tous).sort, { key: "rang", dir: "desc" }, "rank order flipped");
  eq(parseView(spec, "?tri=inconnu", tous).sort, tous.sort, "unknown sort ignored");
  eq(parseView(spec, "?cols=rang,z-sog,xyz", tous).cols, ["rang", "z-sog"], "unknown columns dropped");
  // The Fantrax table's bookmark params that mean nothing here are left alone.
  eq(parseView(spec, "?type=espoirs&lnh=MTL", tous).filters, tous.filters, "other leagues' params ignored");
  assert(!CATEGORY_FILTERS.params.includes("team"), "team param not owned");
  eq(NAME_SORT, "nom", "name sort key");
}

// ------------------------------------------------------------ speed

{
  const s = marked(120, 7, [7, 18, 31]);
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) rowsFor(s, false, null);
  const per = (performance.now() - t0) / 10;
  assert(per <= 50, `buildCategoryRows (${P.length}) in ${per.toFixed(1)} ms ≤ 50`);
  const rows = rowsFor(s);
  const ctx = ctxFor(s);
  const t1 = performance.now();
  for (let i = 0; i < 20; i++) {
    sortRows(spec, filterRows(spec, rows, { ...DEFAULT_CATEGORY_FILTERS, q: "ma", pos: "F" }, ctx), { key: "z-sog", dir: "desc" }, ctx);
  }
  assert((performance.now() - t1) / 20 <= 20, "filter + sort ≤ 20 ms");
}

if (failed) {
  console.error(`\n${failed} category-table check(s) failed`);
  process.exit(1);
}
console.log("OK: category table (rows, odds, draft end, board parity, columns, presets, Snake, URL, speed)");
