/**
 * Unit checks for a categories league's whole player list: the NHL lists
 * snapshot (parse, merge, shape guard), the pool built with the board
 * (every projected player once, board + pool ranks 1..N, hand moves still
 * on the board, current clubs from rosters only, the unprojected), the
 * committed pool.json merged with the board in the browser (order, the
 * « pas de projection » rows, Snake's verdicts), the table over everyone
 * (sorts put the unprojected last, the projection filter, the VOR range,
 * the URL), naming a « hors liste » pick, my picks found in the pool, and
 * speed.
 * Run: npx tsx scripts/test-league-pool.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { draftRows } from "../src/lib/draft/board-filter";
import type { DraftBoard, LeaguePool } from "../src/lib/draft/board-types";
import { EMPTY_DRAFT_STATE, markPick, setDraftSlot, setPickPlayer, UNLISTED_PLAYER_ID, type DraftState } from "../src/lib/draft/draft-state";
import { isLeaguePool, leaguePlayers, leaguePoolCounts, leagueSnakeRows, unprojectedRow } from "../src/lib/draft/league-pool";
import { suggestPicks } from "../src/lib/draft/suggestions";
import {
  buildCategoryRows,
  CATEGORY_FILTERS,
  categoryCell,
  categoryTable,
  DEFAULT_CATEGORY_FILTERS,
  noProjectionLabel,
  noProjectionTag,
  type CategoryCtx,
  type CategoryRow,
} from "../src/lib/draft/table";
import { loadBoardInputs } from "../src/lib/leagues/board-inputs";
import { buildLeagueBoard, serializePool } from "../src/lib/leagues/league-board";
import {
  mergeNhlLists,
  nhlCodePosition,
  nhlRostersErrors,
  parseNhlList,
  parseNhlSearchIndex,
  THIN_PROSPECT_LIST,
  thinProspectClubs,
  type NhlRostersFile,
} from "../src/lib/nhl-rosters";
import { filterRows, sortRows, tableBase } from "../src/lib/player-table/model";
import { parseView, viewParams } from "../src/lib/player-table/url";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const eq = (a: unknown, b: unknown, msg: string) =>
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const dir = join(process.cwd(), "public", "leagues", "light-the-lamp");
const board = JSON.parse(readFileSync(join(dir, "board.json"), "utf8")) as DraftBoard;
const poolRaw: unknown = JSON.parse(readFileSync(join(dir, "pool.json"), "utf8"));

// ------------------------------------------------------------ NHL lists snapshot

{
  const raw = {
    forwards: [
      { id: 10, firstName: { default: "Ivan" }, lastName: { default: "Demidov" }, positionCode: "R", birthDate: "2006-01-10" },
      { id: 11, firstName: { default: "No" }, lastName: { default: "Position" }, positionCode: "X" },
      { id: "12", firstName: { default: "Bad" }, lastName: { default: "Id" }, positionCode: "C" },
    ],
    defensemen: [{ id: 13, firstName: { default: "Lane" }, lastName: { default: "Hutson" }, positionCode: "D", birthDate: "bad" }],
    goalies: [{ id: 14, firstName: { default: "Jakub" }, lastName: { default: "Dobeš" }, positionCode: "G" }],
  };
  const rows = parseNhlList(raw, "MTL", "roster");
  eq(rows.map((r) => r.id), [10, 13, 14], "malformed list rows skipped");
  eq(rows[0], { id: 10, name: "Ivan Demidov", team: "MTL", code: "R", birthDate: "2006-01-10", list: "roster" }, "compact row");
  eq(rows[1]!.birthDate, null, "a malformed birth date is dropped");
  eq(parseNhlList(null, "MTL", "roster"), [], "an empty body is an empty list");
  eq([nhlCodePosition("L"), nhlCodePosition("R"), nhlCodePosition("C"), nhlCodePosition("D"), nhlCodePosition("G")], ["LW", "RW", "C", "D", "G"], "NHL codes");

  const prospect = { id: 10, name: "Ivan Demidov", team: "MTL", code: "R" as const, birthDate: null, list: "prospect" as const };
  const merged = mergeNhlLists([[prospect], rows, [{ ...prospect, id: 20, team: "BOS" }, { ...prospect, id: 20, team: "ANA" }]]);
  eq(merged.find((p) => p.id === 10)!.list, "roster", "a roster spot wins over a prospect list");
  eq(merged.find((p) => p.id === 20)!.team, "ANA", "two clubs: the first alphabetically");
  eq(merged.map((p) => p.id), [10, 13, 14, 20], "sorted by id, one row each");

  const file: NhlRostersFile = { schema: 1, fetchedAt: "2026-09-27T00:00:00Z", source: "t", counts: { roster: 3, prospect: 1 }, players: merged };
  eq(nhlRostersErrors(file, 3), [], "valid snapshot");
  assert(nhlRostersErrors(file, 600).some((e) => e.includes("only 3")), "a half-fetched snapshot is refused");
  assert(nhlRostersErrors({ ...file, players: [...merged, merged[0]!] }, 3).some((e) => e.includes("duplicate")), "duplicates refused");
  assert(nhlRostersErrors({ ...file, players: [{ ...merged[0]!, team: "XYZ" }] }, 0).some((e) => e.includes("team")), "unknown club refused");

  // The search index: everyone the NHL ties to a club (it fills the empty prospect lists).
  const index = [
    { playerId: "8485387", name: "Caleb  Desnoyers", positionCode: "C", teamAbbrev: "UTA", active: true },
    { playerId: 8484795, name: "Tij Iginla", positionCode: "C", teamAbbrev: "UTA", active: false },
    { playerId: "8470000", name: "Retraité", positionCode: "D", teamAbbrev: null, lastTeamAbbrev: "MTL" },
    { playerId: "8470001", name: "Ancien club", positionCode: "D", teamAbbrev: "ARI" },
    { playerId: "x", name: "Bad Id", positionCode: "C", teamAbbrev: "MTL" },
    { playerId: "8470002", name: "Bad Code", positionCode: "F", teamAbbrev: "MTL" },
    { playerId: "10", name: "Ivan Demidov", positionCode: "R", teamAbbrev: "MTL" },
    null,
  ];
  const org = parseNhlSearchIndex(index);
  eq(
    org,
    [
      { id: 8485387, name: "Caleb Desnoyers", team: "UTA", code: "C", birthDate: null, list: "org" },
      { id: 8484795, name: "Tij Iginla", team: "UTA", code: "C", birthDate: null, list: "org" },
      { id: 10, name: "Ivan Demidov", team: "MTL", code: "R", birthDate: null, list: "org" },
    ],
    "index rows: a current club only, malformed entries skipped",
  );
  eq(parseNhlSearchIndex({ error: "x" }), [], "an index error body is no row");
  const withOrg = mergeNhlLists([org, [prospect], rows]);
  eq(withOrg.find((p) => p.id === 10)!.list, "roster", "a roster spot wins over the index");
  eq(mergeNhlLists([org, [{ ...prospect, id: 8484795, team: "UTA" }]]).find((p) => p.id === 8484795)!.list, "prospect", "a prospect list wins over the index");
  eq(withOrg.filter((p) => p.list === "org").map((p) => p.id), [8484795, 8485387], "index-only players kept as « org »");
  assert(nhlRostersErrors({ ...file, players: withOrg }, 1).length === 0, "an « org » row is a valid snapshot row");
  const thin = thinProspectClubs([...Array.from({ length: THIN_PROSPECT_LIST }, (_, i) => ({ ...prospect, id: 100 + i, team: "MTL" })), { ...prospect, id: 99, team: "DET" }]);
  assert(!thin.includes("MTL") && thin.includes("DET") && thin.includes("UTA"), "thin prospect lists: DET (1) and UTA (0), not MTL");
}

// ------------------------------------------------------------ the pool built with the board

const inputs = loadBoardInputs("light-the-lamp");
const built = buildLeagueBoard(inputs);
{
  const { board: b, pool, vor } = built;
  const all = [...b.players, ...pool.players];
  eq(new Set(all.map((p) => p.id)).size, vor.players.length, "every projected player once, board or pool");
  eq(
    all.map((p) => p.rank).sort((x, y) => x - y),
    vor.players.map((_, i) => i + 1),
    "board + pool ranks = 1..N",
  );
  assert(pool.players.every((p, i) => i === 0 || pool.players[i - 1]!.rank < p.rank), "pool in rank order");
  assert(pool.players.every((p) => !p.adjusted), "hand moves stay on the board");
  eq(b.players.filter((p) => p.adjusted).length, inputs.rankAdjustments?.adjustments.length ?? 0, "every hand move applied");
  assert(pool.players.every((p) => p.rank > 400), "the pool starts past the board's depth");
  const ids = new Set(all.map((p) => p.id));
  assert(pool.unprojected.every((u) => !ids.has(u.id)), "the unprojected have no projection");
  const unprojectedIds = new Set(pool.unprojected.map((u) => u.id));
  const unlisted = (inputs.nhlRosters?.players ?? []).filter((r) => !ids.has(r.id) && !unprojectedIds.has(r.id));
  eq(unlisted.map((r) => `${r.name} (${r.list})`), [], "every player the NHL ties to a club is listed");
  const order = pool.unprojected.map((u) => u.noProj);
  const rankOf = { roster: 0, prospect: 1, org: 2 } as const;
  assert(order.every((k, i) => i === 0 || rankOf[order[i - 1]!] <= rankOf[k]), "roster players, then prospect lists, then the rest of the organisations");
  assert(order.includes("org"), "the organisations' players (search index) are in the pool");

  // A hand move on a player past the board pulls him onto it (the pool keeps 1..N without him).
  const deep = pool.players[60]!;
  const adjustments = inputs.rankAdjustments ?? { schema: 1 as const, league: "light-the-lamp", decidedAt: "2026-09-27", adjustments: [] };
  const pulled = buildLeagueBoard({
    ...inputs,
    rankAdjustments: {
      ...adjustments,
      adjustments: [...adjustments.adjustments, { id: deep.id, name: deep.name, engineRank: deep.rank, insertAt: 150, reason: "Test" }],
    },
  });
  const onBoard = pulled.board.players.find((p) => p.id === deep.id);
  assert(!!onBoard?.adjusted && onBoard.rank < 200 && onBoard.adjusted.fromRank === deep.rank, `${deep.name} (engine ${deep.rank}) moved up on the board`);
  assert(!pulled.pool.players.some((p) => p.id === deep.id), "no longer in the pool");
  eq(pulled.adjustmentsMissing, [], "no move skipped");
  eq(
    [...pulled.board.players, ...pulled.pool.players].map((p) => p.rank).sort((x, y) => x - y),
    vor.players.map((_, i) => i + 1),
    "board + pool ranks still 1..N",
  );

  // Current club: a roster spot moves the club, a prospect list never does; no snapshot, no unprojected.
  const someone = b.players[10]!;
  const nhlRosters: NhlRostersFile = {
    schema: 1,
    fetchedAt: "2026-09-27T00:00:00Z",
    source: "test",
    counts: { roster: 2, prospect: 1 },
    players: [
      { id: someone.id, name: someone.name, team: someone.team === "MTL" ? "BOS" : "MTL", code: "C", birthDate: null, list: "roster" },
      { id: b.players[11]!.id, name: b.players[11]!.name, team: "SEA", code: "C", birthDate: null, list: "prospect" },
      { id: 9_999_001, name: "Recrue Test", team: "UTA", code: "L", birthDate: "2007-03-01", list: "roster" },
    ],
  };
  const moved = buildLeagueBoard({ ...inputs, nhlRosters, rankAdjustments: null });
  const plain = buildLeagueBoard({ ...inputs, nhlRosters: null, rankAdjustments: null });
  const at = (x: DraftBoard, id: number) => x.players.find((p) => p.id === id)!;
  eq(at(moved.board, someone.id).team, nhlRosters.players[0]!.team, "roster club wins");
  eq(at(moved.board, b.players[11]!.id).team, at(plain.board, b.players[11]!.id).team, "a prospect list never moves a club");
  eq(moved.teamChanges.size, 1, "one club change reported");
  eq(moved.pool.unprojected, [{ id: 9_999_001, name: "Recrue Test", team: "UTA", pos: ["LW"], age: 19, noProj: "roster" }], "the unprojected rookie");
  eq(plain.pool.unprojected, [], "no snapshot: no unprojected player");
  eq(plain.pool.rostersFetchedAt, null, "no snapshot date");
  const { team: _t1, ...movedRow } = at(moved.board, someone.id);
  const { team: _t2, ...plainRow } = at(plain.board, someone.id);
  eq(movedRow, plainRow, "the club is display only (same values and ranks)");

  eq(serializePool(built.pool), readFileSync(join(dir, "pool.json"), "utf8").replace(/\r\n/g, "\n"), "committed pool.json = its inputs (run npm run draft:board)");
}

// ------------------------------------------------------------ the committed pool in the browser

assert(isLeaguePool(poolRaw, "light-the-lamp"), "committed pool.json passes the browser's check");
assert(!isLeaguePool(poolRaw, "other-league"), "another league's pool is refused");
assert(!isLeaguePool({ schema: 1, slug: "light-the-lamp" }, "light-the-lamp"), "a truncated pool is refused");
assert(!isLeaguePool("<!doctype html>", "light-the-lamp"), "a 404 page is refused");
const pool = poolRaw as LeaguePool;
const everyone = leaguePlayers(board, pool);
const byName = (name: string) => everyone.find((p) => p.name === name);
{
  eq(everyone.length, board.players.length + pool.players.length + pool.unprojected.length, "board + pool + unprojected");
  assert(leaguePlayers(board, pool) === everyone, "merged once per board and pool");
  assert(leaguePlayers(board, null) === board.players, "no pool: the board");
  assert(everyone.every((p, i) => i === 0 || everyone[i - 1]!.rank < p.rank), "rank order, unprojected last");
  const firstNoProj = everyone.findIndex((p) => p.noProj);
  assert(firstNoProj === board.players.length + pool.players.length, "every projected player before the unprojected");
  assert(everyone.slice(0, firstNoProj).every((p, i) => p.rank === i + 1), "projected ranks 1..N");
  eq(everyone.slice(0, board.players.length).length, board.players.length, "board rows kept");
  const landeskog = byName("Gabriel Landeskog");
  assert(!!landeskog?.adjusted && landeskog.rank > landeskog.adjusted.fromRank, "hand moves survive the merge");

  // The players the league was missing (brief, 2026-09-27).
  for (const name of ["Max Domi", "Brett Howden", "Mavrik Bourque", "Oliver Kapanen", "Sean Couturier", "Taylor Hall", "Mikael Backlund"]) {
    const p = byName(name);
    assert(!!p && !p.noProj && p.rank > 400 && p.proj.length === board.categories.skater.length, `${name} is listed with his projection`);
  }
  // Thin NHL prospect lists (DET, UTA, VAN empty in September 2026): the search index fills them.
  for (const name of ["Carter Bear", "Trey Augustine", "Tij Iginla", "Caleb Desnoyers", "Ben Danford", "Cole Eiserman", "Kashawn Aitcheson"]) {
    assert(!!byName(name), `${name} is listed`);
  }
  // Every NHL roster player is projected since 2026-10 (npm run
  // collect:missing, check:preseason): Belzile, unprojected in September,
  // is listed with his projection; the unprojected are prospects and the
  // rest of the organisations.
  const belzile = byName("Alex Belzile");
  assert(!!belzile && !belzile.noProj && belzile.team === "MTL", "Alex Belzile: on the MTL roster, projected");
  assert(!everyone.some((p) => p.noProj === "roster"), "no roster player without a projection");

  // Page + pool from two builds: a player on both is listed once (the board's row).
  const dup: LeaguePool = { ...pool, players: [{ ...board.players[0]!, rank: 99_999 }, ...pool.players] };
  const merged = leaguePlayers(board, dup);
  eq(merged.filter((p) => p.id === board.players[0]!.id).length, 1, "no player twice");
  eq(merged.find((p) => p.id === board.players[0]!.id)!.rank, board.players[0]!.rank, "the page's row wins");

  const u = unprojectedRow({ id: 1, name: "X", team: "MTL", pos: ["C", "LW"], age: null, noProj: "prospect" }, 5000);
  eq([u.vorPos, u.proj, u.z, u.rank, u.noProj, u.adp], ["C", [], [], 5000, "prospect", null], "unprojected row shape");

  const counts = leaguePoolCounts(board, pool);
  eq(counts.total, everyone.length, "counts add up");
  eq(counts.projected, board.players.length + pool.players.length, "projected count");
  eq(counts.unprojected, pool.unprojected.length, "unprojected count");
  eq(counts.roster + counts.prospect + counts.org, counts.unprojected, "roster + prospect + org");
  eq(
    leaguePoolCounts(board, null),
    { projected: board.players.length, roster: 0, prospect: 0, org: 0, unprojected: 0, total: board.players.length },
    "no pool: the board",
  );

  // Snake: the seed keeps its entries, the pool adds the rest.
  const poolId = Object.keys(pool.snake)[0];
  assert(!!poolId, "the pool carries Snake verdicts");
  const seed = { "1": ["k", "positif", "stable", 0] as [string, "positif", "stable", 0] };
  const rows = leagueSnakeRows(seed, pool)!;
  assert(rows["1"] === seed["1"] && !!rows[poolId!], "seed + pool verdicts");
  assert(leagueSnakeRows(seed, null) === seed, "no pool: the seed");
}

// ------------------------------------------------------------ the table over everyone

const spec = categoryTable(board);
const ctx: CategoryCtx = {
  rankPos: "ALL",
  done: true,
  oddsPick: null,
  skaterCategories: board.categories.skater,
  goalieCategories: board.categories.goalie,
};
const state0 = setDraftSlot(EMPTY_DRAFT_STATE, 12, board.league.teams);
const rows: CategoryRow[] = buildCategoryRows(board, { state: state0, currentPick: 217, oddsPick: null, snake: leagueSnakeRows({}, pool) }, everyone);
{
  eq(rows.length, everyone.length, "one row per player");
  const noProj = rows.filter((r) => r.noProj);
  assert(noProj.length === pool.unprojected.length && noProj.every((r) => r.zRel.length === 0 && r.available === null), "unprojected rows");
  const cats = [...board.categories.skater, ...board.categories.goalie];
  assert(noProj.every((r) => cats.every((c) => categoryCell(board, r, c) === null)), "no category cell without a projection");
  eq(
    [noProjectionLabel("roster"), noProjectionLabel("prospect"), noProjectionLabel("org")],
    ["Pas de projection", "Espoir sans projection", "Hors effectif, sans projection"],
    "labels",
  );
  eq([noProjectionTag("roster"), noProjectionTag("prospect"), noProjectionTag("org")], ["Pas de projection", "Espoir", "Hors effectif"], "tags");

  const tail = (key: string, dir: "asc" | "desc") => {
    const sorted = sortRows(spec, rows, { key, dir }, ctx);
    const first = sorted.findIndex((r) => r.noProj);
    return first >= 0 && sorted.slice(first).every((r) => r.noProj);
  };
  for (const key of ["rang", "vor", "valeur", "gp", "z-b"]) {
    const k = spec.columns.some((c) => c.key === key) ? key : spec.columns.find((c) => c.key.startsWith("z-"))!.key;
    assert(tail(k, "asc") && tail(k, "desc"), `sort by ${k}: the unprojected last either way`);
  }
  const byRank = sortRows(spec, rows, { key: "rang", dir: "asc" }, ctx);
  eq(byRank.slice(0, 5).map((r) => r.rank), [1, 2, 3, 4, 5], "rank sort starts at 1");
  assert(sortRows(spec, rows, { key: "vor", dir: "desc" }, ctx)[0]!.rank === 1, "VOR sort: the best first");

  const f = (patch: Partial<typeof DEFAULT_CATEGORY_FILTERS>) => filterRows(spec, rows, { ...DEFAULT_CATEGORY_FILTERS, ...patch }, ctx);
  eq(f({ proj: "sans" }).length, pool.unprojected.length, "projection: without");
  eq(f({ proj: "avec" }).length, rows.length - pool.unprojected.length, "projection: with");
  assert(f({ vor: { min: null, max: 0 } }).every((r) => !r.noProj), "a VOR range leaves the unprojected out");
  assert(f({ q: "domi" }).some((r) => r.name === "Max Domi"), "search finds a pool player");
  assert(f({ q: "belzile" }).some((r) => r.name === "Alex Belzile"), "search finds a call-up");
  const unprojected = everyone.find((p) => p.noProj)!;
  assert(f({ q: unprojected.name }).some((r) => r.id === unprojected.id), "search finds an unprojected player");
  assert(f({ pos: "G" }).length > board.players.filter((p) => p.pos.includes("G")).length, "goalies past the board listed");

  // URL: projection=sans|avec round-trips; junk falls back to the base.
  const base = tableBase(spec, "tous", { odds: false, done: true, snake: true }, 50);
  const v = parseView(spec, "?projection=sans", base);
  eq(v.filters.proj, "sans", "projection param read");
  eq(viewParams(spec, v, base), [["projection", "sans"]], "projection param written");
  eq(parseView(spec, "?projection=peut-etre", base).filters.proj, "", "unknown projection value ignored");
  assert(CATEGORY_FILTERS.params.includes("projection"), "param owned");
}

// ------------------------------------------------------------ draft helper and Mon équipe over everyone

{
  const domi = byName("Max Domi")!;
  const kapanen = byName("Oliver Kapanen")!;
  const rookie = everyone.find((p) => p.noProj)!;
  let s: DraftState = setDraftSlot(EMPTY_DRAFT_STATE, 1, board.league.teams);
  s = markPick(s, board.players[0]!.id, true);
  s = markPick(s, UNLISTED_PLAYER_ID, false);
  s = markPick(s, UNLISTED_PLAYER_ID, true);
  s = markPick(s, rookie.id, true);

  // Naming a « hors liste » pick: same number and owner; only unlisted picks, only undrafted players.
  const named = setPickPlayer(s, 2, domi.id);
  eq(named.picks[2], { id: domi.id, mine: true }, "the unlisted pick is named");
  eq(named.picks.length, s.picks.length, "no pick added or removed");
  assert(setPickPlayer(s, 0, domi.id) === s, "a listed pick is not renamed");
  assert(setPickPlayer(named, 1, domi.id) === named, "a drafted player cannot be named twice");
  assert(setPickPlayer(s, 9, domi.id) === s && setPickPlayer(s, 1, 0) === s, "bad index or id: unchanged");

  // The helper's list holds everyone; a pool player is searchable and markable.
  const list = draftRows(everyone, named, { filter: "ALL", query: "kapanen", showDrafted: false });
  assert(list.some((r) => r.player.id === kapanen.id), "helper search finds a pool player");

  // My picks are found in the pool; a pick without a projection is never seated.
  const lookup = new Map(everyone.map((p) => [p.id, p]));
  const seated = (st: DraftState, m: ReadonlyMap<number, (typeof everyone)[number]> | null) => {
    const l = suggestPicks(board, st, 5, m).lineup;
    return [...Object.values(l.starters).flat(), ...l.bench, ...l.overflow].map((p) => p.id);
  };
  assert(seated(named, lookup).includes(domi.id), "a pool pick is in my lineup");
  assert(!seated(named, null).includes(domi.id), "board-only lookup misses him (the old behaviour)");
  assert(!seated(named, lookup).includes(rookie.id), "no projection: not seated");
}

// ------------------------------------------------------------ speed

{
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) buildCategoryRows(board, { state: state0, currentPick: 217, oddsPick: null, snake: null }, everyone);
  const per = (performance.now() - t0) / 5;
  assert(per <= 80, `buildCategoryRows (${everyone.length}) in ${per.toFixed(1)} ms ≤ 80`);
  const t1 = performance.now();
  for (const q of ["d", "do", "dom", "domi", "m", "ma", "mav"]) draftRows(everyone, state0, { filter: "ALL", query: q, showDrafted: false });
  const perKey = (performance.now() - t1) / 7;
  assert(perKey <= 20, `helper search over ${everyone.length} players in ${perKey.toFixed(1)} ms per keystroke ≤ 20`);
}

if (failed > 0) {
  console.error(`\n${failed} league pool check(s) failed`);
  process.exit(1);
}
console.log(`OK: league pool (NHL lists, pool build, merge, table over ${everyone.length} players, hors-liste naming, speed)`);
