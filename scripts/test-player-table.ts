/**
 * Unit checks for the unified player table's generic model, on a synthetic
 * spec: sorts (nulls last both ways, stable ties, tie-break), pages, the
 * effective view's fallbacks, auto-hidden columns, presets, the URL (diff
 * from the tab's base, explicit off tokens, foreign params kept, garbage
 * ignored, `vue` / `joueur`), the shared search rule (same results as the
 * Yahoo draft board's) and the name highlight.
 * Run: npx tsx scripts/test-player-table.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { DraftBoard } from "../src/lib/draft/board-types";
import { matchesDraftQuery } from "../src/lib/draft/board-filter";
import { counterText, detailsToggleLabel, fmtInt, resultsText, sortButtonLabel, sortSummary } from "../src/lib/player-table/copy";
import { HIGHLIGHT_QUERY_MAX, highlightMatch } from "../src/lib/player-table/highlight";
import {
  applyPreset,
  atBase,
  baseView,
  clampPage,
  compareNames,
  effectiveView,
  filterRows,
  findPreset,
  matchesPreset,
  nextSort,
  pageCount,
  resetView,
  sortLabel,
  sortRows,
  tableBase,
  viewReadsExtras,
  visibleColumns,
} from "../src/lib/player-table/model";
import { foldForSearch, matchesQuery, queryWords, searchHaystack } from "../src/lib/player-table/search";
import { ANY_RANGE, NAME_SORT, type FilterModel, type Range, type TableSpec, type TableView } from "../src/lib/player-table/types";
import {
  decodeRange,
  encodeRange,
  focusFromSearch,
  hasPendingParams,
  hasViewParams,
  ownedParams,
  parseView,
  presetFromSearch,
  readRange,
  sameViewSearch,
  viewParams,
  viewSearch,
  writeRange,
} from "../src/lib/player-table/url";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const eq = (a: unknown, b: unknown, msg: string) =>
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const NB = " ";

// ------------------------------------------------------------ a synthetic spec

interface Row {
  id: string;
  name: string;
  team: string;
  hay: string;
  pts: number | null;
  age: number | null;
  extra: number | null;
  mine: boolean;
}
interface F {
  q: string;
  pos: string;
  mine: boolean;
  age: Range;
}
interface Caps {
  extra: boolean;
}
interface Ctx {
  label: string;
}

const DEF: F = { q: "", pos: "", mine: false, age: ANY_RANGE };

const FILTERS: FilterModel<F, Row, Caps, Ctx> = {
  params: ["q", "pos", "moi", "age"],
  parse(p, base) {
    const f = { ...base };
    const q = p.get("q");
    if (q !== null) f.q = q.slice(0, 60);
    const pos = p.get("pos");
    if (pos !== null && /^[A-Z]{0,2}$/.test(pos)) f.pos = pos;
    const moi = p.get("moi");
    if (moi === "1" || moi === "0") f.mine = moi === "1";
    f.age = readRange(p, "age", base.age);
    return f;
  },
  serialize(f, base) {
    const out: Array<[string, string]> = [];
    if (f.q.trim() !== base.q.trim()) out.push(["q", f.q.trim()]);
    if (f.pos !== base.pos) out.push(["pos", f.pos]);
    if (f.mine !== base.mine) out.push(["moi", f.mine ? "1" : "0"]);
    writeRange(out, "age", f.age, base.age);
    return out;
  },
  normalize: (f, { caps }) => (caps.extra ? f : { ...f, pos: f.pos === "X" ? "" : f.pos }),
  test: (r, f) =>
    matchesQuery(r.hay, f.q) &&
    (!f.mine || r.mine) &&
    (f.age.max === null || (r.age !== null && r.age <= f.age.max)) &&
    (f.age.min === null || (r.age !== null && r.age >= f.age.min)),
  activeCount: (f, base) =>
    [f.q.trim() !== base.q.trim(), f.pos !== base.pos, f.mine !== base.mine, f.age.min !== base.age.min || f.age.max !== base.age.max].filter(Boolean).length,
  readsExtras: (f) => (f.pos === "X" ? ["snake"] : []),
  query: (f) => f.q,
  withQuery: (f, q) => ({ ...f, q }),
  equal: (a, b) => FILTERS.activeCount(a, b) === 0,
};

const SPEC: TableSpec<Row, F, Caps, Ctx> = {
  id: "test",
  rowKey: (r) => r.id,
  nameOf: (r) => r.name,
  columns: [
    { key: "pts", label: "Pts", title: "Points", align: "right", group: "Stats", sort: { value: (r) => r.pts, defaultDir: "desc", label: "Points" } },
    { key: "age", label: "Âge", title: "Âge", align: "right", group: "Profil", sort: { value: (r) => r.age, defaultDir: "asc" } },
    { key: "team", label: (c) => `Équipe ${c.label}`, title: "Équipe", align: "left", group: "Profil" },
    {
      key: "extra",
      label: "Extra",
      title: "Extra",
      align: "right",
      group: "Snake",
      sort: { value: (r) => r.extra, defaultDir: "desc" },
      needs: (c) => c.extra,
      readsExtras: "dynasty",
    },
    { key: "lazy", label: "Lazy", title: "Lazy", align: "right", group: "Snake", lazy: "snakeFull" },
  ],
  filterModel: FILTERS,
  presets: [
    { id: "tous", label: "Tous", description: "Tous", filters: {}, sort: { key: "pts", dir: "desc" }, cols: ["pts", "age", "team", "extra"] },
    { id: "jeunes", label: "Jeunes", description: "≤ 23 ans", filters: { age: { min: null, max: 23 } }, sort: { key: "age", dir: "asc" }, cols: ["age", "pts"] },
    {
      id: "moi",
      label: (c) => (c.extra ? "Moi (extra)" : "Moi"),
      description: "Mon équipe",
      filters: { mine: true },
      sort: (c) => (c.extra ? { key: "extra", dir: "desc" } : { key: "pts", dir: "desc" }),
      cols: ["pts", "age", "team", "extra"],
    },
  ],
  defaults: { filters: DEF, sort: { key: "pts", dir: "desc" }, cols: ["pts", "age", "team", "extra"] },
  autoHide: (f) => (f.mine ? ["team", "age"] : []),
  fallbackSorts: ["pts"],
  tieBreak: (a, b) => compareNames(SPEC, a, b),
  perPageOptions: [25, 50, 100],
};

const row = (id: string, name: string, pts: number | null, age: number | null, over: Partial<Row> = {}): Row => ({
  id,
  name,
  team: "MTL",
  hay: searchHaystack(name, over.team ?? "MTL"),
  pts,
  age,
  extra: null,
  mine: false,
  ...over,
});
const R: Row[] = [
  row("a", "Émile Côté", 50, 22),
  row("b", "Bo Wing", null, 30, { mine: true }),
  row("c", "Cy Mine", 70, 25, { mine: true, extra: 3 }),
  row("d", "Di Kid", 50, 19),
  row("e", "Ed Other", 90, null),
  row("f", "Al Tie", 50, 22),
];
const NO: Caps = { extra: false };
const YES: Caps = { extra: true };
const CTX: Ctx = { label: "LNH" };
const TOUS = tableBase(SPEC, "tous", NO, 50);
const ids = (rows: Row[]) => rows.map((r) => r.id).join("");

// ------------------------------------------------------------ sorts and pages

eq(ids(sortRows(SPEC, R, { key: "pts", dir: "desc" })), "ecfdab", "desc, ties by name (É with E), null last");
eq(ids(sortRows(SPEC, R, { key: "pts", dir: "asc" })), "fdaceb", "asc, null still last, ties still by name");
eq(ids(sortRows(SPEC, R, { key: "age", dir: "asc" })), "dfacbe", "age asc, ties by name");
eq(ids(sortRows(SPEC, R, { key: NAME_SORT, dir: "asc" })), "fbcdea", "name, French collation");
eq(ids(sortRows(SPEC, R, { key: NAME_SORT, dir: "desc" })), "aedcbf", "name desc");
eq(ids(sortRows(SPEC, R, { key: "team", dir: "asc" })), "fbcdea", "an unsortable column falls back to the tie-break");
eq(ids(sortRows(SPEC, [...R].reverse(), { key: "pts", dir: "desc" })), "ecfdab", "a total order whatever the input order");
eq(nextSort(SPEC, { key: "pts", dir: "desc" }, "pts"), { key: "pts", dir: "asc" }, "same header flips");
eq(nextSort(SPEC, { key: "pts", dir: "desc" }, "age"), { key: "age", dir: "asc" }, "a new column starts at its natural direction");
eq(nextSort(SPEC, { key: "age", dir: "asc" }, NAME_SORT), { key: NAME_SORT, dir: "asc" }, "the name column starts ascending");
eq([pageCount(0, 25), pageCount(51, 25), clampPage(9, 51, 25), clampPage(0, 51, 25), clampPage(2.7, 51, 25)], [1, 3, 3, 1, 2], "pages");
eq(sortLabel(SPEC, "pts", CTX), "Points", "sort label");
eq(sortLabel(SPEC, "age", CTX), "Âge", "sort label falls back to the column label");
eq(sortLabel(SPEC, NAME_SORT, CTX), "Nom", "name sort label");

// ------------------------------------------------------------ base, presets, effective view

eq([TOUS.preset, TOUS.sort, TOUS.cols, TOUS.perPage], ["tous", { key: "pts", dir: "desc" }, ["pts", "age", "team", "extra"], 50], "tab base");
eq(tableBase(SPEC, null, NO, 25).filters, DEF, "no preset: the spec's defaults");
eq(tableBase(SPEC, "nope", NO, 25).preset, null, "unknown preset: the spec's defaults");
eq(findPreset(SPEC, "moi", YES)?.label, "Moi (extra)", "labels follow the data");
eq(findPreset(SPEC, "moi", YES)?.sort, { key: "extra", dir: "desc" }, "sorts follow the data");
const jeunes = findPreset(SPEC, "jeunes", NO)!;
const moi = findPreset(SPEC, "moi", NO)!;
const v0: TableView<F> = { ...baseView(TOUS), page: 3, perPage: 100 };
const vj = applyPreset(v0, jeunes, TOUS);
eq([vj.page, vj.perPage, vj.cols], [1, 100, ["age", "pts"]], "a preset with its own columns: page 1, size kept, its columns");
eq(applyPreset(v0, moi, TOUS).cols, null, "a preset with the tab's columns keeps them automatic");
assert(matchesPreset(SPEC, vj, jeunes) && !matchesPreset(SPEC, vj, moi), "pressed chip = same filters and sort");
const vjCols: TableView<F> = { ...vj, cols: ["pts"] };
assert(matchesPreset(SPEC, vjCols, jeunes), "columns do not unpress a chip");
eq(resetView({ ...vj, perPage: 25, cols: ["pts"] }, TOUS), { ...baseView(TOUS), cols: ["pts"], perPage: 25 }, "reset: filters and sort, columns and size kept");
assert(atBase(SPEC, baseView(TOUS), TOUS) && !atBase(SPEC, vj, TOUS), "at base");
assert(!atBase(SPEC, { ...baseView(TOUS), sort: { key: "age", dir: "asc" } }, TOUS), "a sort alone is not the base");

const env = (caps: Caps) => ({ caps, labels: {}, ctx: CTX });
eq(visibleColumns(SPEC, baseView(TOUS), TOUS, NO), ["pts", "age", "team"], "unavailable columns hidden");
eq(visibleColumns(SPEC, baseView(TOUS), TOUS, YES), ["pts", "age", "team", "extra"], "they show with their data");
eq(visibleColumns(SPEC, { ...baseView(TOUS), filters: { ...DEF, mine: true } }, TOUS, NO), ["pts"], "auto-hidden for the view");
eq(visibleColumns(SPEC, { ...baseView(TOUS), filters: { ...DEF, mine: true }, cols: ["team", "age"] }, TOUS, NO), ["age", "team"], "chosen columns: no auto-hide, spec order");
{
  const e1 = effectiveView(SPEC, { ...baseView(TOUS), sort: { key: "extra", dir: "desc" } }, TOUS, env(NO));
  eq(e1.sort, { key: "pts", dir: "desc" }, "a sort on an unavailable column → the tab's sort");
  const e2 = effectiveView(SPEC, { ...baseView(TOUS), filters: { ...DEF, mine: true }, sort: { key: "age", dir: "asc" } }, TOUS, env(NO));
  eq(e2.sort, { key: "pts", dir: "desc" }, "a sort on an auto-hidden column → the first visible fallback sort");
  const e3 = effectiveView(SPEC, { ...baseView(TOUS), filters: { ...DEF, mine: true }, cols: ["age"], sort: { key: "pts", dir: "asc" } }, TOUS, env(NO));
  eq(e3.sort, { key: "pts", dir: "asc" }, "chosen columns: the sort is left alone");
  const e4 = effectiveView(SPEC, { ...baseView(TOUS), cols: ["age"], filters: { ...DEF, mine: true } }, TOUS, env(NO));
  eq(e4.columns, ["age"], "effective columns");
  const e5 = effectiveView(SPEC, { ...baseView(TOUS), filters: { ...DEF, pos: "X" } }, TOUS, env(NO));
  eq(e5.filters.pos, "", "normalize drops what the data cannot apply");
  const onlyAge = { ...TOUS, cols: ["age"] };
  const e6 = effectiveView(SPEC, { ...baseView(onlyAge), filters: { ...DEF, mine: true } }, onlyAge, env(NO));
  eq(e6.sort, { key: NAME_SORT, dir: "asc" }, "no fallback visible → the name");
}
eq(viewReadsExtras(SPEC, { filters: { ...DEF, pos: "X" }, sort: TOUS.sort }), ["snake"], "filters that wait for data");
eq(viewReadsExtras(SPEC, { filters: DEF, sort: { key: "extra", dir: "desc" } }), ["dynasty"], "sorts that wait for data");
eq(viewReadsExtras(SPEC, { filters: DEF, sort: TOUS.sort }), [], "nothing to wait for");
eq(ids(filterRows(SPEC, R, { ...DEF, mine: true }, CTX)), "bc", "filter rows");

// ------------------------------------------------------------ URL

eq(ownedParams(SPEC), ["q", "pos", "moi", "age", "tri", "ordre", "cols", "page", "par", "vue", "joueur"], "owned params");
eq(viewSearch(SPEC, baseView(TOUS), TOUS, ""), "", "base = clean URL");
eq(viewSearch(SPEC, baseView(TOUS), TOUS, "?team=x&utm=y"), "?team=x&utm=y", "foreign params kept");
const full: TableView<F> = {
  filters: { q: "Côté", pos: "C", mine: true, age: { min: 18, max: null } },
  sort: { key: "age", dir: "desc" },
  cols: ["pts", "team"],
  page: 2,
  perPage: 100,
};
const fullQs = viewSearch(SPEC, full, TOUS, "?team=x&q=old&vue=tous");
assert(fullQs.startsWith("?team=x&"), `foreign params stay first, in place (${fullQs})`);
eq(parseView(SPEC, fullQs, TOUS), full, "round trip");
eq(parseView(SPEC, "?cols=team,pts", TOUS).cols, ["pts", "team"], "columns in the spec's order");
eq(new URLSearchParams(fullQs).get("vue"), null, "a resolved ?vue= is dropped");
eq(viewParams(SPEC, { ...baseView(TOUS), sort: { key: "age", dir: "asc" } }, TOUS), [["tri", "age"]], "natural direction omitted");
eq(viewParams(SPEC, { ...baseView(TOUS), sort: { key: "pts", dir: "asc" } }, TOUS), [["ordre", "asc"]], "the base sort flipped");
{
  // Diff from each base: the same view reads the same on every tab.
  const bases = [TOUS, tableBase(SPEC, "jeunes", NO, 25), tableBase(SPEC, "moi", NO, 50)];
  const views: TableView<F>[] = [baseView(TOUS), full, { ...baseView(bases[1]!), filters: { ...DEF, q: "bo" } }, { ...full, cols: [], page: 1 }];
  for (const b of bases) {
    eq(viewSearch(SPEC, baseView(b), b, ""), "", `base ${b.preset}: clean URL`);
    for (const v of views) eq(parseView(SPEC, viewSearch(SPEC, v, b, ""), b), v, `round trip on base ${b.preset}`);
  }
  const jb = bases[1]!;
  const offAge: TableView<F> = { ...baseView(jb), filters: { ...jb.filters, age: ANY_RANGE } };
  eq(viewSearch(SPEC, offAge, jb, ""), "?age=-", "off token for a range the base bounds");
  const mb = bases[2]!;
  eq(viewSearch(SPEC, { ...baseView(mb), filters: { ...mb.filters, mine: false } }, mb, ""), "?moi=0", "off token for a flag the base sets");
  eq(parseView(SPEC, "?moi=0", mb).filters.mine, false, "moi=0 reads back");
  eq(parseView(SPEC, "?cols=", TOUS).cols, [], "cols= = every column removed");
  eq(parseView(SPEC, "", jb), baseView(jb), "missing params = the base");
}
{
  const junk = parseView(SPEC, "?tri=nope&ordre=up&page=-3&par=7&pos=lower&age=abc&moi=yes&cols=zz,pts", TOUS);
  eq([junk.sort, junk.page, junk.perPage, junk.filters.pos, junk.filters.age, junk.filters.mine, junk.cols], [TOUS.sort, 1, 50, "", ANY_RANGE, false, ["pts"]], "garbage falls back silently");
}
assert(sameViewSearch(SPEC, full, TOUS, `?${viewParams(SPEC, full, TOUS).reverse().map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`), "same view in another key order");
assert(!sameViewSearch(SPEC, full, TOUS, "?q=x"), "another view");
assert(sameViewSearch(SPEC, baseView(TOUS), TOUS, "?team=x&vue=jeunes"), "vue / joueur aside");
assert(hasPendingParams("?vue=jeunes") && hasPendingParams("?joueur=a") && !hasPendingParams("?q=a"), "pending params");
assert(hasViewParams(SPEC, "?moi=1") && hasViewParams(SPEC, "?joueur=a") && !hasViewParams(SPEC, "?team=x"), "view params detected");
eq([presetFromSearch(SPEC, "?vue=jeunes"), presetFromSearch(SPEC, "?vue=nope"), presetFromSearch(SPEC, "")], ["jeunes", null, null], "?vue=");
eq([focusFromSearch("?joueur=05wwg"), focusFromSearch("?joueur=8478402"), focusFromSearch("?joueur=fx%3A05wwg"), focusFromSearch("?joueur=%3Cx%3E"), focusFromSearch("?joueur=")], ["05wwg", "8478402", "fx:05wwg", null, null], "?joueur=");
eq([encodeRange({ min: 18, max: 21 }), encodeRange({ min: null, max: 2.5 }), encodeRange(ANY_RANGE)], ["18-21", "-2.5", ""], "encode ranges");
eq([decodeRange("30-20"), decodeRange("21"), decodeRange("-"), decodeRange("x")], [{ min: 20, max: 30 }, { min: 21, max: 21 }, ANY_RANGE, ANY_RANGE], "decode ranges");

// ------------------------------------------------------------ search: one rule for every table

{
  eq(foldForSearch("J.T. Miller"), "jt miller", "punctuation folded");
  eq(foldForSearch("O’Reilly"), "oreilly", "smart quote folded");
  eq(queryWords("  Côté  bo "), ["cote", "bo"], "query words");
  assert(matchesQuery(searchHaystack("J.T. Miller", "NYR"), "jt miller"), "« jt miller » finds J.T. Miller");
  assert(matchesQuery(searchHaystack("Ryan O'Reilly", "NSH"), "o’reilly"), "« o’reilly » finds O'Reilly");
  assert(matchesQuery(searchHaystack("Oliver Ekman-Larsson", "TOR"), "ekman larsson"), "hyphen folded");
  assert(matchesQuery(searchHaystack("Émile Côté", "MTL"), "cote mtl"), "name and team words");
  assert(!matchesQuery(searchHaystack("Émile Côté", "MTL"), "cote bos"), "every word must hit");
  assert(matchesQuery(searchHaystack("X", "Y"), "   "), "empty query matches");
  eq(ids(filterRows(SPEC, R, { ...DEF, q: "COTE" }, CTX)), "a", "the spec's filter uses it");

  // Same results as the Yahoo draft board, on its players.
  const board = JSON.parse(readFileSync(join(process.cwd(), "public", "leagues", "light-the-lamp", "board.json"), "utf8")) as DraftBoard;
  const queries = ["jt miller", "oreilly", "o reilly", "o'reilly", "mcdavid", "k andre", "larsson", "mtl", "tor", "côté", "st louis", "pierre-luc", "a", "de", "mac", "van", "ras", "nyr bo", "-", "."];
  let hits = 0;
  for (const q of queries) {
    for (const p of board.players) {
      const a = matchesQuery(searchHaystack(p.name, p.team), q);
      const b = matchesDraftQuery(p, q);
      if (a !== b) {
        assert(false, `search parity with the draft board: « ${q} » on ${p.name}`);
        break;
      }
      if (a) hits++;
    }
  }
  assert(board.players.length >= 300 && hits > 0, `parity checked on ${board.players.length} board players`);
}

// ------------------------------------------------------------ highlight (ported from test-highlight-match)

{
  const text = (n: ReactNode): string =>
    typeof n === "string"
      ? n
      : Array.isArray(n)
        ? n.map(text).join("")
        : isValidElement(n)
          ? text((n as ReactElement<{ children?: ReactNode }>).props.children)
          : "";
  const marks = (n: ReactNode): string[] =>
    Array.isArray(n)
      ? n.flatMap(marks)
      : isValidElement(n)
        ? (n as ReactElement).type === "mark"
          ? [text(n)]
          : marks((n as ReactElement<{ children?: ReactNode }>).props.children)
        : [];
  assert(highlightMatch("McDavid", "") === "McDavid", "empty query");
  assert(highlightMatch("McDavid", "xyz") === "McDavid", "no match");
  const hit = highlightMatch("Connor McDavid", "mcd");
  assert(typeof hit === "object" && hit != null, "match returns element tree");
  eq(marks(hit), ["McD"], "the match is marked");
  eq(text(hit), "Connor McDavid", "the text is kept");
  const multi = highlightMatch("Anaheim Ducks fan", "a");
  assert(typeof multi === "object" && multi != null, "multi-match tree");
  eq(marks(highlightMatch("Tim Stützle", "stutz")), ["Stütz"], "accent-insensitive");
  eq(marks(highlightMatch("Nick Suzuki", "suz nick")), ["Nick", "Suz"], "each word of the query");
  eq(marks(highlightMatch("Aaa", "aa a")), ["Aaa"], "overlapping hits merge");
  assert(
    highlightMatch("McDavid", "x".repeat(80)) === "McDavid" || typeof highlightMatch("McDavid", "x".repeat(80)) === "object",
    "long query capped without throw",
  );
  assert(HIGHLIGHT_QUERY_MAX === 48, "shared max length");
}

// ------------------------------------------------------------ copy

eq(fmtInt(2650), `2${NB}650`, "thousands");
eq(fmtInt(-1234567), `−1${NB}234${NB}567`, "negative");
eq(resultsText(1, 1, 1), "1 joueur", "singular");
eq(resultsText(51, 2, 3), "51 joueurs · page 2 sur 3", "pages");
eq(sortSummary({ label: "Points", dir: "asc" }), "trié par Points, croissant", "sort summary");
eq(counterText(3, 1, 1, { label: "Points", dir: "desc" }), "3 joueurs · trié par Points, décroissant", "counter");
eq(sortButtonLabel("Âge", false, "asc"), "Trier par Âge", "sort button (inactive)");
eq(detailsToggleLabel("Bo Wing", true), "Masquer les détails de Bo Wing", "details toggle");

if (failed) {
  console.error(`\n${failed} player-table check(s) failed`);
  process.exit(1);
}
console.log("OK: player table (sorts, pages, presets, effective view, URL, search parity, highlight, copy)");
