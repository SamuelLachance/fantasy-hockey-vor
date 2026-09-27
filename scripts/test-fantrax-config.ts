/**
 * Unit checks for the per-league Fantrax config and its wiring to the league
 * registry.
 *
 * Two jobs:
 *  1. Pin the Captains Dynasty entry. Its ids, slot table, limits, cadence,
 *     features and — above all — its FILE PATHS are the ones that shipped
 *     before the config became per-league. The published files under
 *     `public/fantrax/` are fetched at runtime by pages already open and by
 *     cached bundles, so a moved path is a broken live session; this test
 *     fails if anything moves.
 *  2. Pin the Slapshot entry and prove the engine really is parameterised
 *     by it: 32 teams, C4 LW4 RW4 D6 G2 with LW and RW apart, no captain,
 *     no minors, no games caps, no keeper model, fxpa closed, 84 two-day
 *     matchups, and a scoring table whose per-slot zeros are the rule. Every
 *     value comes from the exported config, so a change to the real league's
 *     settings has to come through here.
 *
 * Run: npx tsx scripts/test-fantrax-config.ts
 */
import { existsSync } from "fs";
import {
  CAPTAINS_DYNASTY,
  CLAIMS_PER_WEEK,
  DEFAULT_FANTRAX_SLUG,
  DEFAULT_ROSTER_LIMITS,
  DEFAULT_SLOT_COUNTS,
  D_IN_SKT_FALLBACK,
  FANTRAX_DEFAULT_TEAM_ID,
  FANTRAX_LEAGUES,
  FANTRAX_LEAGUE_ID,
  FANTRAX_SEASON_CODE,
  FANTRAX_GROUPS,
  FANTRAX_SLUGS,
  LEAGUE_TIME_ZONE,
  NHL_SEASON_ID,
  SLAPSHOT,
  SLOT_ORDER,
  fantraxLeague,
  fantraxPublicFile,
  fantraxScheduleFile,
  eligibleGroups,
  parseGroups,
  slotTokens,
  type FantraxLeagueConfig,
} from "../src/lib/fantrax/config";
import { claimWeekStart } from "../src/lib/fantrax/dates";
import { SLOT_LABEL } from "../src/lib/fantrax/league-copy";
import { eligibleSlots, optimizeLineup, type LineupCandidate } from "../src/lib/fantrax/lineup";
import { evaluateRoster } from "../src/lib/fantrax/roster-rules";
import {
  categoryPoints,
  deadCategories,
  parseScoringCategories,
  parsePointsString,
  scoringShape,
  scoringTableFromInfo,
  skaterComponents,
  unmodeledSlots,
  unscoredCategories,
} from "../src/lib/fantrax/scoring";
import { LEAGUES, getLeague } from "../src/lib/leagues/registry";
import { dynastyPaths } from "./dynasty-inputs";
import { fantraxLeagueFromArgs, fantraxPaths } from "./fantrax-paths";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const eq = (a: unknown, b: unknown, msg: string) =>
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
function throws(fn: () => unknown, msg: string) {
  try {
    fn();
  } catch {
    return;
  }
  assert(false, `${msg} (nothing thrown)`);
}
const ROOT = process.cwd();
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

// ---------------------------------------------------- 1. Captains, pinned
{
  const c = fantraxLeague("captains-dynasty");
  assert(c === CAPTAINS_DYNASTY, "fantraxLeague returns the same object as the named export");
  eq(DEFAULT_FANTRAX_SLUG, "captains-dynasty", "the default league is Captains");
  eq(fantraxLeague(), CAPTAINS_DYNASTY, "no slug = the default league");
  throws(() => fantraxLeague("slapshot-not-registered"), "an unknown slug throws instead of falling back");

  // The values that shipped, written out again so a silent edit cannot pass.
  eq(c.leagueId, "aurcivgfmo2zpwm7", "Captains leagueId");
  eq(c.defaultTeamId, "kgy7gzd8mo2zpwmj", "Captains team (Quebec Trashers)");
  eq(c.teams, 16, "Captains team count");
  eq(c.seasonCode, "31n", "Captains Fantrax season code");
  eq(c.nhlSeasonId, 20262027, "Captains NHL season");
  eq(c.timeZone, "America/Toronto", "Captains time zone");
  eq(c.slots.order, ["C", "W", "F", "D", "Skt", "G"], "Captains slot order");
  eq(c.slots.counts, { C: 3, W: 5, F: 1, D: 3, Skt: 1, G: 2 }, "Captains slot counts");
  eq(c.limits, { minTotal: 15, maxActive: 15, maxReserve: 5, maxIr: 6, maxMinors: 35, healthyIrGracePeriods: 2 }, "Captains roster limits");
  eq(c.cadence, { scoringPeriods: 24, rosterPeriods: 188, scoringPeriodDays: 7, claimWeekStartsOn: 1 }, "Captains cadence");
  eq(c.features, { captainSlot: true, minors: true, gamesCaps: true, dynasty: true, fxpa: true, claimsPerWeek: 5 }, "Captains features");
  eq(c.scoringSource, "settings", "Captains reads scoringCategorySettings (its zero rows are redundant)");
  eq(c.dInSkt, "default", "Captains D-in-Skt fallback");
  eq(c.slots.counts.C! + c.slots.counts.W! + c.slots.counts.F! + c.slots.counts.D! + c.slots.counts.Skt! + c.slots.counts.G!, c.limits.maxActive, "Captains slots add up to maxActive");

  // The legacy exports are the same values, so every old importer is unaffected.
  eq(FANTRAX_LEAGUE_ID, c.leagueId, "FANTRAX_LEAGUE_ID");
  eq(FANTRAX_DEFAULT_TEAM_ID, c.defaultTeamId, "FANTRAX_DEFAULT_TEAM_ID");
  eq(FANTRAX_SEASON_CODE, c.seasonCode, "FANTRAX_SEASON_CODE");
  eq(NHL_SEASON_ID, c.nhlSeasonId, "NHL_SEASON_ID");
  eq(LEAGUE_TIME_ZONE, c.timeZone, "LEAGUE_TIME_ZONE");
  eq(SLOT_ORDER, c.slots.order, "SLOT_ORDER");
  eq(DEFAULT_SLOT_COUNTS, c.slots.counts, "DEFAULT_SLOT_COUNTS");
  eq(DEFAULT_ROSTER_LIMITS, c.limits, "DEFAULT_ROSTER_LIMITS");
  eq(CLAIMS_PER_WEEK, 5, "CLAIMS_PER_WEEK");
  eq(D_IN_SKT_FALLBACK, c.dInSkt, "D_IN_SKT_FALLBACK");
}

// ---- Captains file paths: unchanged, and pointing at files that exist
{
  const c = CAPTAINS_DYNASTY;
  eq(c.paths, { data: "src/data/fantrax", public: "public/fantrax", href: "" }, "Captains keeps the flat historical layout");
  const p = fantraxPaths(c, ROOT);
  const rel = (abs: string) => abs.slice(ROOT.length + 1).split(/[\\/]/).join("/");
  eq(rel(p.league), "src/data/fantrax/league.json", "league.json path");
  eq(rel(p.nhlIds), "src/data/fantrax/nhl-ids.json", "nhl-ids.json path");
  eq(rel(p.today), "src/data/fantrax/today.json", "today.json path");
  eq(rel(p.overrides), "src/data/fantrax/id-overrides.json", "id-overrides.json path");
  eq(rel(p.prospectPool), "src/data/fantrax/prospect-pool.json", "prospect-pool.json path");
  eq(rel(p.values), "public/fantrax/values.json", "values.json path");
  eq(rel(p.state), "public/fantrax/state.json", "state.json path");
  eq(rel(p.pool), "public/fantrax/pool.json", "pool.json path");
  eq(rel(p.schedule), "public/fantrax/schedule-20262027.json", "schedule path");
  eq(rel(p.dynasty), "public/fantrax/dynasty.json", "dynasty.json path");
  eq(fantraxScheduleFile(c), "schedule-20262027.json", "schedule file name");
  // Published URLs the browser asks for stay at the root of /fantrax/.
  for (const f of ["values.json", "state.json", "pool.json", "dynasty-table.json"]) {
    eq(fantraxPublicFile(c, f), f, `published URL of ${f} is unprefixed`);
  }
  // The paths really are where the committed snapshot lives.
  for (const [label, path] of Object.entries({
    league: p.league,
    nhlIds: p.nhlIds,
    today: p.today,
    values: p.values,
    state: p.state,
    pool: p.pool,
    schedule: p.schedule,
    players: p.players,
    profiles: p.profiles,
  })) {
    assert(existsSync(path), `committed ${label} exists at its configured path`);
  }
  // The dynasty build reads the same league's files.
  const d = dynastyPaths(ROOT, c);
  eq([d.values, d.state, d.out, d.pool], [p.values, p.state, p.dynasty, p.prospectPool], "dynasty build paths follow the league config");
}

// ---- `--league` parsing (the three scripts share it)
{
  eq(fantraxLeagueFromArgs([]).slug, DEFAULT_FANTRAX_SLUG, "no flag = the default league");
  eq(fantraxLeagueFromArgs(["--team", "x"]).slug, DEFAULT_FANTRAX_SLUG, "other flags do not change the league");
  eq(fantraxLeagueFromArgs(["--league", "captains-dynasty"]).slug, "captains-dynasty", "--league <slug>");
  throws(() => fantraxLeagueFromArgs(["--league", "nope"]), "--league with an unknown slug throws");
  throws(() => fantraxLeagueFromArgs(["--league"]), "--league with no value throws rather than guessing");
}

// ---------------------------------------------------- 2. registry wiring
{
  for (const entry of LEAGUES.filter((l) => l.kind === "fantrax-points")) {
    const cfg = FANTRAX_LEAGUES[entry.slug];
    assert(!!cfg, `${entry.slug}: a fantrax-points league has an engine config under the same slug`);
    if (!cfg) continue;
    eq(entry.myTeamId, cfg.defaultTeamId, `${entry.slug}: registry team = config team`);
    eq(entry.teams, cfg.teams, `${entry.slug}: registry team count = config team count`);
    assert(entry.externalUrl?.includes(cfg.leagueId) ?? false, `${entry.slug}: the Fantrax link uses the config league id`);
    assert(entry.platform === "Fantrax", `${entry.slug}: a fantrax-points league is on Fantrax`);
    // The dynasty model is a league rule, not a site-wide mode: the registry
    // format and the engine feature must never disagree.
    eq(entry.format === "dynastie", cfg.features.dynasty, `${entry.slug}: format "dynastie" ⇔ features.dynasty`);
  }
  // A categories league has no Fantrax engine config.
  for (const entry of LEAGUES.filter((l) => l.kind !== "fantrax-points")) {
    eq(FANTRAX_LEAGUES[entry.slug], undefined, `${entry.slug}: no Fantrax config for a ${entry.kind} league`);
  }
  for (const slug of FANTRAX_SLUGS) {
    assert(/^[a-z0-9-]+$/.test(slug), `${slug}: URL-safe slug`);
    eq(FANTRAX_LEAGUES[slug]!.slug, slug, `${slug}: the config knows its own key`);
    const entry = getLeague(slug);
    if (entry) eq(entry.kind, "fantrax-points", `${slug}: a registered Fantrax config is a fantrax-points league`);
  }
  eq(getLeague(DEFAULT_FANTRAX_SLUG)?.kind, "fantrax-points", "the default Fantrax league is registered");
  // Every slot of every league has French copy (the UI reads SLOT_LABEL).
  for (const cfg of Object.values(FANTRAX_LEAGUES)) {
    for (const s of cfg.slots.order) assert(!!SLOT_LABEL[s], `${cfg.slug}: slot ${s} has a French label`);
  }
}

// ---------------------------------------------------- 3. the second league
/**
 * Slapshot Fantasy League, as the public fxea API reports it (2026-09-27).
 * The real registered config, pinned here.
 */
{
  eq(SLAPSHOT.leagueId, "glxjunc7mtxdqi8x", "Slapshot league id");
  eq(SLAPSHOT.defaultTeamId, "lz1ka65mmuh16mtf", "Slapshot: the user's team (Vegas Golden Knights)");
  eq(SLAPSHOT.teams, 32, "Slapshot: 32 teams");
  eq([...SLAPSHOT.slots.order], ["C", "LW", "RW", "D", "G"], "Slapshot slots, in Fantrax's order");
  eq(SLAPSHOT.slots.counts, { C: 4, LW: 4, RW: 4, D: 6, G: 2 }, "Slapshot slot counts");
  eq(
    SLAPSHOT.slots.order.reduce((n, sl) => n + (SLAPSHOT.slots.counts[sl] ?? 0), 0),
    SLAPSHOT.limits.maxActive,
    "Slapshot: the slots add up to maxTotalActivePlayers (20)",
  );
  eq(SLAPSHOT.limits.maxReserve, 3, "Slapshot: maxTotalReservePlayers");
  // fxea publishes no minimum, no IR cap and no Minors cap for this league.
  // They must be the loosest value consistent with maxTotalPlayers 40, so the
  // tool can never call a roster illegal on a rule it has not read.
  eq(SLAPSHOT.limits.minTotal, 0, "Slapshot: no published Active+Reserve minimum");
  assert(
    SLAPSHOT.limits.maxIr + SLAPSHOT.limits.maxActive + SLAPSHOT.limits.maxReserve <= 40,
    "Slapshot: the IR cap stands inside maxTotalPlayers 40",
  );
  assert(
    SLAPSHOT.limits.maxMinors + SLAPSHOT.limits.maxActive + SLAPSHOT.limits.maxReserve <= 40,
    "Slapshot: the Minors cap stands inside maxTotalPlayers 40",
  );
  eq(SLAPSHOT.cadence, { scoringPeriods: 84, rosterPeriods: 152, scoringPeriodDays: 2, claimWeekStartsOn: null }, "Slapshot cadence");
  eq(
    SLAPSHOT.features,
    { captainSlot: false, minors: false, gamesCaps: false, dynasty: false, fxpa: false, claimsPerWeek: null },
    "Slapshot features: none of Captains' five",
  );
  eq([...SLAPSHOT.eligibility.groups], ["C", "LW", "RW", "D", "G"], "Slapshot ranks the two wings apart");
  eq([...CAPTAINS_DYNASTY.eligibility.groups], ["C", "W", "D", "G"], "Captains has one winger group");
  // The ACTIVE-projection floor is a property of the ROSTER SHAPE, not of the
  // draft clock: a league with no Minors slots has to leave its unprojected
  // juniors and late picks ACTIVE for good, so a floor keyed to "the draft is
  // still running" would snap back to 95% on the last pick and fail the deploy
  // of the whole site.
  assert(SLAPSHOT.minActiveMatch < CAPTAINS_DYNASTY.minActiveMatch, "no Minors slots: a lower ACTIVE floor, permanently");
  eq(CAPTAINS_DYNASTY.minActiveMatch, 0.95, "Captains parks its prospects in the minors, so 95% of ACTIVE is projected");
  eq(SLAPSHOT.scoringSource, "categories", "Slapshot reads the complete scoring view");
  eq(SLAPSHOT.baseSlot, "C", "Slapshot scores a forward in the C column, not the unreachable Default one");
  assert(SLAPSHOT.slots.order.includes(SLAPSHOT.baseSlot as "C"), "Slapshot: baseSlot is one of its own slots");
  eq(CAPTAINS_DYNASTY.baseSlot, "Default", "Captains still scores a forward in the Default column");
  // The priors are league points, so they must be this league's, measured.
  assert(SLAPSHOT.priors.fpg.F > 0 && SLAPSHOT.priors.fpg.D > 0, "Slapshot: skater priors measured on its own scoring");
  assert(SLAPSHOT.priors.goalieE > 0, "Slapshot: goalie prior measured on its own scoring");
  assert(SLAPSHOT.priors.regularMinFpg > 0, "Slapshot: the regular threshold is on its own points scale");
  assert(
    SLAPSHOT.priors.fpg.F !== CAPTAINS_DYNASTY.priors.fpg.F,
    "Slapshot priors are not Captains' numbers reused",
  );
  // Registered, and its registry entry agrees (section 2 checks the rest).
  eq(fantraxLeague("slapshot"), SLAPSHOT, "fantraxLeague('slapshot') is this config");
  eq(getLeague("slapshot")?.format, "keeper", "Slapshot is a keeper league in the registry, never a dynasty");
}

// ---- paths of a second league never touch league 1's
{
  const p = fantraxPaths(SLAPSHOT, ROOT);
  const rel = (abs: string) => abs.slice(ROOT.length + 1).split(/[\\/]/).join("/");
  eq(rel(p.league), "src/data/fantrax/slapshot/league.json", "second league: league.json under its slug");
  eq(rel(p.values), "public/fantrax/slapshot/values.json", "second league: values.json under its slug");
  eq(rel(p.schedule), "public/fantrax/slapshot/schedule-20262027.json", "second league: schedule under its slug");
  eq(fantraxPublicFile(SLAPSHOT, "values.json"), "slapshot/values.json", "second league: published URL is prefixed");
  const mine = fantraxPaths(CAPTAINS_DYNASTY, ROOT);
  for (const k of ["league", "values", "state", "pool", "today", "dynasty"] as const) {
    assert(p[k] !== mine[k], `second league: ${k} is not league 1's file`);
  }
  // Shared repo inputs stay shared (one projections file for every league).
  eq([p.players, p.profiles], [mine.players, mine.profiles], "projections and profiles are shared");
  // No keeper model, no dynasty build: the gate the sync relies on.
  throws(() => dynastyPaths(ROOT, SLAPSHOT), "dynastyPaths refuses a league whose config has no dynasty model");
}

// ---- eligibility: LW/RW tokens, and Captains unchanged
{
  eq(eligibleSlots("W,F,Skt"), ["W", "F", "Skt"], "Captains winger (default config)");
  eq(eligibleSlots("D,Skt", CAPTAINS_DYNASTY), ["D", "Skt"], "Captains defenseman");
  eq(eligibleSlots("W,C,F,Skt", CAPTAINS_DYNASTY), ["C", "W", "F", "Skt"], "Captains C/W dual, in slot order");
  eq(eligibleSlots("G", CAPTAINS_DYNASTY), ["G"], "Captains goalie");
  // The bug a fixed SLOT_ORDER caused: a pure winger of an LW/RW league was
  // eligible for nothing at all.
  eq(eligibleSlots("LW,RW", SLAPSHOT), ["LW", "RW"], "second league: LW/RW dual");
  eq(eligibleSlots("C,LW", SLAPSHOT), ["C", "LW"], "second league: C/LW dual");
  eq(eligibleSlots("RW", SLAPSHOT), ["RW"], "second league: pure right wing");
  eq(eligibleSlots("G", SLAPSHOT), ["G"], "second league: goalie");
  eq(eligibleSlots("W,F,Skt", SLAPSHOT), [], "second league: Captains tokens fill none of its slots");
  // A slot fed by other tokens (alias eligibility).
  const winger: FantraxLeagueConfig = {
    ...SLAPSHOT,
    slug: "alias",
    slots: { order: ["C", "W", "D", "G"], counts: { C: 4, W: 8, D: 6, G: 2 } },
    eligibility: { ...SLAPSHOT.eligibility, slotTokens: { W: ["LW", "RW"] } },
  };
  eq(slotTokens(winger, "W"), ["LW", "RW"], "alias tokens of a slot");
  eq(slotTokens(winger, "C"), ["C"], "slots default to their own token");
  eq(eligibleSlots("LW", winger), ["W"], "alias: LW fills the W slot");
  eq(eligibleSlots("C,RW", winger), ["C", "W"], "alias: C/RW fills C and W");
}

// ---- the optimizer and the legality check on a 20-slot, LW/RW league
{
  const cand = (id: string, eligible: ("C" | "LW" | "RW" | "D" | "G")[], v: number): LineupCandidate => ({
    id,
    eligible,
    status: "ACTIVE",
    values: Object.fromEntries(eligible.map((s) => [s, v])),
  });
  const counts = { C: 1, LW: 1, RW: 1, D: 2, G: 1 };
  const cands = [
    cand("c1", ["C"], 5),
    cand("w1", ["LW", "RW"], 4),
    cand("w2", ["LW", "RW"], 3),
    cand("d1", ["D"], 2),
    cand("d2", ["D"], 2),
    cand("g1", ["G"], 6),
  ];
  const res = optimizeLineup(cands, counts, SLAPSHOT.slots.order);
  eq(res.assignments.map((a) => a.slot), ["C", "LW", "RW", "D", "D", "G"], "one row per slot instance, in config order");
  eq(res.captain, null, "no captain slot, no captain");
  assert(near(res.total, 5 + 4 + 3 + 2 + 2 + 6), `every slot filled (total ${res.total})`);
  // Both multi-eligible wingers are seated, one in each wing slot.
  const seated = res.assignments.filter((a) => a.slot === "LW" || a.slot === "RW").map((a) => a.playerId).sort();
  eq(seated, ["w1", "w2"], "LW/RW slots take the two dual-eligible wingers");

  const ev = evaluateRoster(
    [
      { id: "c1", slot: "C", status: "ACTIVE" },
      { id: "r1", slot: "RW", status: "ACTIVE" },
      { id: "r2", slot: "RW", status: "ACTIVE" },
    ],
    {},
    { limits: SLAPSHOT.limits, slotCounts: { C: 1, LW: 1, RW: 1, D: 2, G: 1 }, slotOrder: SLAPSHOT.slots.order },
  );
  eq(Object.keys(ev.slots), ["C", "LW", "RW", "D", "G"], "legality reports this league's slots only");
  eq(ev.issues.filter((i) => i.code === "slot-over").map((i) => i.slot), ["RW"], "two players in a one-deep RW slot");
  eq(ev.slots.LW!.empty, 1, "the empty LW slot is counted");
  assert(!("Skt" in ev.slots) && !("F" in ev.slots), "no captain or flex slot leaks in from league 1");
}

// ---- scoring source: the zero rows only `scoringCategories` carries
{
  // The shape of both fxea views, as the Slapshot league publishes them.
  const scoringSystem = {
    scoringCategorySettings: [
      {
        group: { code: "HOCKEY_SKATING", id: "1", shortName: "Skt" },
        configs: [
          { position: { code: "DEFAULT", id: "-1", shortName: "Default" }, scoringCategory: { code: "G", id: "2130", name: "Goals", shortName: "G" }, points: 3.5 },
          { position: { code: "DEFAULT", id: "-1", shortName: "Default" }, scoringCategory: { code: "A", id: "2090", name: "Assists", shortName: "A" }, points: 2.5 },
          // Fantrax omits the per-slot zeros here: Hit looks like a scored category.
          { position: { code: "DEFAULT", id: "-1", shortName: "Default" }, scoringCategory: { code: "HIT", id: "2092", name: "Hits", shortName: "Hit" }, points: 0.15 },
        ],
      },
      {
        group: { code: "HOCKEY_GOALIE", id: "2", shortName: "Goal" },
        configs: [
          { position: { code: "DEFAULT", id: "-1", shortName: "Default" }, scoringCategory: { code: "W", id: "2200", name: "Wins", shortName: "W" }, points: 3 },
          { position: { code: "DEFAULT", id: "-1", shortName: "Default" }, scoringCategory: { code: "GA", id: "2201", name: "Goals Against", shortName: "GA" }, points: -1 },
        ],
      },
    ],
    scoringCategories: {
      SKATING: {
        G: { Default: "points3.5" },
        A: { Default: "points2.5" },
        Hit: { C: "points0", D: "points0", RW: "points0", G: "points0", LW: "points0", Default: "points0.15" },
      },
      GOALIE: { W: { Default: "points3" }, GA: { Default: "points-1" } },
    },
  };
  eq(parsePointsString("points0.3"), 0.3, "points string");
  eq(parsePointsString("points-1.5"), -1.5, "negative points string");
  eq(parsePointsString("points0"), 0, "a zero row is a value, not a missing row");
  eq(parsePointsString("nope"), null, "unparsable points string");

  const complete = scoringTableFromInfo(scoringSystem, "categories");
  for (const s of SLAPSHOT.slots.order) {
    eq(categoryPoints(complete.skater, "Hit", s), 0, `"categories": Hit scores 0 in the ${s} slot`);
  }
  eq(categoryPoints(complete.skater, "G", "C"), 3.5, '"categories": goals still score');
  eq(categoryPoints(complete.goalie, "GA", "Default"), -1, '"categories": goalie GA');
  // The same payload read the Captains way keeps only the Default row, so
  // every slot would fall back to 0.15: the reason the source is per league.
  const settingsOnly = scoringTableFromInfo(scoringSystem, "settings");
  eq(categoryPoints(settingsOnly.skater, "Hit", "LW"), 0.15, '"settings" cannot see the per-slot zeros');
  eq(parseScoringCategories(scoringSystem.scoringCategories).skater.Hit!.Default, 0.15, "the unreachable Default row is kept as configured");
  throws(
    () => scoringTableFromInfo({ scoringCategorySettings: scoringSystem.scoringCategorySettings }, "categories"),
    '"categories" without scoringCategories throws instead of scoring silently wrong',
  );
  // No captain slot in this payload: the multiplier collapses to 1.
  eq(scoringShape(complete).sktMultiplier, 1, "no Skt rows, no captain multiplier");
  // A single assists total and PPP / SHG / SB now have rate keys.
  eq(unscoredCategories(complete), [], "every Slapshot category the model scores");
  eq(
    unscoredCategories({ skater: { Zzz: { Default: 1 } }, goalie: {} }),
    ["skater Zzz"],
    "a category with no rate key is reported, not dropped",
  );
  eq(unscoredCategories({ skater: { Zzz: { Default: 0 } }, goalie: {} }), [], "a category configured to 0 everywhere is not a gap");

  // ---- the OTHER reading of those per-slot zeros, and the switch for it.
  //
  // Slapshot's Hit row is {C 0, LW 0, RW 0, D 0, G 0, Default 0.15}. As
  // shipped, the tool reads it as Fantrax documents it — per slot — so hits are
  // worth nothing (`baseSlot: "C"`). If week-1 scoring ever shows Fantrax
  // really pays the 0.15, the reading that expresses THAT is "Fantrax ignores
  // the per-slot rows", i.e. the PAIR scoringSource "settings" + baseSlot
  // "Default". These three checks are why it is a pair and not one field.
  const hits = { g: 1, a1: 0, a2: 0, sog: 0, hit: 10, otp: 0, ht: 0, blk: 0, tk: 0, sho: 0, a: 0 };
  // As shipped: every slot agrees with the C column, hits are dead, D adds nothing.
  eq(unmodeledSlots(complete, SLAPSHOT), [], "as shipped: C, LW and RW all score a skater alike");
  eq(deadCategories(complete, SLAPSHOT), ["skater Hit"], "as shipped: Hit is configuration no slot can reach");
  eq(skaterComponents(complete, hits, "C"), { off: 3.5, dx: 0 }, "as shipped: 10 hits are worth 0");
  // Flipping baseSlot ALONE is inconsistent, and loudly so: the D column
  // publishes the same zeros, so `off` would pay the hits and `dx` take them
  // straight back out (a negative D extra), and three slots of the league would
  // be valued off a column none of them can reach. `check:league` fails on it.
  const baseOnly: FantraxLeagueConfig = { ...SLAPSHOT, baseSlot: "Default" };
  eq(
    unmodeledSlots(complete, baseOnly).map((d) => `${d.slot} ${d.category} ${d.points} vs ${d.base}`),
    ["C Hit 0 vs 0.15", "LW Hit 0 vs 0.15", "RW Hit 0 vs 0.15"],
    "baseSlot alone: check:league refuses it, naming every slot that disagrees",
  );
  assert(skaterComponents(complete, hits, "Default").dx < 0, "baseSlot alone: the D extra would go negative");
  // The pair IS consistent: "settings" drops every row worth 0, so no per-slot
  // row is left, every slot reads 0.15 (D included, so dx is 0), and both
  // `unmodeledSlots` and `deadCategories` come out clean.
  const alt: FantraxLeagueConfig = { ...SLAPSHOT, scoringSource: "settings", baseSlot: "Default" };
  const altTable = scoringTableFromInfo(scoringSystem, alt.scoringSource);
  eq(unmodeledSlots(altTable, alt), [], "the alternative reading: no slot is left unmodelled");
  eq(deadCategories(altTable, alt), [], "the alternative reading: Hit is live, so it is not dead configuration");
  eq(skaterComponents(altTable, hits, alt.baseSlot), { off: 5, dx: 0 }, "the alternative reading: 10 hits are worth 1.5, D adds nothing");
}

// ---- the group vocabulary is the league's, and a pool `pos` round-trips
/**
 * `pos` in a pool file is the league's groups concatenated ("CLW"), so the
 * vocabulary must be prefix-free inside a league and every group must be one
 * `FANTRAX_GROUPS` knows, or the string could not be read back. Reading it
 * character by character is the trap: over "LWRW" that sees an "L" and an "R".
 */
{
  for (const cfg of Object.values(FANTRAX_LEAGUES)) {
    assert(cfg.eligibility.groups.length > 0, `${cfg.slug}: has groups`);
    for (const g of cfg.eligibility.groups) {
      assert(FANTRAX_GROUPS.includes(g), `${cfg.slug}: group ${g} is in the cross-league vocabulary`);
      assert(!!cfg.eligibility.groupTokens[g]?.length, `${cfg.slug}: group ${g} has at least one eligiblePos token`);
      for (const h of cfg.eligibility.groups) {
        assert(g === h || !h.includes(g), `${cfg.slug}: group ${g} is not a substring of ${h}`);
      }
    }
  }
  const roundTrip = (e: string, cfg: FantraxLeagueConfig) => {
    const pos = eligibleGroups(e, cfg).join("");
    return parseGroups(pos, cfg).join("");
  };
  for (const e of ["LW,RW", "C,LW", "C", "RW", "D", "G", "LW"]) {
    eq(roundTrip(e, SLAPSHOT), eligibleGroups(e, SLAPSHOT).join(""), `Slapshot: "${e}" survives the pos round trip`);
  }
  eq(eligibleGroups("LW,RW", SLAPSHOT), ["LW", "RW"], "a dual winger is in both wing groups");
  eq(parseGroups("LWRW", SLAPSHOT), ["LW", "RW"], '"LWRW" reads back as two groups, not four letters');
  eq(parseGroups("CLW", SLAPSHOT), ["C", "LW"], '"CLW" is C + LW');
  eq(eligibleGroups("W,C,F,Skt", CAPTAINS_DYNASTY), ["C", "W"], "Captains: the flex tokens need no group");
  eq(parseGroups("CW", CAPTAINS_DYNASTY), ["C", "W"], "Captains: the historical pos string is unchanged");
  // A Captains token means nothing in Slapshot and the reverse: the check
  // script refuses a league that leaves a player in no group at all.
  eq(eligibleGroups("W,F,Skt", SLAPSHOT), [], "Captains tokens land in no Slapshot group");
  eq(eligibleGroups("LW", CAPTAINS_DYNASTY), [], "a per-side winger token lands in no Captains group");
}

// ---- the claim week follows the league's own reset day
{
  // 2026-09-25 is a Friday (Eastern).
  const friday = Date.parse("2026-09-25T18:00:00Z");
  eq(claimWeekStart(friday), "2026-09-21", "Monday reset (Captains), unchanged");
  eq(claimWeekStart(friday, 1), "2026-09-21", "Monday reset, explicit");
  eq(claimWeekStart(friday, 4), "2026-09-24", "Thursday reset");
  eq(claimWeekStart(friday, 5), "2026-09-25", "Friday reset, today");
  eq(claimWeekStart(friday, 7), "2026-09-20", "Sunday reset");
}

if (failed) process.exit(1);
console.log(
  `OK: Fantrax config (${FANTRAX_SLUGS.length} registered league(s), Captains paths pinned, second league parameterised)`,
);
