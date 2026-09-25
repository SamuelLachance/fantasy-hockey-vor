/**
 * Unit checks for the /league page layer: French copy and formatters,
 * the browser data helpers (team choice, URL, live cache) and the live
 * fxea overlay, which must reproduce the baked plan when fed the baked
 * rosters.
 * Run: npx tsx scripts/test-fantrax-league-page.ts
 */
import { readFileSync } from "fs";
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
eq(fmtTime("2026-09-29T21:00:00.000Z"), `17${NB}h${NB}00`, "EDT lock time");
eq(fmtZone("2026-09-29T21:00:00.000Z"), "HAE", "summer zone");
eq(fmtTime("2026-11-02T00:00:00.000Z"), `19${NB}h${NB}00`, "EST after DST ends");
eq(fmtZone("2026-11-02T00:00:00.000Z"), "HNE", "winter zone");
eq(fmtDay("2026-09-29T21:00:00.000Z"), `mar. 29${NB}sept.`, "weekday + day + month");
eq(fmtDay("2026-09-30T02:30:00Z"), `mar. 29${NB}sept.`, "late game stays on its Eastern day");
eq(fmtTime("2026-09-30T02:30:00Z"), `22${NB}h${NB}30`, "late game time");
eq(fmtTime("2026-10-01T04:05:00Z"), `0${NB}h${NB}05`, "midnight hour is 0, not 24");
eq(fmtCalendarDay("2026-10-12"), `lun. 12${NB}oct.`, "calendar day");
eq(fmtShortCalendarDate("2026-10-11"), `11${NB}oct.`, "short calendar date");
eq(JSON.stringify(gridDay("2026-10-01")), JSON.stringify({ day: "je", date: "1" }), "grid head");
assert(fmtDateTime("2026-09-25T14:27:31.200Z").endsWith("HAE"), "date-time carries the zone");
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
eq(gameLabel({ startUTC: "2026-09-29T21:00:00Z", opp: "FLA", home: true }), `vs FLA · 17${NB}h${NB}00`, "home game");

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

// ---- page contracts (source-level, like check-ui-contracts): the page is
// public, so noindex + its own canonical must never silently disappear.
const contracts: Record<string, string[]> = {
  "src/app/league/page.tsx": [
    'canonical: "/league"',
    "index: false",
    'lang="fr-CA"',
    "initialPlan",
    'document.documentElement.lang="fr-CA"',
    'card: "summary"',
  ],
  "src/app/league/loading.tsx": ['role="status"', 'lang="fr-CA"'],
  "src/components/league/LeagueDaily.tsx": [
    "<Suspense",
    "useSearchParams",
    "History.prototype.replaceState",
    "setNowMs",
    "aria-busy={busy}",
    'root.lang = "fr-CA"',
    "<PlayerExplorer",
    'id: "explorateur"',
    // The explorer waits for the panels above before watching the viewport.
    "armed={",
  ],
  // French page under the shared English root layout: switch lang before paint.
  "src/app/layout.tsx": ["suppressHydrationWarning"],
  // A `relative` scroller clips its absolutely positioned sr-only labels;
  // without it they widen the document on phones (page scrolls sideways).
  "src/components/league/WeekGrid.tsx": ["relative -mx-4 overflow-x-auto"],
  "src/components/league/DraftPanel.tsx": ["relative -mx-4 mt-2 overflow-x-auto", 'preset="repechage"'],
  "src/components/league/WaiverTargets.tsx": ['preset="autonomes"'],
  "src/lib/fantrax/league-client.ts": [
    'credentials: "omit"',
    "attempt < 2",
    "fantraxDataHref",
    "sessionStorage",
    'fetchSnapshotFile<unknown>("pool.json")',
    'fantraxDataHref("dynasty.json")',
    'publicDataHref("snake/index.json")',
    'publicDataHref("snake/fantrax.json")',
  ],
  // The explorer: URL read inside Suspense (static export), native history
  // writes (no soft navigation), its table scrolls inside its own box.
  "src/components/league/PlayerExplorer.tsx": [
    "<Suspense",
    "useSearchParams",
    "History.prototype.replaceState",
    "IntersectionObserver",
    'role="status"',
    'id="explorateur"',
    // Pager buttons keep the focus on the first and last page.
    "aria-disabled={page <= 1",
    "aria-disabled={page >= pages",
  ],
  "src/components/league/ExplorerTable.tsx": [
    "relative -mx-4 overflow-x-auto",
    "aria-sort",
    'scope="row"',
    "<caption",
    // Label in name: the header reads « Joueur ».
    'sortButtonLabel("Joueur"',
  ],
  "src/components/league/ExplorerFilters.tsx": [
    'role="search"',
    "aria-pressed",
    'autoComplete="off"',
    "data-1p-ignore",
    "aria-disabled={atDefaults",
  ],
};
for (const [rel, needles] of Object.entries(contracts)) {
  const text = readFileSync(join(process.cwd(), rel), "utf8");
  for (const n of needles) assert(text.includes(n), `${rel} keeps ${JSON.stringify(n)}`);
}
// The live status region must not carry the read time (the 90 s draft poll
// would re-announce it every time).
{
  const text = readFileSync(join(process.cwd(), "src/components/league/LeagueDaily.tsx"), "utf8");
  const start = text.indexOf('<span aria-live="polite">');
  const end = text.indexOf("</span>", text.lastIndexOf("Lecture des effectifs en direct"));
  assert(start > 0 && end > start, "LeagueDaily has a live status span");
  assert(!/fmtTime|fetchedAt/.test(text.slice(start, end)), "live status region carries no timestamp");
  assert((text.match(/aria-live=/g) ?? []).length === 1, "one live region in the header");
}

// The browser only ever reads Fantrax with fxea GETs: no POST of any kind
// (fxpa has no CORS anyway, and nothing here may look like a write).
for (const rel of [
  "src/components/league/LeagueDaily.tsx",
  "src/components/league/PlayerExplorer.tsx",
  "src/app/league/page.tsx",
  "src/lib/fantrax/league-client.ts",
  "src/lib/fantrax/explorer.ts",
]) {
  const text = readFileSync(join(process.cwd(), rel), "utf8");
  assert(!/fxeaPost|fxpaPost/.test(text), `${rel} never calls a Fantrax POST`);
}

if (failed > 0) {
  console.error(`\n${failed} league-page check(s) failed`);
  process.exit(1);
}
console.log("OK: fantrax league page (copy, client helpers, live overlay)");
