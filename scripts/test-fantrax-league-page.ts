/**
 * Unit checks for the Captains Dynasty pages: French copy and formatters,
 * the browser data helpers (team choice, URL, live cache) and the live
 * fxea overlay, which must reproduce the baked plan when fed the baked
 * rosters.
 * Run: npx tsx scripts/test-fantrax-league-page.ts
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { FxeaDraftResults, FxeaTeamRosters } from "../src/lib/fantrax/api-types";
import { FANTRAX_DEFAULT_TEAM_ID, NHL_SEASON_ID, SLOT_ORDER } from "../src/lib/fantrax/config";
import { buildDailyPlan, type DailyPlan, type PlanAlert } from "../src/lib/fantrax/daily-plan";
import { parseLiveCache, pickTeam, teamSearch } from "../src/lib/fantrax/league-client";
import {
  alertText,
  claimsText,
  draftBoardNote,
  draftVonaIntro,
  fmtAgo,
  fmtCalendarDay,
  fmtCountdown,
  fmtDateTime,
  fmtDay,
  fmtNum,
  fmtOdds,
  fmtPct,
  fmtShortCalendarDate,
  fmtSigned,
  fmtTime,
  fmtZone,
  gameLabel,
  gridDay,
  legalitySummary,
  moveEndLabel,
  ordinal,
  pickLabel,
  positionsLabel,
  SLOT_LABEL,
  statusLabel,
} from "../src/lib/fantrax/league-copy";
import {
  draftFromFxea,
  liveOverlay,
  recentPicks,
  rostersFromFxea,
  withLiveOverlay,
  type LiveOverlay,
} from "../src/lib/fantrax/live";
import type {
  LeagueSnapshot,
  ScheduleSnapshot,
  StateSnapshot,
  ValuesSnapshot,
} from "../src/lib/fantrax/snapshot-types";
import { fantraxDataHref } from "../src/lib/site";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const eq = (a: unknown, b: unknown, msg: string) =>
  assert(a === b, `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const NB = " ";

// ---- numbers
eq(fmtNum(3.714), "3,71", "decimal comma");
eq(fmtNum(-0.5, 1), "−0,5", "real minus sign");
eq(fmtNum(-0.001), "0,00", "no negative zero");
eq(fmtNum(Number.NaN), "—", "non-finite");
eq(fmtSigned(2.42), "+2,42", "signed positive");
eq(fmtSigned(-1), "−1,00", "signed negative");
eq(fmtPct(0.557), `56${NB}%`, "percent with French spacing");
eq(fmtOdds(0.557), `56${NB}%`, "odds as a percent");
eq(fmtOdds(0.996), `>${NB}99${NB}%`, "near-certain odds never read 100 %");
eq(fmtOdds(0.003), `<${NB}1${NB}%`, "tiny odds never read 0 %");
eq(fmtOdds(1), `100${NB}%`, "certain");
eq(fmtOdds(Number.NaN), "—", "missing odds");
eq(pickLabel(20), `n°${NB}20`, "pick number stays on one line");
eq(ordinal(1), "1re", "first");
eq(ordinal(2), "2e", "second");

// ---- dates (Eastern, DST-aware, no locale data)
eq(fmtTime("2026-09-29T21:00:00.000Z"), `17${NB}h`, "EDT lock time (no 00 on the hour)");
eq(fmtZone("2026-09-29T21:00:00.000Z"), "HAE", "summer zone");
eq(fmtTime("2026-11-02T00:00:00.000Z"), `19${NB}h`, "EST after DST ends");
eq(fmtZone("2026-11-02T00:00:00.000Z"), "HNE", "winter zone");
eq(fmtDay("2026-09-29T21:00:00.000Z"), `mar. 29${NB}sept.`, "weekday + day + month");
eq(fmtDay("2026-09-30T02:30:00Z"), `mar. 29${NB}sept.`, "late game stays on its Eastern day");
eq(fmtTime("2026-09-30T02:30:00Z"), `22${NB}h${NB}30`, "late game time");
eq(fmtTime("2026-10-01T04:05:00Z"), `0${NB}h${NB}05`, "midnight hour is 0, not 24");
eq(fmtCalendarDay("2026-10-12"), `lun. 12${NB}oct.`, "calendar day");
eq(fmtShortCalendarDate("2026-10-11"), `11${NB}oct.`, "short calendar date");
eq(JSON.stringify(gridDay("2026-10-01")), JSON.stringify({ day: "je", date: "1" }), "grid head");
assert(fmtDateTime("2026-09-25T14:27:31.200Z").endsWith(`10${NB}h${NB}27 (HAE)`), "date-time carries the zone, in parentheses");
const t0 = Date.parse("2026-09-25T10:00:00Z");
eq(fmtCountdown(t0 + (4 * 24 + 6) * 3_600_000 + 59_000, t0), `dans 4${NB}j 6${NB}h`, "days countdown");
eq(fmtCountdown(t0 + 125 * 60_000, t0), `dans 2${NB}h 05${NB}min`, "hours countdown");
eq(fmtCountdown(t0 + 12 * 60_000, t0), `dans 12${NB}min`, "minutes countdown");
eq(fmtCountdown(t0, t0), "verrouillé", "locked");
eq(fmtAgo(t0 - 17 * 60_000, t0), `il y a 17${NB}min`, "minutes ago");
eq(fmtAgo(t0 - 20_000, t0), "à l'instant", "just now");

// ---- words
for (const s of SLOT_ORDER) assert(!!SLOT_LABEL[s], `slot ${s} has a French label`);
eq(statusLabel("MINORS"), "Mineures", "minors label");
eq(moveEndLabel("RESERVE"), "Réserve", "reserve move end");
eq(moveEndLabel("W"), "W", "slot codes stay as Fantrax shows them");
eq(positionsLabel("W,C,F,Skt"), "W/C", "primary positions");
eq(positionsLabel("D,Skt"), "D", "defense");
eq(gameLabel(null), "Pas de match", "no game");
{
  const intro = draftVonaIntro(20, 27);
  assert(intro.includes(`n°${NB}20`) && intro.includes(`n°${NB}27`) && intro.includes("attendue"), "VONA intro names both picks");
  eq(draftVonaIntro(20, null), "Dernier choix : prenez simplement la meilleure valeur.", "last pick");
  const note = draftBoardNote(20, 27, 0.5);
  assert(
    note.includes(`au n°${NB}27`) && note.includes(`choix n°${NB}20`) && note.includes(`50${NB}%`) && note.includes("ADP"),
    "board note explains per-player VONA, the odds and the pool share",
  );
  const noPicks = draftBoardNote(null, null, 0.5);
  assert(!noPicks.includes("Dispo.") && !noPicks.includes("VONA"), "no picks left: value note only");
}
eq(gameLabel({ startUTC: "2026-09-30T02:30:00Z", opp: "VGK", home: false }), `@ VGK · 22${NB}h${NB}30`, "away game");
eq(gameLabel({ startUTC: "2026-09-29T21:00:00Z", opp: "FLA", home: true }), `vs FLA · 17${NB}h`, "home game");

const name = (id: string | null | undefined) => (id === "r" ? "Chase Reid" : "X");
const alert = (a: Partial<PlanAlert>) => alertText({ level: "warn", code: "empty-slot", ...a } as PlanAlert, name);
eq(alert({ slot: "C", count: 1 }), "1 poste C vide.", "one empty slot");
eq(alert({ slot: "D", count: 2 }), "2 postes D vides.", "two empty slots");
const deadAlert = (to: PlanAlert["to"]) =>
  alert({ code: "dead-active", ids: ["r"], slot: "D", detail: "minor-leagues", to }) ?? "";
assert(
  deadAlert("RESERVE").includes("Chase Reid") && deadAlert("RESERVE").includes("Mettez-le en réserve"),
  "dead player alert names him and keeps him counted when the roster needs him",
);
assert(deadAlert("MINORS").includes("Envoyez-le aux mineures"), "dead player sent down when there is a surplus");
assert(deadAlert("INJURED_RESERVE").includes("liste des blessés"), "injured dead player → IR");
assert(deadAlert(null).includes("Remplacez-le"), "no room anywhere → replace him");
assert(
  (alert({ code: "dead-active", ids: ["r"], slot: "W", detail: "inactive", to: "RESERVE" }) ?? "").includes("inactif"),
  "inactive reason worded",
);
eq(alert({ code: "illegal-roster" }), null, "illegal roster is worded by the summary");
for (const code of ["healthy-ir", "roster-limit", "over-max-after-moves", "fxpa-down", "stale-data"] as const) {
  assert(!!alert({ code, count: 40, limit: 20, ids: ["r"], detail: "too-many-active" }), `${code} has copy`);
}
const summary = legalitySummary({
  illegal: true,
  need: 4,
  minTotal: 15,
  counts: { active: 11, reserve: 0, ir: 1, minors: 29, counted: 11 },
});
assert(summary.startsWith("Alignement illégal") && summary.includes("11/15") && summary.includes("Il en manque 4"), "illegal summary");
assert(
  legalitySummary({ illegal: false, need: 0, minTotal: 15, counts: { active: 15, reserve: 2, ir: 0, minors: 3, counted: 17 } }).startsWith(
    "Alignement légal",
  ),
  "legal summary",
);
assert(claimsText(null, null).includes("inconnues"), "claims unknown without fxpa");
assert(claimsText(0, 5).includes("0/5") && claimsText(0, 5).includes("5 restantes"), "claims plural");
assert(claimsText(4, 1).includes("1 restante"), "claims singular");

// ---- browser helpers
const teams = [{ id: "a" }, { id: "b" }];
eq(pickTeam([null, "zzz", "b"], teams, "a"), "b", "first valid candidate wins");
eq(pickTeam([undefined], teams, "a"), "a", "fallback");
eq(teamSearch("", "b", "a"), "?team=b", "non-default team in the URL");
eq(teamSearch("?team=b", "a", "a"), "", "default team leaves a clean URL");
eq(teamSearch("?x=1", "b", "a"), "?x=1&team=b", "other params kept");

const overlay: LiveOverlay = {
  fetchedAt: new Date(t0).toISOString(),
  rosterPeriod: 3,
  rosters: { a: [{ id: "p", slot: "C", status: "ACTIVE" }] },
  draft: null,
  recent: [],
};
const raw = JSON.stringify(overlay);
assert(parseLiveCache(raw, t0 + 60_000, 3)?.rosterPeriod === 3, "fresh cache hit");
eq(parseLiveCache(raw, t0 + 10 * 60_000, 3), null, "stale cache ignored");
eq(parseLiveCache(raw, t0 + 60_000, 4), null, "other lineup period ignored");
eq(parseLiveCache("{not json", t0, 3), null, "garbage ignored");
eq(parseLiveCache(null, t0, 3), null, "empty storage");

const prevBase = process.env.NEXT_PUBLIC_BASE_PATH;
const prevBuild = process.env.NEXT_PUBLIC_BUILD_TIME;
process.env.NEXT_PUBLIC_BASE_PATH = "/fantasy-hockey-vor";
process.env.NEXT_PUBLIC_BUILD_TIME = "2026-09-25T15:00:00.000Z";
eq(
  fantraxDataHref("state.json"),
  "/fantasy-hockey-vor/fantrax/state.json?v=2026-09-25T15%3A00%3A00.000Z",
  "snapshot URL with basePath and cache buster",
);
delete process.env.NEXT_PUBLIC_BASE_PATH;
delete process.env.NEXT_PUBLIC_BUILD_TIME;
eq(fantraxDataHref("values.json"), "/fantrax/values.json", "snapshot URL locally");
if (prevBase !== undefined) process.env.NEXT_PUBLIC_BASE_PATH = prevBase;
if (prevBuild !== undefined) process.env.NEXT_PUBLIC_BUILD_TIME = prevBuild;

// ---- live overlay
const fxRosters: FxeaTeamRosters = {
  period: 2,
  rosters: {
    a: { teamName: "A", rosterItems: [{ id: "p1", position: "C", status: "ACTIVE" }, { id: "p2", position: "D", status: "MINORS" }] },
  },
};
const fxDraft: FxeaDraftResults = {
  draftState: "IN_PROGRESS",
  draftPicks: [
    { round: 1, pick: 1, pickInRound: 1, teamId: "a", time: 1_000, playerId: "p1" },
    { round: 1, pick: 2, pickInRound: 2, teamId: "b", time: 2_000, playerId: "p3" },
    { round: 1, pick: 3, pickInRound: 3, teamId: "a", time: 9_999 },
  ],
};
eq(JSON.stringify(rostersFromFxea(fxRosters).a?.[1]), JSON.stringify({ id: "p2", slot: "D", status: "MINORS" }), "roster item mapping");
const draft = draftFromFxea(fxDraft);
assert(draft.picks.length === 3 && !("playerId" in draft.picks[2]!), "open picks carry no playerId");
eq(recentPicks(fxDraft).map((p) => p.pick).join(","), "2,1", "recent picks newest first, made only");
eq(liveOverlay(fxRosters, null, t0, 9).rosterPeriod, 2, "overlay keeps the period fxea answered for");

const load = <T>(...parts: string[]) => JSON.parse(readFileSync(join(process.cwd(), ...parts), "utf8")) as T;
const state = load<StateSnapshot>("public", "fantrax", "state.json");
eq(withLiveOverlay(state, null), state, "no overlay = baked state");
const emptyLive: LiveOverlay = { ...overlay, rosters: {}, draft: null };
eq(withLiveOverlay(state, emptyLive).rosters, state.rosters, "empty live read keeps baked rosters");

// Feeding the baked rosters back as a live read must not change the plan.
const input = {
  league: load<LeagueSnapshot>("src", "data", "fantrax", "league.json"),
  values: load<ValuesSnapshot>("public", "fantrax", "values.json"),
  schedule: load<ScheduleSnapshot>("public", "fantrax", `schedule-${NHL_SEASON_ID}.json`),
  teamId: FANTRAX_DEFAULT_TEAM_ID,
  nowMs: Date.parse(state.fetchedAt),
};
const baked = buildDailyPlan({ ...input, state });
const roundTrip = buildDailyPlan({
  ...input,
  state: withLiveOverlay(state, {
    fetchedAt: state.fetchedAt,
    rosterPeriod: state.rosterPeriod,
    rosters: state.rosters,
    draft: state.draft,
    recent: [],
  }),
});
eq(JSON.stringify(roundTrip), JSON.stringify(baked), "live overlay of the baked rosters reproduces the plan");

// ---- page payload: the server-rendered plan stays small and nameless.
const today = load<DailyPlan>("src", "data", "fantrax", "today.json");
const todayText = JSON.stringify(today);
assert(todayText.length < 20_000, `today.json fits the page payload budget (${todayText.length} B)`);
assert(!/owner/i.test(todayText), "today.json carries no owner field");

// ---- page contracts (source-level, like check-ui-contracts): the pages are
// public, so noindex + their own canonical must never silently disappear.
const contracts: Record<string, string[]> = {
  // The old address: a static stub that forwards query and hash (?team=…).
  "src/app/league/page.tsx": ["<LegacyRedirect", "index: false", "canonical: target"],
  "src/app/ligues/[ligue]/[onglet]/page.tsx": ["generateStaticParams", "dynamicParams = false", "canonical: path"],
  "src/app/ligues/[ligue]/layout.tsx": ["generateStaticParams", "dynamicParams = false", "<LeagueShell"],
  // One French document language for the whole site (no per-page switching).
  "src/app/layout.tsx": ['lang="fr-CA"', "index: false"],
  "src/components/league-shell/server-adapters.tsx": ["initialPlan={fantraxToday}", "snakeFantraxSeed", "hasDynasty={hasDynasty}", '"dynasty.json"'],
  "src/components/fantrax/FantraxLeagueProvider.tsx": [
    "<Suspense",
    "useSearchParams",
    "History.prototype.replaceState",
    "setNowMs",
    "LIVE_DRAFT_POLL_MS",
    'document.visibilityState !== "visible"',
    "fetchLiveOverlay",
    "TabSearchContext.Provider",
    'SnakeVerdictsProvider kind="fx"',
    "hasDynasty",
  ],
  // Phones: the notices fold into a disclosure so each tab starts near the top.
  // The user's own team is marked, with a way back to it; the notices stay visible on phones.
  "src/components/fantrax/FantraxLeagueHeader.tsx": ["aria-busy={busy}", "SnakeDisclaimerShort", "chooseTeam", "(mon équipe)", "Revenir à mon équipe"],
  "src/components/fantrax/FantraxTodayTab.tsx": [
    'aria-label="Sections de la page"',
    'id: "alertes"',
    'id: "calendrier"',
    "<RosterAlerts",
    "<LineupCard",
    "<WeekGrid",
  ],
  // Each tab's table starts from its own view; best available never waits for pool.json.
  "src/components/fantrax/FantraxPlayersTab.tsx": ['base="tous"', "perPage={50}"],
  "src/components/fantrax/FantraxDraftTab.tsx": ["<DraftPanel", 'base="repechage"', 'fallback="draft"', "perPage={25}", "draftBoardNote", "compactFilters"],
  "src/components/fantrax/FantraxWaiversTab.tsx": ["<WaiverTargets", 'base="autonomes"', '"ballottage-ww"'],
  "src/components/fantrax/FantraxTeamTab.tsx": ['base="equipe"', 'fallback="team"', "legalitySummary"],
  // A `relative` scroller clips its absolutely positioned sr-only labels;
  // without it they widen the document on phones (page scrolls sideways).
  "src/components/fantrax/WeekGrid.tsx": ["relative -mx-4 overflow-x-auto"],
  "src/components/fantrax/DraftPanel.tsx": ["draftVonaIntro", "SnakeLeagueNote", "Derniers choix"],
  "src/components/fantrax/WaiverTargets.tsx": ["claimsText", "SnakeLeagueNote"],
  "src/lib/fantrax/league-client.ts": ["fetchSnapshotFile", "sessionStorage", '"fantrax-live:v1"', '"fantrax-team"'],
  // The snapshot files: no credentials, one retry, the build's cache buster.
  "src/lib/fantrax/snapshot-fetch.ts": ['credentials: "omit"', "attempt < 2", "fantraxDataHref"],
  // The player table's pool, once per page view; dynasty only when the build saw it.
  "src/lib/fantrax/pool-client.ts": ['fetchSnapshotFile<unknown>("pool.json")', 'fantraxDataHref("dynasty.json")', "peekFantraxPool"],
  // The tabs read the league through this context, never the provider's module.
  "src/components/fantrax/fantrax-league-context.ts": ["FantraxLeagueContext", "useFantraxLeague", "state: StateSnapshot | null"],
  // The player table: URL read inside Suspense (static export), native
  // history writes (no soft navigation), one polite count after the user's
  // own changes, its table scrolls inside its own box.
  "src/components/player-table/usePlayerTableView.tsx": ["<Suspense", "useSearchParams", "History.prototype.replaceState"],
  "src/components/player-table/useCountAnnouncer.tsx": ['role="status"'],
  "src/components/player-table/PlayerTable.tsx": ["IntersectionObserver", "fallbackRows"],
  // Pager buttons keep the focus on the first and last page.
  "src/components/player-table/PlayerTablePager.tsx": ["aria-disabled={page <= 1", "aria-disabled={page >= pages"],
  "src/components/player-table/PlayerTableGrid.tsx": [
    "relative -mx-4 overflow-x-auto",
    "aria-sort",
    'scope="row"',
    "<caption",
    // Label in name: the header reads « Joueur ».
    "sortButtonLabel(TABLE_COPY.player",
  ],
  "src/components/player-table/PlayerTableToolbar.tsx": [
    'role="search"',
    "aria-pressed",
    'autoComplete="off"',
    "data-1p-ignore",
    "aria-disabled={atBase",
  ],
  "src/components/fantrax/FantraxTableFilters.tsx": ["FilterUiProps", "{actions}", "aria-expanded={showMore}"],
};
for (const [rel, needles] of Object.entries(contracts)) {
  const text = readFileSync(join(process.cwd(), rel), "utf8");
  for (const n of needles) assert(text.includes(n), `${rel} keeps ${JSON.stringify(n)}`);
}
// The live status region must not carry the read time (the 90 s draft poll
// would re-announce it every time).
{
  const text = readFileSync(join(process.cwd(), "src/components/fantrax/FantraxLeagueHeader.tsx"), "utf8");
  const start = text.indexOf('<span aria-live="polite">');
  const end = text.indexOf("</span>", text.lastIndexOf("Lecture des effectifs en direct"));
  assert(start > 0 && end > start, "FantraxLeagueHeader has a live status span");
  assert(!/fmtTime|fetchedAt/.test(text.slice(start, end)), "live status region carries no timestamp");
  assert((text.match(/aria-live=/g) ?? []).length === 1, "one live region in the header");
}

// Every file of the site, recursively.
function walk(dir: string): string[] {
  return readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : [],
  );
}

// No page switches <html lang> any more: the root layout says fr-CA.
for (const rel of walk("src")) {
  const text = readFileSync(join(process.cwd(), rel), "utf8");
  assert(!text.includes("document.documentElement.lang"), `${rel} never switches the document language`);
}

// The browser only ever reads Fantrax with fxea GETs: no POST of any kind
// (fxpa has no CORS anyway, and nothing here may look like a write).
for (const rel of [
  ...walk("src/components/fantrax"),
  ...walk("src/components/league-shell"),
  ...walk("src/components/player-table"),
  ...walk("src/app/ligues"),
  "src/app/league/page.tsx",
  "src/lib/fantrax/league-client.ts",
  "src/lib/fantrax/pool-client.ts",
  "src/lib/fantrax/snapshot-fetch.ts",
  "src/lib/fantrax/table.ts",
]) {
  const text = readFileSync(join(process.cwd(), rel), "utf8");
  assert(!/fxeaPost|fxpaPost/.test(text), `${rel} never calls a Fantrax POST`);
}

if (failed > 0) {
  console.error(`\n${failed} league-page check(s) failed`);
  process.exit(1);
}
console.log("OK: fantrax league page (copy, client helpers, live overlay)");
