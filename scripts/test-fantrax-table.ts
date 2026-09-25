/**
 * Unit checks for Captains Dynasty's player table (the unified PlayerTable's
 * Fantrax adapter): the pool builder (who is in pool.json, statuses, NHL
 * draft matching), the rows (live rosters and picks, the draft helper's
 * odds, plan fallback rows), filters, sorts, the URL query against each
 * tab's base view, presets, the optional dynasty / Snake readers, the
 * dynasty hints and the French copy. Moved from test-fantrax-explorer.ts:
 * every assertion kept, only names and imports updated (the explorer's
 * helpers became the generic table's, bound to the Joueurs tab's base).
 * Run: npx tsx scripts/test-fantrax-table.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { FANTRAX_DEFAULT_TEAM_ID, NHL_SEASON_ID } from "../src/lib/fantrax/config";
import { availableProjected, type DailyPlan } from "../src/lib/fantrax/daily-plan";
import { isRuledOut } from "../src/lib/fantrax/points-model";
import { buildDailyPlan } from "../src/lib/fantrax/daily-plan";
import { dynastyHints, quantile } from "../src/lib/fantrax/dynasty-hints";
import {
  ANY,
  buildFantraxRows,
  DEFAULT_FILTERS,
  FANTRAX_TABLE,
  fantraxDraftOdds,
  fantraxFallbackRows,
  fantraxRosterRows,
  filterRows,
  NO_NHL_TEAM,
  VERDICT_POSITIVE,
  type FantraxCaps,
  type FantraxCtx,
  type FantraxFilters,
  type FantraxRow,
  type PresetId,
} from "../src/lib/fantrax/table";
import { columnCopy, fantraxTableNote, iconTags, nhlDraftLabel, statusCopy } from "../src/lib/fantrax/table-copy";
import { lookupExtra, mergeSnakeIndex, parseDynasty, parseSnakeIndex } from "../src/lib/fantrax/extras";
import { counterText, fmtInt, resultsText, sortButtonLabel } from "../src/lib/player-table/copy";
import {
  applyPreset,
  baseView,
  clampPage,
  effectiveView,
  matchesPreset,
  nextSort as nextSortOf,
  pageCount,
  resolvePreset,
  sortLabel,
  sortRows as sortRowsOf,
  tableBase,
  viewReadsExtras,
  visibleColumns as visibleColumnsOf,
} from "../src/lib/player-table/model";
import { foldSearchText } from "../src/lib/search-fold";
import type { ResolvedPreset, SortState, TableView } from "../src/lib/player-table/types";
import {
  decodeRange,
  encodeRange,
  hasViewParams,
  parseView,
  presetFromSearch,
  sameViewSearch,
  viewParams,
  viewSearch,
} from "../src/lib/player-table/url";
import { withLiveOverlay } from "../src/lib/fantrax/live";
import {
  ageOn,
  assignDraftPicks,
  buildPool,
  editDistance,
  firstNamesCompatible,
  isPoolSnapshot,
  plausibleDraftAge,
  type PoolBuildInput,
  type PoolSnapshot,
} from "../src/lib/fantrax/pool";
import type {
  LeagueSnapshot,
  ScheduleSnapshot,
  StateSnapshot,
  ValueRecord,
  ValuesSnapshot,
} from "../src/lib/fantrax/snapshot-types";

// ------------------------------------------------------------ the explorer's helpers, as the Joueurs tab's table

type ExplorerRow = FantraxRow;
type ExplorerFilters = FantraxFilters;
type ExplorerCapabilities = FantraxCaps;
type ExplorerView = TableView<FantraxFilters>;
const NO_CAPS: FantraxCaps = { draft: false, dynasty: new Set(), snake: false, snakeOpinions: false };
/** The Joueurs tab's base: the old explorer's default view. */
const TOUS = tableBase(FANTRAX_TABLE, "tous", NO_CAPS, 50);
const DEFAULT_VIEW: ExplorerView = baseView(TOUS);
const explorerPresets = (caps: FantraxCaps) => FANTRAX_TABLE.presets.map((p) => resolvePreset(FANTRAX_TABLE, p, caps));
const presetOf = (caps: FantraxCaps, id: PresetId) => explorerPresets(caps).find((p) => p.id === id)!;
const presetView = (p: ResolvedPreset<FantraxFilters>, current: ExplorerView) => applyPreset(current, p, TOUS);
const sortRows = (rows: readonly FantraxRow[], sort: SortState) => sortRowsOf(FANTRAX_TABLE, rows, sort);
const nextSort = (current: SortState, key: string) => nextSortOf(FANTRAX_TABLE, current, key);
const parseExplorerParams = (params: URLSearchParams) => parseView(FANTRAX_TABLE, params, TOUS);
const explorerParams = (view: ExplorerView) => new URLSearchParams(viewParams(FANTRAX_TABLE, view, TOUS));
const explorerSearch = (view: ExplorerView, search: string) => viewSearch(FANTRAX_TABLE, view, TOUS, search);
const sameExplorerSearch = (view: ExplorerView, search: string) => sameViewSearch(FANTRAX_TABLE, view, TOUS, search);
const hasExplorerParams = (search: string) => hasViewParams(FANTRAX_TABLE, search);
const visibleColumns = (view: Pick<ExplorerView, "filters" | "cols">, caps: FantraxCaps) =>
  visibleColumnsOf(FANTRAX_TABLE, view, TOUS, caps);
const needsExtras = (view: ExplorerView) => viewReadsExtras(FANTRAX_TABLE, view).length > 0;
const ctxOf = (teamIds: string[]): FantraxCtx => ({ teamId: "me", draftOpen: false, nextPick: null, teamName: (id) => id, teamIds });

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const eq = (a: unknown, b: unknown, msg: string) =>
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
const NB = " ";

// ------------------------------------------------------------ pool builder

const skater = (over: Partial<ValueRecord>): ValueRecord => ({
  n: "X",
  t: "MTL",
  e: "C,F,Skt",
  gp: 80,
  off: 3,
  dx: 0,
  src: "proj",
  ...over,
});

const input: PoolBuildInput = {
  fetchedAt: "2026-09-25T12:00:00.000Z",
  season: "2026-27",
  projectionsAt: "2026-09-20T00:00:00.000Z",
  leaguePlayers: {
    proj1: { eligiblePos: "C,F,Skt", status: "FA" },
    goal1: { eligiblePos: "G", status: "WW" },
    adp1: { eligiblePos: "W,F,Skt", status: "FA" },
    ros1: { eligiblePos: "D,Skt", status: "FA" },
    team1: { eligiblePos: "W,F,Skt", status: "T" },
    kid1: { eligiblePos: "W,C,F,Skt", status: "FA" },
    kid2: { eligiblePos: "D,Skt", status: "FA" },
    kid3: { eligiblePos: "W,F,Skt", status: "FA" },
    vet1: { eligiblePos: "D,Skt", status: "FA" },
    nobody: { eligiblePos: "C,F,Skt", status: "FA" },
    noname: { eligiblePos: "C,F,Skt", status: "FA" },
    ww1: { eligiblePos: "G", status: "WW" },
    sav1: { eligiblePos: "C,F,Skt", status: "FA" },
    xhe1: { eligiblePos: "D,Skt", status: "FA" },
    mor1: { eligiblePos: "W,F,Skt", status: "FA" },
    mor2: { eligiblePos: "C,F,Skt", status: "FA" },
    mur1: { eligiblePos: "G", status: "FA" },
    mur2: { eligiblePos: "G", status: "FA" },
    moo1: { eligiblePos: "C,F,Skt", status: "FA" },
  },
  identity: {
    proj1: { name: "Suzuki, Nick", team: "MTL" },
    goal1: { name: "Montembeault, Samuel", team: "MTL" },
    adp1: { name: "Old, Timer", team: "(N/A)" },
    ros1: { name: "Undrafted, Signing", team: "ARI" },
    team1: { name: "Rostered, Guy", team: "ARI" },
    kid1: { name: "Hurlbert, J.P.", team: "DET" },
    kid2: { name: "Scherbakov, Nikita", team: "NJD" },
    kid3: { name: "Hughes, Jack", team: "LAK" },
    vet1: { name: "Nobody, Special", team: "TOR" },
    nobody: { name: "Deep, Depth", team: "SJS" },
    // On waivers here: in the pool whatever else is known.
    ww1: { name: "Waiver, Goalie", team: "VAN" },
    // Matt Savoie's club and family name, another first name: not his pick.
    sav1: { name: "Savoie, Nicholas", team: "BUF" },
    // His NHL profile says undrafted: the namesake pick below is not his.
    xhe1: { name: "Xhekaj, Arber", team: "MTL" },
    // An old ageless record and the real 18-year-old share one pick's name.
    mor1: { name: "Morozov, Ilya", team: "(N/A)" },
    mor2: { name: "Morozov, Ilia", team: "BUF" },
    // Two profiles give 2012 #83: only the one born in time keeps it.
    mur1: { name: "Murray, Matt", team: "(N/A)" },
    mur2: { name: "Murray, Matthew", team: "NSH" },
    moo1: { name: "Mooney, L.J.", team: "MTL" },
  },
  rosters: { teamA: [{ id: "team1", status: "MINORS" }] },
  values: {
    proj1: skater({ n: "Nick Suzuki", e: "C,F,Skt", gp: 82, off: 3.2 }),
    goal1: { n: "Samuel Montembeault", t: "MTL", e: "G", gp: 50, gE: 4, pS: 0.6, src: "proj" },
    team1: { n: "Guy Rostered", t: "(N/A)", e: "W,F,Skt", gp: 0, off: 2.52, dx: 0, src: "prior", age: 29 },
  },
  flags: new Map([
    ["proj1", { age: 27, ros: 99.5, icons: ["1", "8"], minorsEligible: false }],
    ["ros1", { age: 23, ros: 2, icons: ["31"], minorsEligible: true }],
    ["kid1", { age: 18, ros: 32, icons: ["4", "31"], minorsEligible: true }],
    ["kid2", { age: 18, ros: 8, minorsEligible: true }],
    ["kid3", { age: 21, ros: 0.4 }],
    ["vet1", { age: 35, ros: 0 }],
    ["nobody", { age: 30, ros: 0.5 }],
    ["sav1", { age: 24, ros: 0 }],
    ["mor2", { age: 18, ros: 22 }],
    ["moo1", { age: 19, ros: 19 }],
  ]),
  listed: new Set(["proj1", "goal1", "ros1", "kid1", "kid2", "kid3", "vet1", "nobody", "sav1", "mor2", "moo1"]),
  adp: { proj1: 20.26, adp1: 292.8, xhe1: 150, mur1: 290, mur2: 291 },
  nhlIds: { proj1: 8480018, xhe1: 8482733, mur1: 8476899, mur2: 8483575 },
  bios: new Map([
    [8480018, { birthDate: "1999-08-10", draft: { year: 2017, overallPick: 13, team: "VGK" } }],
    [8482733, { birthDate: "2001-01-30", draft: null }],
    [8476899, { birthDate: "1994-05-25", draft: { year: 2012, overallPick: 83, team: "PIT" } }],
    [8483575, { birthDate: "1998-02-02", draft: { year: 2012, overallPick: 83, team: "PIT" } }],
  ]),
  draftPicks: [
    { year: 2026, overallPick: 23, team: "DET", firstName: "Jeffrey JP", lastName: "Hurlbert" },
    { year: 2026, overallPick: 44, team: "NJD", firstName: "Nikita", lastName: "Shcherbakov" },
    // Every pick of the recent drafts is fetched by year, namesakes included:
    // the NJD star's pick (2019) is 7 years off for a 21-year-old…
    { year: 2019, overallPick: 1, team: "NJD", firstName: "Jack", lastName: "Hughes" },
    // …and the LAK prospect's own pick fits his age.
    { year: 2023, overallPick: 150, team: "LAK", firstName: "Jack", lastName: "Hughes" },
    { year: 2022, overallPick: 9, team: "BUF", firstName: "Matt", lastName: "Savoie" },
    { year: 2021, overallPick: 101, team: "MTL", firstName: "Arber", lastName: "Xhekaj" },
    { year: 2026, overallPick: 20, team: "BUF", firstName: "Ilya", lastName: "Morozov" },
    { year: 2012, overallPick: 83, team: "PIT", firstName: "Matt", lastName: "Murray" },
    { year: 2025, overallPick: 113, team: "MTL", firstName: "John", lastName: "Mooney" },
    { year: 1990, overallPick: 5, team: "TOR", firstName: "Special", lastName: "Nobody" },
    { year: 2021, overallPick: 1, team: "BUF", firstName: "Owen", lastName: "Power" },
  ],
  teamAlias: (t) => (t === "ARI" ? "UTA" : t),
};
const pool = buildPool(input);
const rec = (id: string) => pool.players.find((p) => p.id === id);
eq(pool.recentDrafts, [2021, 2026], "recent drafts = the last six in the registry");
assert(!!rec("proj1") && rec("proj1")!.src === "p", "projected player is in, as projected");
eq(rec("proj1")!.dr, [2017, 13, "VGK"], "profile draft wins over the registry");
eq(rec("proj1")!.bd, "1999-08-10", "birth date from the profile");
eq(rec("proj1")!.ic, ["1"], "news icons dropped, day-to-day kept");
eq(rec("proj1")!.ros, 99.5, "Ros% kept");
eq(rec("proj1")!.adp, 20.3, "ADP to one decimal");
eq(rec("proj1")!.fp, 262.4, "season FP = GP × FP/G");
eq(rec("proj1")!.fpg, 3.2, "FP/G");
eq(rec("proj1")!.nhl, 8480018, "NHL id carried for joins");
eq(rec("goal1")!.fpg, 4, "goalie FP/match is per start (gE), not per team game");
eq(rec("goal1")!.fp, 200, "goalie season FP = starts × gE");
eq(rec("goal1")!.st, "WW", "waiver status");
eq(rec("goal1")!.pos, "G", "goalie group");
assert(rec("adp1")?.src === "n" && rec("adp1")!.t === "", "ADP alone brings a non-prospect in, clubless = empty team");
assert(rec("ros1")?.src === "e" && rec("ros1")!.me === 1 && !rec("ros1")!.ic, "Ros% ≥ 1 brings an undrafted prospect in (31 → me)");
eq(rec("team1")?.st, "teamA", "rostered player carries his fantasy team");
eq(rec("team1")?.rs, "M", "and his roster status");
eq(rec("team1")?.t, "", "values.json's clubless “(N/A)” wins over the raw id list");
eq(rec("team1")?.age, 29, "age falls back to values.json");
eq(rec("ros1")?.t, "UTA", "team codes normalized");
assert(rec("team1")?.src === "n" && rec("team1")!.fp === undefined, "rostered prior = no projection");
eq(rec("kid1")?.dr, [2026, 23, "DET"], "“J.P.” matches “Jeffrey JP” through the club's recent picks");
eq(rec("kid2")?.dr, [2026, 44, "NJD"], "“Scherbakov” matches “Shcherbakov” (one edit, same club)");
eq(rec("kid3")?.dr, [2023, 150, "LAK"], "the 1st-overall namesake is rejected on draft age");
assert(rec("kid3")?.src === "e", "recent pick → prospect even under 1% Ros");
assert(!rec("vet1"), "a 1990 pick with no projection, ADP, roster or Ros% stays out");
assert(!rec("nobody"), "Ros% under 1 alone is not enough");
assert(!rec("noname"), "no identity, no record");
assert(!!rec("ww1") && rec("ww1")!.st === "WW", "on this league's waivers → in the pool");
assert(!rec("sav1"), "same club and family name, other first name: no pick, so not in the pool");
assert(!!rec("xhe1") && rec("xhe1")!.dr === undefined, "a profile saying undrafted beats a namesake pick");
eq(rec("mor2")?.dr, [2026, 20, "BUF"], "the pick goes to the record with a plausible age");
assert(!rec("mor1"), "the ageless duplicate gets no pick (and so stays out)");
eq(rec("mur1")?.dr, [2012, 83, "PIT"], "profile draft kept when the age fits");
assert(!!rec("mur2") && rec("mur2")!.dr === undefined, "a profile draft at age 14 is ignored");
eq(rec("moo1")?.dr, [2025, 113, "MTL"], "“L.J.” matches “John” through the club's recent picks");
assert(rec("adp1")?.nl === 1 && rec("proj1")?.nl === undefined, "players off Fantrax's lists are flagged");
{
  const drs = pool.players.filter((p) => p.dr).map((p) => `${p.dr![0]}:${p.dr![1]}`);
  eq(drs.length, new Set(drs).size, "one pool record per draft pick");
}
eq(pool.counts, { total: 14, projected: 2, prospects: 6, other: 6 }, "counts");
assert(pool.players.every((p, i, a) => i === 0 || a[i - 1]!.id < p.id), "sorted by id");
assert(!JSON.stringify(pool).includes("null") && Object.values(pool.players).every((p) => Object.values(p).every((v) => v !== undefined)), "no null / undefined fields");
assert(isPoolSnapshot(pool) && !isPoolSnapshot({ v: 1, players: [{ id: 1 }] }) && !isPoolSnapshot(null), "shape guard");

eq(editDistance("scherbakov", "shcherbakov"), 1, "edit distance");
for (const [a, b] of [["J.P.", "Jeffrey (JP)"], ["Haoxi", "Simon (Haoxi)"], ["L.J.", "John"], ["Gabe", "Gabriel"], ["Aidan", "Aiden"], ["Joey", "Joseph"], ["Andrei", "Andrey"], ["Matt", "Matthew"]]) {
  assert(firstNamesCompatible(a!, b!), `first names ${a} / ${b} compatible`);
}
for (const [a, b] of [["Nicholas", "Matt"], ["Chris", "Nolan"], ["Emil", "Evan"], ["Justin", "Jake"], ["Josh", "Joey"], ["Grant", "Hampton"], ["Rob", "Beckett"], ["Henry", "Danny"]]) {
  assert(!firstNamesCompatible(a!, b!), `first names ${a} / ${b} not compatible`);
}
{
  // One pick, two exact claimants with known ages: the one on the drafting club wins.
  const pick = { year: 2025, overallPick: 5, team: "MTL", firstName: "Sam", lastName: "Doe" };
  const got = assignDraftPicks(
    [
      { id: "a", name: "Sam Doe", team: "TOR", age: 19 },
      { id: "b", name: "Sam Doe", team: "MTL", age: 19 },
    ],
    [pick],
    { syncYear: 2026, recentFrom: 2021 },
  );
  assert(!got.has("a") && got.get("b")?.[1] === 5, "tie between namesakes: drafting club first");
  const tie = assignDraftPicks(
    [
      { id: "a", name: "Sam Doe", team: "TOR", age: 19 },
      { id: "b", name: "Sam Doe", team: "BOS", age: 19 },
    ],
    [pick],
    { syncYear: 2026, recentFrom: 2021 },
  );
  eq(tie.size, 0, "a real tie gives the pick to nobody");
}
eq(editDistance("", "abc"), 3, "edit distance from empty");
assert(plausibleDraftAge(2026, { age: 18 }, 2026) && !plausibleDraftAge(2019, { age: 18 }, 2026), "draft age window");
assert(plausibleDraftAge(2026, {}, 2026), "unknown age: no veto");
eq(ageOn("2007-09-26", Date.parse("2026-09-25T12:00:00Z")), 18, "birthday tomorrow");
eq(ageOn("2007-09-25", Date.parse("2026-09-25T12:00:00Z")), 19, "birthday today");
eq(ageOn("nope", 0), undefined, "bad date");

// ------------------------------------------------------------ rows on the real snapshot

const load = <T>(...parts: string[]) => JSON.parse(readFileSync(join(process.cwd(), ...parts), "utf8")) as T;
const league = load<LeagueSnapshot>("src", "data", "fantrax", "league.json");
const values = load<ValuesSnapshot>("public", "fantrax", "values.json");
const state = load<StateSnapshot>("public", "fantrax", "state.json");
const schedule = load<ScheduleSnapshot>("public", "fantrax", `schedule-${NHL_SEASON_ID}.json`);
const realPool = load<PoolSnapshot>("public", "fantrax", "pool.json");
const teamId = FANTRAX_DEFAULT_TEAM_ID;
const nowMs = Date.parse(state.fetchedAt);
const plan = buildDailyPlan({ league, state, values, schedule, teamId, nowMs });
const draft = fantraxDraftOdds(state, values, teamId, plan.baseLineup);
const rows = buildFantraxRows({ pool: realPool, state, values, baseLineup: plan.baseLineup, draft, dynasty: null, snake: null });
const row = (id: string) => rows.find((r) => r.id === id);
eq(rows.length, realPool.players.length, "one row per pool player");

if (plan.draft && draft) {
  // The explorer's draft numbers are the draft panel's, for every board row.
  for (const b of plan.draft.board) {
    const r = row(b.id);
    assert(
      !!r && near(r.value!, b.value, 0.051) && near(r.available!, b.available, 1e-9) && (b.vona === null) === (r.vona === null) && (b.vona === null || near(r.vona!, b.vona, 0.051)),
      `explorer matches the draft panel for ${b.id} (${JSON.stringify(r && { v: r.value, a: r.available, vona: r.vona })} vs ${JSON.stringify(b)})`,
    );
  }
  eq(draft.next?.pick, plan.draft.next?.pick, "same next pick");
  assert(draft.byId.size > plan.draft.board.length, `explorer ranks the whole pool (${draft.byId.size} players)`);

  // « Meilleurs disponibles » (while the draft runs) is the draft helper's whole pool,
  // in the panel's order: nobody the panel rules out (Pietrangelo, off
  // Fantrax's lists; suspended, minors, unsigned) ranks among its players.
  const caps = { draft: true, dynasty: new Set<string>(), snake: false, snakeOpinions: false };
  const repPreset = presetOf(caps, "repechage");
  const repRows = sortRows(filterRows(rows, repPreset.filters, { teamId }), repPreset.sort);
  eq(repRows.map((r) => r.id).sort(), [...draft.byId.keys()].sort(), "draft preset = the draft helper's pool");
  eq(
    repRows.slice(0, plan.draft.board.length).map((r) => r.id),
    plan.draft.board.map((b) => b.id),
    "draft preset top = the draft panel's board, same order",
  );
  assert(repRows.every((r) => r.available !== null), "every draft preset row has the panel's odds");
}
{
  // « Agents libres à ajouter »: the waiver helper's candidates (available,
  // projected, not ruled out, listed by Fantrax), by projected points.
  const caps = { draft: !!draft?.next, dynasty: new Set<string>(), snake: false, snakeOpinions: false };
  const fa = presetOf(caps, "autonomes");
  const faIds = new Set(filterRows(rows, fa.filters, { teamId }).map((r) => r.id));
  const eligible = new Set(availableProjected(state, values).filter((id) => !isRuledOut({ team: values.players[id]!.t, icons: state.icons[id] ?? [] })));
  eq([...faIds].sort(), [...eligible].sort(), "free-agent preset = the waiver helper's candidates");
  assert(plan.waivers.targets.every((t) => faIds.has(t.id)), "every waiver target is in the free-agent preset");
  assert(rows.some((r) => !r.playing && r.src === "p" && r.owner === null), "some available projected players are ruled out");
}
if (plan.draft && draft) {

  // A pick made live (not in the baked rosters yet) takes the player out.
  const top = plan.draft.board[0]!.id;
  const open = state.draft!.picks.find((p) => !p.playerId)!;
  const livePicks = state.draft!.picks.map((p) => (p.pick === open.pick ? { ...p, playerId: top } : p));
  const liveState = withLiveOverlay(state, {
    fetchedAt: state.fetchedAt,
    rosterPeriod: state.rosterPeriod,
    rosters: state.rosters,
    draft: { state: state.draft!.state, picks: livePicks },
    recent: [],
  });
  const liveDraft = fantraxDraftOdds(liveState, values, teamId, plan.baseLineup);
  const liveRows = buildFantraxRows({ pool: realPool, state: liveState, values, baseLineup: plan.baseLineup, draft: liveDraft, dynasty: null, snake: null });
  const picked = liveRows.find((r) => r.id === top)!;
  eq(picked.owner, open.teamId, "live pick: the drafting team owns him");
  assert(picked.available === null && picked.vona === null && !liveDraft?.byId.has(top), "live pick: out of the draft pool");
  assert(
    !filterRows(liveRows, { ...DEFAULT_FILTERS, status: "dispo" }, { teamId }).some((r) => r.id === top),
    "live pick: gone from « disponibles »",
  );
} else {
  console.warn("WARN: no open draft in the snapshot; draft checks skipped");
}

// Rostered at sync and gone from the live rosters: dropped → waivers.
{
  const mine = state.rosters[teamId]![0]!.id;
  const liveState = { ...state, rosters: { ...state.rosters, [teamId]: state.rosters[teamId]!.slice(1) } };
  const r = buildFantraxRows({ pool: realPool, state: liveState, values, baseLineup: null, draft: null, dynasty: null, snake: null }).find((x) => x.id === mine);
  assert(!!r && r.owner === null && r.free === "WW", "dropped since the sync → on waivers");
  const baked = buildFantraxRows({ pool: realPool, state: null, values: null, baseLineup: null, draft: null, dynasty: null, snake: null }).find((x) => x.id === mine);
  eq(baked?.owner, teamId, "without the snapshot, the pool's own status holds");
}
eq(row(state.rosters[teamId]![0]!.id)?.owner, teamId, "rostered → owner");
assert(rows.filter((r) => r.src === "e").every((r) => r.value === null && r.fp === null), "prospects carry no projection");
assert(rows.filter((r) => r.src === "p").every((r) => r.value !== null && r.value >= r.fp! - 0.051), "value ≥ season FP (need bonus)");

// ------------------------------------------------------------ filters

const mk = (over: Partial<ExplorerRow>): ExplorerRow => ({
  id: "x",
  name: "X",
  search: "x",
  team: "MTL",
  groups: ["C"],
  age: 25,
  birthDate: null,
  owner: null,
  rosterStatus: null,
  free: "FA",
  minorsEligible: false,
  injured: false,
  playing: true,
  icons: [],
  ros: 10,
  adp: null,
  nhlDraft: null,
  fp: 100,
  fpg: 2,
  gp: 50,
  value: 100,
  vona: null,
  available: null,
  src: "p",
  nhl: null,
  dynasty: null,
  snake: null,
  hint: null,
  ...over,
});
const T: ExplorerRow[] = [
  mk({ id: "a", name: "Émile Côté", search: "emile cote mtl", groups: ["C", "W"], value: 300, fp: 300, adp: 40 }),
  mk({ id: "b", name: "Bo Wing", search: "bo wing bos", team: "BOS", groups: ["W"], free: "WW", value: 200, fp: 200, injured: true, playing: false, icons: ["30"] }),
  mk({ id: "c", name: "Cy Mine", search: "cy mine tor", team: "TOR", groups: ["D"], owner: "me", free: null, rosterStatus: "A", value: 150 }),
  mk({ id: "d", name: "Di Kid", search: "di kid", team: "", groups: ["W"], src: "e", playing: false, value: null, fp: null, fpg: null, age: 18, ros: 40, minorsEligible: true, nhlDraft: { year: 2026, overall: 5, team: "SJS" }, snake: { key: "fx:d", verdict: "très positif", trend: "en hausse", opinions: 12 }, dynasty: { value: 80, phase: "espoir", pNhl: 0.72, eta: 2028 } }),
  mk({ id: "e", name: "Ed Other", search: "ed other nyr", team: "NYR", groups: ["G"], owner: "them", free: null, value: 120, snake: { key: "fx:e", verdict: "mitigé" }, dynasty: { value: 20, phase: "déclin", pNhl: 1, eta: 2020 } }),
];
const ids = (f: Partial<ExplorerFilters>) => filterRows(T, { ...DEFAULT_FILTERS, ...f }, { teamId: "me" }).map((r) => r.id).join("");
eq(ids({}), "abcde", "no filter");
eq(ids({ q: "COTE" }), "a", "search folds accents and case");
eq(ids({ q: "bos" }), "b", "search matches the NHL team");
eq(ids({ q: "bo wi" }), "b", "every word must match");
eq(ids({ pos: ["W"] }), "abd", "any eligible position matches");
eq(ids({ pos: ["D", "G"] }), "ce", "several positions");
eq(ids({ status: "dispo" }), "abd", "available");
eq(ids({ status: "fa" }), "ad", "free agents");
eq(ids({ status: "ww" }), "b", "waivers");
eq(ids({ status: "pris" }), "ce", "taken");
eq(ids({ status: "moi" }), "c", "my team");
eq(ids({ status: "them" }), "e", "a given team");
eq(ids({ nhlTeam: "TOR" }), "c", "NHL team");
eq(ids({ nhlTeam: NO_NHL_TEAM }), "d", "no NHL team");
eq(ids({ type: "proj" }), "abce", "projected");
eq(ids({ type: "espoirs" }), "d", "prospects");
eq(ids({ minors: true }), "d", "minors-eligible");
eq(ids({ healthy: true }), "acde", "injured out");
eq(ids({ active: true }), "ace", "only players in the NHL now");
eq(ids({ age: { min: null, max: 21 } }), "d", "age max");
eq(ids({ fp: { min: 150, max: null } }), "ab", "FP min (prospects without FP drop)");
eq(ids({ ros: { min: 20, max: 50 } }), "d", "Ros% range");
eq(ids({ adp: { min: null, max: 100 } }), "a", "ADP max keeps only players with an ADP");
eq(ids({ verdict: VERDICT_POSITIVE }), "d", "« positif ou mieux »");
eq(ids({ verdict: "mitigé" }), "e", "exact verdict");
eq(ids({ trend: "en hausse" }), "d", "trend");
eq(ids({ phase: "déclin" }), "e", "phase");
eq(ids({ pNhl: { min: 80, max: null } }), "e", "P(LNH) in percent");
eq(ids({ eta: { min: null, max: 2025 } }), "e", "ETA");
eq(ids({ dyn: { min: 50, max: null } }), "d", "dynasty value");

// ------------------------------------------------------------ sorting

const order = (key: string, dir: "asc" | "desc") => sortRows(T, { key, dir }).map((r) => r.id).join("");
eq(order("valeur", "desc"), "abced", "value desc, missing last");
eq(order("valeur", "asc"), "ecbad", "value asc, missing still last");
eq(order("adp", "asc"), "abced", "ADP asc; the rest by value");
eq(order("verdict", "desc"), "deabc", "verdict: très positif first");
eq(order("nom", "asc"), "bcdea", "name, French collation (É with E)");
eq(order("lnh", "asc"), "dabce", "NHL draft rank");
eq(nextSort({ key: "valeur", dir: "desc" }, "valeur"), { key: "valeur", dir: "asc" }, "same header flips");
eq(nextSort({ key: "valeur", dir: "desc" }, "adp"), { key: "adp", dir: "asc" }, "ADP starts ascending");
eq(nextSort({ key: "adp", dir: "asc" }, "ros"), { key: "ros", dir: "desc" }, "Ros% starts descending");
eq(pageCount(0, 50), 1, "empty = one page");
eq(pageCount(101, 50), 3, "pages");
eq(clampPage(9, 101, 50), 3, "page clamped to the last");
eq(clampPage(0, 101, 50), 1, "page clamped to the first");

// ------------------------------------------------------------ URL

eq(encodeRange({ min: 18, max: 21 }), "18-21", "range");
eq(encodeRange({ min: null, max: 21 }), "-21", "open min");
eq(encodeRange(ANY), "", "open range");
eq(decodeRange("2.5-"), { min: 2.5, max: null }, "decimal min");
eq(decodeRange("21"), { min: 21, max: 21 }, "lone number = exact");
eq(decodeRange("30-20"), { min: 20, max: 30 }, "inverted bounds swapped");
eq(decodeRange("abc"), ANY, "junk ignored");
eq(explorerSearch(DEFAULT_VIEW, ""), "", "default view = clean URL");
eq(explorerSearch(DEFAULT_VIEW, "?team=abc"), "?team=abc", "team kept");
const view: ExplorerView = {
  filters: {
    ...DEFAULT_FILTERS,
    q: "Côté",
    pos: ["C", "D"],
    status: "dispo",
    nhlTeam: "MTL",
    type: "espoirs",
    age: { min: null, max: 21 },
    ros: { min: 5, max: null },
    minors: true,
    healthy: true,
    verdict: VERDICT_POSITIVE,
    pNhl: { min: 50, max: null },
  },
  sort: { key: "ros", dir: "asc" },
  cols: ["statut", "age", "ros"],
  page: 3,
  perPage: 100,
};
const qs = explorerSearch(view, "?team=abc&utm=x");
assert(qs.startsWith("?team=abc&utm=x&"), `other params kept in place (${qs})`);
eq(parseExplorerParams(new URLSearchParams(qs)), view, "URL round trip");
eq(explorerParams(view).get("ordre"), "asc", "non-default direction written");
eq(explorerParams({ ...DEFAULT_VIEW, sort: { key: "adp", dir: "asc" } }).toString(), "tri=adp", "natural direction omitted");
eq(parseExplorerParams(new URLSearchParams("pos=x,g,C&type=bad&tri=nope&page=-2&par=7&statut=a b")).filters.pos, ["C", "G"], "positions sanitized");
{
  const junk = parseExplorerParams(new URLSearchParams("type=bad&tri=nope&page=-2&par=7&statut=a%20b&lnh=12"));
  eq([junk.filters.type, junk.sort, junk.page, junk.perPage, junk.filters.status, junk.filters.nhlTeam], ["tous", DEFAULT_VIEW.sort, 1, 50, "tous", ""], "junk falls back to defaults");
}
assert(hasExplorerParams("?team=x&statut=moi") && !hasExplorerParams("?team=x"), "explorer params detected");
assert(sameExplorerSearch(view, `?${[...explorerParams(view)].reverse().map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`), "same view in another key order");
assert(!sameExplorerSearch(DEFAULT_VIEW, "?statut=dispo"), "different view");

// ------------------------------------------------------------ presets and columns

const noExtras: ExplorerCapabilities = { draft: true, dynasty: new Set(), snake: false, snakeOpinions: false };
const withExtras: ExplorerCapabilities = {
  draft: true,
  dynasty: new Set(["value", "phase", "pNhl", "eta", "p10", "p90"]),
  snake: true,
  snakeOpinions: true,
};
const presets = explorerPresets(noExtras);
// The explorer's four presets, plus the Joueurs tab's own view (« tous ») and waivers only.
eq(presets.map((p) => p.id), ["tous", "repechage", "espoirs", "autonomes", "ballottage-ww", "equipe"], "six presets");
// « Agents libres » became « Autonomes » (the site's word for free agents, as in the Statut column).
eq(presets.map((p) => p.label), ["Tous les joueurs", "Meilleurs disponibles", "Espoirs ≤ 21 ans disponibles", "Autonomes à ajouter", "Au ballottage", "Mon équipe"], "preset labels");
const espoirsPreset = presetOf(noExtras, "espoirs");
eq(espoirsPreset.sort.key, "ros", "prospects by Ros% without dynasty data");
eq(presetOf(withExtras, "espoirs").sort.key, "dyn", "prospects by dynasty value when published");
eq(presetOf({ ...noExtras, draft: false }, "repechage").label, "Meilleurs disponibles", "no draft: no « au repêchage »");
const applied = presetView(espoirsPreset, { ...DEFAULT_VIEW, page: 4, perPage: 100 });
assert(matchesPreset(FANTRAX_TABLE, applied, espoirsPreset) && !matchesPreset(FANTRAX_TABLE, applied, presetOf(noExtras, "repechage")), "preset pressed state");
eq([applied.page, applied.perPage], [1, 100], "preset resets the page, keeps the page size");
// Links from other tabs name the preset (`TabLink … vue`); the table reads it back.
eq(presetFromSearch(FANTRAX_TABLE, "?team=abc&vue=espoirs"), "espoirs", "?vue= read back");
eq(presetFromSearch(FANTRAX_TABLE, "?vue=nope"), null, "unknown preset ignored");
assert(hasExplorerParams("?vue=espoirs"), "a ?vue= link loads the table");
eq(explorerSearch(presetView(espoirsPreset, DEFAULT_VIEW), "?team=abc&vue=espoirs"), "?team=abc&statut=dispo&type=espoirs&age=-21&tri=ros", "the resolved view replaces ?vue=");
eq(visibleColumns(DEFAULT_VIEW, { ...noExtras, draft: false }).join(), "statut,valeur,fp,fpm,age,ros,adp,lnh", "no draft: no VONA / odds");
eq(visibleColumns(DEFAULT_VIEW, withExtras).join(), "statut,valeur,vona,dispo,fp,fpm,age,ros,adp,lnh,dyn,phase,verdict", "extras appear");
eq(visibleColumns(presetView(espoirsPreset, DEFAULT_VIEW), noExtras).join(), "age,ros,adp,lnh", "available prospects: no projection columns, no Statut");
eq(visibleColumns({ ...presetView(espoirsPreset, DEFAULT_VIEW), cols: ["valeur", "age"] }, noExtras).join(), "valeur,age", "explicit columns win");
// The explorer's owned / available presets on its default columns (the presets now carry their own columns, below).
eq(visibleColumns({ ...DEFAULT_VIEW, filters: presetOf(noExtras, "equipe").filters }, noExtras).join(), "statut,valeur,fp,fpm,age,ros,adp,lnh", "owned players: no VONA / odds");
eq(visibleColumns({ ...DEFAULT_VIEW, filters: presetOf(noExtras, "repechage").filters }, noExtras).join(), "valeur,vona,dispo,fp,fpm,age,ros,adp,lnh", "available players keep them, without the Statut column");
eq(visibleColumns({ ...DEFAULT_VIEW, filters: { ...DEFAULT_FILTERS, status: "ww" } }, noExtras)[0], "valeur", "waivers only: no Statut column either");
eq(visibleColumns(DEFAULT_VIEW, { ...withExtras, snakeOpinions: false }).includes("opinions"), false, "no opinion counts, no Opinions column");

// Effective view: what a bookmark asks for that this data cannot show falls back.
{
  const labels = { phases: [] as string[], verdicts: [] as string[], trends: [] as string[] };
  const ctx = { caps: noExtras, ctx: ctxOf(["t1"]), labels };
  const eff = (qs: string, c = ctx) => effectiveView(FANTRAX_TABLE, parseExplorerParams(new URLSearchParams(qs)), TOUS, c);
  eq(eff("verdict=positif%2B&tendance=stable&phase=prime&pnhl=50-&eta=-2028&dyn=50-").filters, DEFAULT_FILTERS, "dynasty / Snake filters off without their files");
  eq(eff("statut=zzz").filters.status, "tous", "unknown team → everyone");
  eq(eff("statut=t1").filters.status, "t1", "known team kept");
  eq(eff("dyn=50-&tri=dyn").sort, DEFAULT_VIEW.sort, "sort on a missing column → value");
  const withLabels = { caps: withExtras, ctx: ctxOf([]), labels: { phases: ["prime"], verdicts: ["positif"], trends: ["stable"] } };
  eq(eff("verdict=positif&phase=prime&tendance=stable&dyn=50-", withLabels).filters, { ...DEFAULT_FILTERS, verdict: "positif", phase: "prime", trend: "stable", dyn: { min: 50, max: null } }, "kept with their files");
  eq(eff("verdict=bof&phase=junk", withLabels).filters, DEFAULT_FILTERS, "labels the file does not use → off");
  eq(eff("verdict=positif%2B", withLabels).filters.verdict, VERDICT_POSITIVE, "« positif ou mieux » kept");
  eq(eff("type=espoirs").sort, { key: "ros", dir: "desc" }, "prospects: the hidden Valeur sort shows as the Ros% it really is");
  eq(eff("type=espoirs&tri=adp").sort, { key: "adp", dir: "asc" }, "a visible sort stays");
  eq(eff("statut=moi&tri=vona").sort, { key: "valeur", dir: "desc" }, "owned players: hidden VONA → value");
  eq(eff("type=espoirs&cols=valeur,age").sort, DEFAULT_VIEW.sort, "chosen columns: the sort is left alone");
  eq(eff("type=espoirs").columns.join(), "statut,age,ros,adp,lnh", "columns of the effective view");
  const espoirs = presetView(espoirsPreset, DEFAULT_VIEW);
  const espoirsDyn = presetView(presetOf(withExtras, "espoirs"), DEFAULT_VIEW);
  assert(matchesPreset(FANTRAX_TABLE, espoirs, espoirsPreset) && !matchesPreset(FANTRAX_TABLE, espoirs, presetOf(withExtras, "espoirs")), "the prospects preset changes once dynasty data is in");
  assert(needsExtras(espoirsDyn) && !needsExtras(espoirs) && needsExtras(parseExplorerParams(new URLSearchParams("verdict=positif"))), "views that wait for the optional files");
}

// ------------------------------------------------------------ dynasty / Snake readers

{
  const d1 = parseDynasty({ players: { "05wwg": { dynastyValue: 88.5, phase: "prime", eta: "2027-28", pNhl: 72, p10: 40, p50: 80, p90: 120 } } });
  const info = lookupExtra(d1, "05wwg", undefined);
  eq(info, { value: 88.5, phase: "prime", eta: 2027, pNhl: 0.72, p10: 40, p50: 80, p90: 120 }, "dynasty record, percent and season normalized");
  eq([...d1!.fields].sort(), ["eta", "p10", "p50", "p90", "pNhl", "phase", "value"], "fields present");
  const d2 = parseDynasty([{ fantraxId: "06axb", value: 10, phase: "espoir" }, { nhlId: 8484185, dv: 5, phase: "déclin", range: [1, 2, 3] }]);
  eq(lookupExtra(d2, "zzzzz", 8484185), { value: 5, phase: "déclin", p10: 1, p50: 2, p90: 3 }, "array form, NHL id join, range array");
  eq(d2!.phases, ["espoir", "déclin"], "phases in career order");
  eq(lookupExtra(parseDynasty({ "06axb": { dynastyValue: 3 } }), "06axb", undefined), { value: 3 }, "bare map");
  eq(parseDynasty({ hello: "world" }), null, "nothing usable → null");
  eq(parseDynasty(null), null, "404 → null");
  eq([...parseDynasty({ players: { "05wwg": { phase: "espoir" } } })!.fields], ["phase"], "only the fields present");

  const s = parseSnakeIndex({
    v: 1,
    rows: [
      { k: "fx:05wwg", n: "Lane Hutson", fx: "05wwg", nhl: 8483457, v: "très positif", td: "en hausse", pj: "Défenseur no 1", s: "Synthèse.", oc: 129 },
      { k: "nhl:8470594", n: "Old Guy", fx: null, nhl: 8470594, v: "mitigé", td: "stable", pj: null, s: "…", oc: 3 },
      { k: "name:ghost", n: "Ghost", fx: null, nhl: null, v: "positif", td: "stable", s: "x", oc: 1 },
    ],
  });
  eq(lookupExtra(s, "05wwg", undefined), { key: "fx:05wwg", verdict: "très positif", trend: "en hausse", projection: "Défenseur no 1", summary: "Synthèse.", opinions: 129 }, "Snake row by Fantrax id");
  eq(lookupExtra(s, "zzzzz", 8470594)?.key, "nhl:8470594", "Snake row by NHL id");
  eq(s!.verdicts, ["très positif", "mitigé"], "verdicts in scale order (unjoinable rows ignored)");
  eq(parseSnakeIndex({ rows: "nope" }), null, "garbage → null");
}

// ------------------------------------------------------------ copy

eq(fmtInt(2650), `2${NB}650`, "thousands with a no-break space");
eq(resultsText(2650, 1, 53), `2${NB}650 joueurs · page 1 sur 53`, "results");
eq(resultsText(1, 1, 1), "1 joueur", "singular");
assert(resultsText(0, 1, 1).startsWith("Aucun joueur"), "no result");
eq(nhlDraftLabel({ year: 2026, overall: 1, team: "TOR" }), "2026 · 1er · TOR", "first overall");
eq(nhlDraftLabel({ year: 2021, overall: 38, team: "VGK" }), "2021 · 38e · VGK", "draft label");
eq(nhlDraftLabel(null), "—", "undrafted");
const sc = (over: Partial<ExplorerRow>, draftOpen: boolean) =>
  statusCopy(mk(over), { teamId: "me", draftOpen, teamName: (id) => `Équipe ${id}` });
eq(sc({ owner: "me", rosterStatus: "M", free: null }, true), { text: "Mon équipe", tone: "cyan", detail: "mineures" }, "my team");
eq(sc({ owner: "t", rosterStatus: null, free: null }, true).detail, "vient d'être repêché", "picked live");
eq(sc({}, true).text, "Disponible", "draft open");
eq(sc({ free: "WW" }, false), { text: "Ballottage", tone: "amber" }, "waivers");
eq(sc({}, false).text, "Autonome", "free agent");
eq(iconTags(["2", "6"]).map((t) => t.text), ["Blessé", "Suspendu"], "injury + suspension tags");
eq(iconTags(["1"]).map((t) => t.text), ["Jour à jour"], "day-to-day tag");
eq(columnCopy("dispo", 27).label, `Dispo. au n°${NB}27`, "odds header names my pick");
eq(sortButtonLabel("ADP", true, "asc"), "ADP, tri croissant (cliquer pour inverser)", "sort button name");
{
  const note = fantraxTableNote({ draftOpen: true, nextPick: 27, poolAsOf: "", counts: { projected: 1294, prospects: 1298 }, recentDrafts: [2021, 2026], dynasty: false, snake: true });
  assert(note.includes("2021 à 2026") && note.includes(`n°${NB}27`) && note.includes("Snake") && !note.includes("dynastie :"), "explorer note");
  assert(note.includes(`espoirs${NB}: les joueurs`), "space before and after the colon");
  assert(note.includes("l’onglet Repêchage") && !note.includes("panneau"), "names the Repêchage tab");
  const brief = fantraxTableNote({ draftOpen: true, nextPick: 27, poolAsOf: "", counts: { projected: 1294, prospects: 1298 }, recentDrafts: [2021, 2026], dynasty: false, snake: true, brief: true });
  assert(!brief.includes("Valeur =") && !brief.includes("VONA"), "under the Repêchage note: value and VONA not explained twice");
}
const valeurLabel = sortLabel(FANTRAX_TABLE, "valeur", ctxOf([]));
eq(counterText(880, 1, 18, { label: valeurLabel, dir: "desc" }), `880 joueurs · page 1 sur 18 · trié par Valeur, décroissant`, "counter names the sort");
eq(counterText(0, 1, 1, { label: valeurLabel, dir: "desc" }), "Aucun joueur ne correspond à ces filtres.", "empty counter");

// ------------------------------------------------------------ tab bases and old bookmarks

{
  // The Joueurs tab starts from « tous »: the old explorer's default view, so its bookmarks read the same.
  eq(TOUS.filters, DEFAULT_FILTERS, "Joueurs base = the old default filters");
  eq(TOUS.sort, { key: "valeur", dir: "desc" }, "Joueurs base sort");
  eq(
    parseView(FANTRAX_TABLE, "?statut=dispo&tri=vona", TOUS),
    { filters: { ...DEFAULT_FILTERS, status: "dispo" }, sort: { key: "vona", dir: "desc" }, cols: null, page: 1, perPage: 50 },
    "an old /league bookmark parses as it did",
  );
  const rep = tableBase(FANTRAX_TABLE, "repechage", NO_CAPS, 25);
  eq([rep.filters.status, rep.filters.type, rep.filters.active, rep.perPage], ["dispo", "proj", true, 25], "Repêchage base");
  eq(viewSearch(FANTRAX_TABLE, baseView(rep), rep, "?team=abc"), "?team=abc", "a clean tab URL shows the tab's own view");
  eq(parseView(FANTRAX_TABLE, "", rep).filters, rep.filters, "missing params keep the base");
  // Off tokens: the base turns things on, the view turns them off.
  const off: TableView<FantraxFilters> = { ...baseView(rep), filters: { ...rep.filters, status: "tous", type: "tous", active: false } };
  const offQs = viewSearch(FANTRAX_TABLE, off, rep, "");
  eq(offQs, "?statut=tous&type=tous&actifs=0", "explicit off tokens");
  eq(parseView(FANTRAX_TABLE, offQs, rep), off, "off tokens round trip");
  const espBase = tableBase(FANTRAX_TABLE, "espoirs", NO_CAPS, 50);
  const openAge: TableView<FantraxFilters> = { ...baseView(espBase), filters: { ...espBase.filters, age: ANY } };
  eq(viewSearch(FANTRAX_TABLE, openAge, espBase, ""), "?age=-", "an open range on a base with a bound: age=-");
  eq(parseView(FANTRAX_TABLE, "?age=-", espBase).filters.age, ANY, "age=- reads back open");
  eq(parseView(FANTRAX_TABLE, "?cols=", TOUS).cols, [], "cols= (every column removed)");
  eq(viewSearch(FANTRAX_TABLE, { ...DEFAULT_VIEW, cols: [] }, TOUS, ""), "?cols=", "no column written as cols=");
  eq(viewSearch(FANTRAX_TABLE, { ...baseView(rep), perPage: 50 }, rep, ""), "?par=50", "page size differing from the tab's");
  const ww = presetOf(noExtras, "ballottage-ww");
  eq([ww.filters.status, ww.filters.type, ww.sort.key, ww.sort.dir], ["ww", "proj", "fp", "desc"], "waivers-only preset");
  const auto = tableBase(FANTRAX_TABLE, "autonomes", NO_CAPS, 50);
  eq(parseView(FANTRAX_TABLE, "?tri=valeur", auto).sort, { key: "valeur", dir: "desc" }, "another sort starts at its natural direction");
  eq(viewSearch(FANTRAX_TABLE, { ...baseView(auto), sort: { key: "fp", dir: "asc" } }, auto, ""), "?ordre=asc", "the base sort, flipped");
  // The team view's own columns (dynasty ones wait for their data).
  const team = tableBase(FANTRAX_TABLE, "equipe", NO_CAPS, 50);
  eq(visibleColumnsOf(FANTRAX_TABLE, baseView(team), team, noExtras).join(), "statut,valeur,fpm,age,ros", "Mon équipe columns");
  eq(
    visibleColumnsOf(FANTRAX_TABLE, baseView(team), team, withExtras).join(),
    "statut,valeur,fpm,age,ros,dyn,phase,pnhl,eta,conseil,verdict",
    "Mon équipe columns with dynasty and Snake data",
  );
  const repView = applyPreset(DEFAULT_VIEW, presetOf(withExtras, "repechage"), TOUS);
  eq(visibleColumnsOf(FANTRAX_TABLE, repView, TOUS, withExtras).join(), "valeur,vona,dispo,fp,age,ros,adp,synthese", "the draft chip brings its own columns");
  eq(applyPreset(DEFAULT_VIEW, presetOf(noExtras, "autonomes"), TOUS).cols, null, "a chip with the tab's columns keeps them automatic");
}

// ------------------------------------------------------------ search: accents, case and name punctuation

{
  // Old rule: accent- and case-folded "name team", every word a substring.
  const oldMatch = (r: FantraxRow, q: string) => {
    const hay = foldSearchText(`${r.name} ${r.team}`);
    return foldSearchText(q).split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
  };
  const queries = [
    "mcdavid", "MTL", "côté", "cote", "st. louis", "st louis", "o'reilly", "oreilly", "jt miller", "j.t.",
    "ekman", "larsson", "lafreniere", "stutzle", "slafkovsky", "hughes", "aho", "tor", "bos nyr", "a",
    "-", ".", "'", "de la", "pierre-luc", "pierre luc", "dubois", "suzuki", "caufield", "hutson",
    "matthews tor", "marner", "kaprizov", "vegas", "vgk", "l.j.", "lj", "mac", "mc", "van",
    "ryan", "nick", "jack", "sam", "eric", "zach", "dyl", "ras", "kirill", "lane",
  ];
  eq(queries.length, 50, "50 sample queries");
  let widened = 0;
  for (const q of queries) {
    for (const r of rows) {
      const was = oldMatch(r, q);
      const now = filterRows([r], { ...DEFAULT_FILTERS, q }, { teamId }).length === 1;
      if (was && !now) {
        assert(false, `search superset: « ${q} » no longer finds ${r.name}`);
        break;
      }
      if (now && !was) widened++;
    }
  }
  assert(widened > 0, "punctuation folding finds more names (J.T., O'Reilly…)");
  const find = (q: string) => filterRows(T, { ...DEFAULT_FILTERS, q }, { teamId: "me" }).map((r) => r.id).join("");
  const P: FantraxRow[] = [
    mk({ id: "jt", name: "J.T. Miller", search: "jt miller nyr" }),
    mk({ id: "or", name: "Ryan O'Reilly", search: "ryan oreilly nsh" }),
  ];
  const findP = (q: string) => filterRows(P, { ...DEFAULT_FILTERS, q }, { teamId: "me" }).map((r) => r.id).join("");
  eq([findP("jt miller"), findP("oreilly"), findP("o’reilly"), findP("o'reilly")], ["jt", "or", "or", "or"], "punctuation folded on both sides");
  eq(find("émile"), "a", "accents still folded");
}

// ------------------------------------------------------------ dynasty hints (« Conseil »)

{
  eq(quantile([1, 2, 3, 4, 5], 0.5), 3, "median");
  eq(quantile([10, 20], 0.25), 12.5, "linear between ranks");
  eq(quantile([], 0.5), null, "no values");
  const h = (id: string, value: number | undefined, phase?: string, pNhl?: number, owner: string | null = "t") => ({
    id,
    owner,
    dynasty: { ...(value !== undefined ? { value } : {}), ...(phase ? { phase } : {}), ...(pNhl !== undefined ? { pNhl } : {}) },
  });
  // Rostered values 10..100 by 10: p25 = 32.5, p50 = 55, p80 = 82.
  const hints = dynastyHints([
    h("a", 100, "prime"),
    h("b", 90, "prime"),
    h("c", 80, "déclin"),
    h("d", 70, "fin de carrière"),
    h("e", 60, "prime"),
    h("f", 50, "déclin"),
    h("g", 40, "espoir", 0.7),
    h("h", 30, "prime"),
    h("i", 20, "en ascension", 0.2),
    h("j", 10, "prime"),
    h("k", 5, "espoir", 0.9, null),
    { id: "z", owner: "t", dynasty: null },
  ]);
  eq(
    ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"].map((id) => hints.get(id) ?? "—"),
    ["Pilier", "Pilier", "Vendre haut", "Vendre haut", "À garder", "À garder", "Espoir à protéger", "Remplaçable", "À garder", "Remplaçable", "Espoir à protéger"],
    "hint rules in order (unrostered players ranked against the rostered ones)",
  );
  assert(!hints.has("z"), "no dynasty data, no hint");
}

// ------------------------------------------------------------ rows from the plan (until pool.json is in)

{
  const fixturePlan = {
    teamId: "me",
    players: {
      p1: { n: "Mine One", t: "MTL", e: "C,F,Skt", st: "ACTIVE", fpg: 2.5, src: "proj", age: 25, ros: 80 },
      p2: { n: "Mine Kid", t: "(N/A)", e: "D,Skt", st: "MINORS", fpg: 0.4, src: "prior" },
      p3: { n: "Free Guy", t: "BOS", e: "W,F,Skt", st: "FA", fpg: 2, src: "proj", icons: ["30"] },
      p4: { n: "Waiver Guy", t: "TOR", e: "G", st: "WW", fpg: 3, src: "proj" },
    },
    draft: {
      board: [
        { id: "p3", value: 210, seasonFp: 180, groups: ["W"], vona: 12.5, vonaGroup: "W", available: 0.4, likelyGone: true },
        { id: "p4", value: 190, seasonFp: 190, groups: ["G"], vona: null, vonaGroup: null, available: 0.9, likelyGone: false },
        { id: "gone", value: 1, seasonFp: 1, groups: ["C"], vona: null, vonaGroup: null, available: 1, likelyGone: false },
      ],
    },
  } as unknown as DailyPlan;
  const d = fantraxFallbackRows(fixturePlan, "draft", null);
  eq(d.map((r) => r.id), ["p3", "p4"], "draft board rows (unknown ids skipped)");
  eq(
    [d[0]!.value, d[0]!.fp, d[0]!.vona, d[0]!.available, d[0]!.owner, d[0]!.free, d[0]!.src, d[0]!.injured],
    [210, 180, 12.5, 0.4, null, "FA", "p", true],
    "draft row = the board's numbers",
  );
  eq([d[1]!.free, d[1]!.groups], ["WW", ["G"]], "waiver status and group");
  assert(d.every((r) => r.adp === null && r.nhlDraft === null && r.birthDate === null), "pool-only fields empty");
  const t = fantraxFallbackRows(fixturePlan, "team", null);
  eq(t.map((r) => r.id), ["p1", "p2"], "team rows = the team's roster");
  eq([t[0]!.owner, t[0]!.rosterStatus, t[1]!.rosterStatus, t[1]!.team, t[1]!.src], ["me", "A", "M", "", "n"], "team row status");
  eq(filterRows(d, presetOf(noExtras, "repechage").filters, { teamId: "me" }).map((r) => r.id), ["p4"], "the draft view's filters apply to them");
  eq(fantraxFallbackRows(null, "draft", null), [], "no plan, no rows");
  // Invariants on the committed plan.
  if (plan.draft) {
    const live = fantraxFallbackRows(plan, "draft", null);
    assert(live.length > 0 && live.every((r) => r.owner === null && r.value !== null), "committed plan: draft rows");
  }
  const mine = fantraxFallbackRows(plan, "team", null);
  assert(mine.length > 0 && mine.every((r) => r.owner === plan.teamId), "committed plan: the team's rows");

  // Mon équipe before pool.json: the whole roster from the league state, not only the plan's players.
  const roster = fantraxRosterRows(
    fixturePlan,
    [
      { id: "p1", status: "ACTIVE" },
      { id: "m9", status: "MINORS" },
      { id: "nobody", status: "MINORS" },
    ],
    { m9: { n: "Minor Kid", t: "(N/A)", e: "C,F,Skt", gp: 0, src: "prior", age: 19 } } as unknown as ValuesSnapshot["players"],
    "me",
    null,
  );
  eq(roster.map((r) => r.id), ["p1", "m9"], "roster rows: plan players, then values.json names (unknown ids skipped)");
  eq(
    [roster[1]!.name, roster[1]!.owner, roster[1]!.rosterStatus, roster[1]!.fpg, roster[1]!.team, roster[1]!.age],
    ["Minor Kid", "me", "M", null, "", 19],
    "a minors player the planner skipped",
  );
  const full = fantraxRosterRows(plan, state.rosters[plan.teamId] ?? [], values.players, plan.teamId, null);
  eq(full.length, (state.rosters[plan.teamId] ?? []).length, "committed data: every rostered player of the team");
  assert(full.length >= mine.length, "committed data: at least the plan's players");
}

// ------------------------------------------------------------ Snake: compact verdicts under the full index

{
  const compact = parseSnakeIndex({ v: 1, rows: { "05wwg": ["fx:05wwg", "très positif", "en hausse", "Une ligne.", 1] } });
  const fullIdx = parseSnakeIndex({ v: 1, rows: [{ k: "fx:05wwg", fx: "05wwg", v: "positif", td: "stable", s: "Long.", oc: 12 }] });
  eq(lookupExtra(compact, "05wwg", undefined), { key: "fx:05wwg", verdict: "très positif", trend: "en hausse", summary: "Une ligne.", probable: true }, "compact row, probable flag");
  eq(lookupExtra(mergeSnakeIndex(fullIdx, compact), "05wwg", undefined), { key: "fx:05wwg", verdict: "positif", trend: "stable", summary: "Long.", probable: true, opinions: 12 }, "the full index wins, the compact fills gaps");
  eq(mergeSnakeIndex(null, compact), compact, "one side only");
  const withSnake = buildFantraxRows({ pool: realPool, state, values, baseLineup: plan.baseLineup, draft, dynasty: null, snake: parseSnakeIndex(JSON.parse(readFileSync(join(process.cwd(), "public", "snake", "fantrax.json"), "utf8"))) });
  assert(withSnake.filter((r) => r.snake?.verdict).length > 100, "committed compact file: verdicts on the pool rows");
}

// ------------------------------------------------------------ speed (generous CI margins)

{
  let t0 = performance.now();
  const built = buildFantraxRows({ pool: realPool, state, values, baseLineup: plan.baseLineup, draft, dynasty: null, snake: null });
  const buildMs = performance.now() - t0;
  assert(buildMs <= 300, `buildFantraxRows: ${buildMs.toFixed(0)} ms (≤ 300)`);
  t0 = performance.now();
  for (const q of ["", "a", "mc"]) sortRows(filterRows(built, { ...DEFAULT_FILTERS, q, status: "dispo" }, { teamId }), { key: "nom", dir: "asc" });
  const sortMs = (performance.now() - t0) / 3;
  assert(sortMs <= 200, `filter + sort of the pool: ${sortMs.toFixed(0)} ms (≤ 200)`);
}

if (failed > 0) {
  console.error(`\n${failed} fantrax table check(s) failed`);
  process.exit(1);
}
console.log(`OK: fantrax table (pool ${realPool.counts.total} players, ${realPool.counts.prospects} prospects; filters, sorts, URL, extras)`);
