import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAPTAINS_DYNASTY, SLAPSHOT } from "../src/lib/fantrax/config";
import type { DailyPlan } from "../src/lib/fantrax/daily-plan";
import { briefSource, decisionBrief, BRIEF_REFRESH_MS } from "../src/lib/fantrax/decision-brief";
import type { LeagueSnapshotBundle } from "../src/lib/fantrax/league-client";
import type { LiveOverlay } from "../src/lib/fantrax/live";

const load = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const base = load<DailyPlan>("src/data/fantrax/today.json");
const bundle: LeagueSnapshotBundle = {
  league: load("src/data/fantrax/league.json"),
  state: load("public/fantrax/state.json"),
  values: load("public/fantrax/values.json"),
  schedule: load("public/fantrax/schedule-20262027.json"),
  contracts: null,
};
const now = Date.parse("2026-10-29T16:00:00Z");
const recent = new Date(now - 60_000).toISOString();
assert.equal(briefSource("rosters", "garbage", now).status, "unknown", "invalid dates cannot look fresh");
assert.equal(briefSource("rosters", new Date(now + 60_000).toISOString(), now).status, "unknown", "future dates cannot look fresh");
assert.equal(briefSource("rosters", recent, null).status, "unknown", "SSR has no clock for freshness");
assert.equal(briefSource("rosters", recent, now, false).status, "unknown", "a successful timestamp cannot validate missing data");
assert.equal(briefSource("rosters", new Date(now - BRIEF_REFRESH_MS.rosters).toISOString(), now).status, "fresh", "refresh boundary is inclusive");
assert.equal(briefSource("rosters", new Date(now - BRIEF_REFRESH_MS.rosters - 1).toISOString(), now).status, "stale", "refresh boundary expires");

const plan = structuredClone(base);
plan.target = { rosterPeriod: 99, start: "2026-10-29T23:00:00Z", end: "2026-10-30T16:00:00Z", date: "2026-10-29" };
plan.lineup = { total: 12.5, captain: null, moves: [{ id: "projected", from: "RESERVE", to: "C" }], slots: [
  { slot: "C", id: "projected", value: 9, game: { startUTC: "2026-10-29T23:00:00Z", opp: "MTL", home: true } },
  { slot: "D", id: "fallback", value: 3.5, game: null },
  { slot: "G", id: null, value: 0, game: null },
] };
plan.alerts = [];
plan.goalies = [];
plan.salary = null;
plan.capFit = null;
plan.cap = null;
plan.waivers.targets = [];
const live: LiveOverlay = {
  fetchedAt: recent,
  rosterPeriod: 99,
  rosters: { [plan.teamId]: [
    { id: "projected", slot: "C", status: "ACTIVE" },
    { id: "fallback", slot: "D", status: "ACTIVE" },
    { id: "unknown", slot: "", status: "MINORS" },
  ] },
  draft: null,
  draftAt: null,
  recent: [],
};
plan.players = {
  projected: { n: "Modèle", t: "MTL", e: "C", st: "ACTIVE", fpg: 9, src: "proj" },
  fallback: { n: "Repli", t: "MTL", e: "D", st: "ACTIVE", fpg: 3.5, src: "prior" },
  fa: { n: "Autonome", t: "MTL", e: "C", st: "FA", fpg: 5, src: "proj" },
};
const args = { plan, config: CAPTAINS_DYNASTY, bundle, live, nowMs: now };
const brief = decisionBrief(args);
assert.equal(brief.sources.find((s) => s.id === "rosters")?.status, "fresh", "live roster has its own clock even after snapshot rosterPeriod");
assert.equal(brief.sources.find((s) => s.id === "rosters")?.live, true);
assert.equal(brief.sources.find((s) => s.id === "projections")?.status, "stale", "live rosters cannot refresh projection timestamp");
assert.equal(brief.sources.find((s) => s.id === "injuries")?.at, bundle.state.fetchedAt, "injury timestamp remains the snapshot date");
assert.deepEqual(brief.coverage, { projected: 1, prior: 1, unknown: 1, total: 3 }, "coverage counts the roster, including unknown ids, not free-agent targets");
assert.equal(brief.lineupPoints, 12.5);
assert.equal(brief.playing, 1, "occupied no-game slots do not count as games");
assert.equal(brief.occupied, 2);
assert.equal(brief.seats, 3);
assert.equal(brief.moves, 1);
assert.equal(brief.nextLock, plan.target.start, "period-lock leagues use period start");

const mismatched = decisionBrief({ ...args, live: { ...live, rosterPeriod: 98 } });
assert.equal(mismatched.sources.find((s) => s.id === "rosters")?.live, false, "a live roster from the wrong period cannot be labelled current");
const noTarget = decisionBrief({ ...args, plan: { ...plan, target: null } });
assert.equal(noTarget.lineupPoints, null, "without target, do not show the old lineup as today's points");
assert.equal(noTarget.moves, null);
assert.equal(noTarget.nextLock, null);
assert(!noTarget.actions.some((a) => a.id === "lineup"), "without target, no stale lineup movement instruction");
const expired = decisionBrief({ ...args, nowMs: Date.parse(plan.target.end) });
assert.equal(expired.lineupPoints, null, "the target end is exclusive");
assert.equal(expired.nextLock, null);
const periodLocked = decisionBrief({ ...args, nowMs: Date.parse(plan.target.start) });
assert.equal(periodLocked.lineupPoints, null, "a period-lock lineup expires at puck drop, not tomorrow's period end");
assert.equal(periodLocked.moves, null);
assert(!periodLocked.actions.some((a) => a.id === "lineup"));
const noBundle = decisionBrief({ ...args, bundle: null, live: null });
assert.equal(noBundle.sources.find((s) => s.id === "projections")?.status, "unknown");
assert.equal(noBundle.coverage.total, 2, "fallback plan coverage excludes FA players");
const noClock = decisionBrief({ ...args, nowMs: null });
assert(noClock.sources.every((s) => s.status === "unknown"));
assert.equal(noClock.lineupPoints, null);

const gameLock = "2026-10-29T22:55:00Z";
const perGame = decisionBrief({ ...args, config: SLAPSHOT, plan: { ...plan, locks: { minutesBefore: 5, next: gameLock, last: gameLock, locked: [] } } });
assert.equal(perGame.nextLock, gameLock, "per-game locks use the actual next player lock");
assert(!perGame.sources.some((s) => s.id === "caps"), "no counter tile for a league with no games cap");
assert.equal(perGame.sources.find((s) => s.id === "injuries")?.available, false, "closed fxpa does not acquire injury knowledge from a live roster");
assert.equal(perGame.sources.find((s) => s.id === "injuries")?.availability, "not-published", "an unsupported source is distinguished from a temporary read failure");
const failedFxpa = decisionBrief({ ...args, bundle: { ...bundle, state: { ...bundle.state, fxpaOk: false } } });
assert.equal(failedFxpa.sources.find((s) => s.id === "injuries")?.availability, "unavailable", "a failed fxpa read does not claim the league never publishes injuries");
const passedLock = decisionBrief({ ...args, config: SLAPSHOT, plan: { ...plan, locks: { minutesBefore: 5, next: recent, last: recent, locked: [] } } });
assert.equal(passedLock.nextLock, null, "do not advertise a passed game lock as upcoming");
assert.equal(passedLock.lineupPoints, null, "a per-game lineup expires at its last lock");
const lastGameLock = "2026-10-30T02:55:00Z";
const betweenGames = decisionBrief({ ...args, config: SLAPSHOT, nowMs: Date.parse("2026-10-30T00:00:00Z"), plan: { ...plan, locks: { minutesBefore: 5, next: lastGameLock, last: lastGameLock, locked: ["projected"] } } });
assert.equal(betweenGames.lineupPoints, 12.5, "per-game leagues keep the period actionable between first and last games");
assert.equal(betweenGames.nextLock, lastGameLock);
const malformedLock = decisionBrief({ ...args, config: SLAPSHOT, plan: { ...plan, locks: { minutesBefore: 5, next: "2027-10-29T22:55:00Z", last: gameLock, locked: [] } } });
assert.equal(malformedLock.nextLock, null, "a lock outside the targeted period cannot appear as the next lock");

const waiverPlan = structuredClone(plan);
waiverPlan.waivers.claimsLeft = null;
waiverPlan.waivers.targets = [{ id: "fa", status: "FA", delta: 3.25, ros: -1, rental: true, days: 2, fpg: 5, drop: { id: "fallback", action: "drop", fpg: 3.5 } }];
const waiver = decisionBrief({ ...args, plan: waiverPlan }).actions.find((a) => a.id === "waiver");
assert(waiver?.detail.includes("valeur dynastie"), "a release warning accompanies the projected pickup gain");
assert(waiver?.detail.includes("inconnues"), "unknown claims do not mean unlimited claims");
assert(waiver?.detail.includes("temporaire"), "a rental says its later cost");
waiverPlan.waivers.claimsLeft = 0;
assert(!decisionBrief({ ...args, plan: waiverPlan }).actions.some((a) => a.id === "waiver"), "no pickup priority after claims run out");
assert(!decisionBrief({ ...args, config: SLAPSHOT, plan: waiverPlan }).actions.some((a) => a.id === "waiver"), "closed-fxpa league gets no unsupported ballottage tab");

console.log("OK: Fantrax decision brief (source clocks, coverage, expiry, locks and pickup tradeoffs)");
