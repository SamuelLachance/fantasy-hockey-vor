/** Regression checks for the dynasty portfolio's units, coverage and comparison. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AssetRecord } from "../src/lib/dynasty/asset-score";
import { clientDynastySnapshot } from "../src/lib/dynasty/client-snapshot";
import { slapshotClientSnapshot, type SlapshotSnapshotLike } from "../src/lib/dynasty/slapshot-client";
import type { DynastySnapshot } from "../src/lib/dynasty/types";
import { buildPortfolioOutlook, parsePortfolioSnapshot, type PortfolioSnapshot } from "../src/lib/fantrax/portfolio";

const record = (n: string, eG: number[], dv: AssetRecord["dv"], g: AssetRecord["g"] = "F"): AssetRecord => ({ n, eG, dv, g, age: 25, phase: "prime" });
const source: PortfolioSnapshot = {
  version: 1, builtAt: "2026-10-02T12:00:00Z", season: "2026-27", zero: ["zero"],
  players: {
    a: record("A", [10, 10, 10, 10], { winNow: 80, balanced: 50, longTerm: 20 }),
    b: record("B", [20, 0, -3, 0], { winNow: 40, balanced: 30, longTerm: 15 }, "D"),
    c: record("C", [-2, 4, 6, 8], { winNow: 30, balanced: 15, longTerm: 10 }, "G"),
  },
};
const input = { snapshot: source, rosters: { A: ["a", "b", "a", "zero"], B: ["c"], C: ["unknown"], D: [] }, teamId: "A", teamIds: ["A", "B", "C", "D", "absent"], mode: "balanced" as const };
const original = JSON.stringify(input);
const portfolio = buildPortfolioOutlook(input)!;
assert.deepEqual(portfolio.seasons.map((s) => s.gain), [30, 10, 7, 10], "negative expected gains are preserved, duplicate players never count twice");
assert.deepEqual(portfolio.seasons.map((s) => s.median), [14, 7, 6.5, 9], "even median uses only complete, nonempty team rosters");
assert.equal(portfolio.comparisonTeams, 2, "missing and empty rosters cannot dilute the league baseline");
assert.deepEqual(portfolio.coverage, { total: 3, known: 3, missing: [], zero: 1 }, "explicit zero is covered, not an unknown player");
assert.equal(portfolio.total, 80, "published horizon values are summed without being confused with seasonal fantasy points");
assert.deepEqual(portfolio.seasons.map((s) => s.rank), [1, 1, 1, 1]);
assert.equal(portfolio.nearShare, 40 / 60, "near share divides first-two-season positive gains by all positive gains");
assert.equal(portfolio.core[0]?.id, "a", "durable core follows gains from the third season onward");
assert.equal(portfolio.core[0]?.laterGain, 20);
assert.equal(JSON.stringify(input), original, "source snapshots and rosters remain unchanged");
const longTerm = buildPortfolioOutlook({ ...input, mode: "longTerm" })!;
assert.equal(longTerm.total, 35, "changing the horizon reads its own published asset values");
assert.deepEqual(longTerm.seasons, portfolio.seasons, "horizon cannot alter the unweighted seasonal curve");

const partial = buildPortfolioOutlook({ ...input, teamId: "C" })!;
assert.deepEqual(partial.coverage.missing, ["unknown"]);
assert(partial.seasons.every((s) => s.rank === null), "an incomplete team is never assigned a misleading rank");
assert.equal(buildPortfolioOutlook({ ...input, teamId: "absent" }), null, "a missing roster is not an empty team");
assert.equal(buildPortfolioOutlook({ ...input, teamId: "D" })?.coverage.total, 0, "an explicitly empty team remains empty");
const tied = buildPortfolioOutlook({ ...input, rosters: { A: ["a"], B: ["a"] }, teamIds: ["A", "B"] })!;
assert(tied.seasons.every((s) => s.rank === 1), "tied teams share a rank");
const zero = buildPortfolioOutlook({ ...input, rosters: { A: ["zero"] }, teamIds: ["A"] })!;
assert.equal(zero.topThreeShare, null, "zero portfolio has no concentration percentage");
assert.equal(zero.nearShare, null, "zero portfolio has no temporal percentage");
assert.deepEqual(zero.seasons.map((s) => s.gain), [0, 0, 0, 0]);
const noComparison = buildPortfolioOutlook({ ...input, rosters: { A: ["unknown"] }, teamIds: ["A"] })!;
assert(noComparison.seasons.every((s) => s.median === null), "no complete team means no median, not a zero baseline");

assert(parsePortfolioSnapshot(source), "valid snapshot is accepted");
assert.equal(parsePortfolioSnapshot({ ...source, players: {} }), null, "empty snapshots have no modeled horizon");
assert.equal(parsePortfolioSnapshot({ ...source, season: "invalid" }), null);
assert.equal(parsePortfolioSnapshot({ ...source, builtAt: "invalid" }), null);
assert.equal(parsePortfolioSnapshot({ ...source, players: { ...source.players, a: { ...source.players.a!, eG: [NaN, 0, 0, 0] } } }), null, "nonfinite values cannot enter the chart");
assert.equal(parsePortfolioSnapshot({ ...source, players: { ...source.players, a: { ...source.players.a!, eG: [1] } } }), null, "a truncated future path must not silently become zeros");
assert.equal(parsePortfolioSnapshot({ ...source, players: { ...source.players, a: { ...source.players.a!, dv: { balanced: 1 } } } }), null, "all selectable horizons must exist");

for (const base of ["public/fantrax/", "public/fantrax/slapshot/"]) {
  // Client copies are generated at build time and intentionally gitignored.
  // Derive them from committed inputs, so this also runs in a clean checkout.
  const full = JSON.parse(readFileSync(`${base}dynasty.json`, "utf8")) as DynastySnapshot | SlapshotSnapshotLike;
  const client = base.includes("slapshot") ? slapshotClientSnapshot(full as SlapshotSnapshotLike) : clientDynastySnapshot(full as DynastySnapshot);
  const snapshot = parsePortfolioSnapshot(client);
  assert(snapshot, `${base}: published client snapshot is valid`);
  const state = JSON.parse(readFileSync(`${base}state.json`, "utf8")) as { rosters: Record<string, Array<{ id: string }>> };
  const rosters = Object.fromEntries(Object.entries(state.rosters).map(([id, roster]) => [id, roster.map((p) => p.id)]));
  for (const teamId of Object.keys(rosters)) {
    const result = buildPortfolioOutlook({ snapshot, rosters, teamId, teamIds: Object.keys(rosters), mode: "balanced" });
    assert(result, `${base}${teamId}: portfolio builds`);
    assert(result.seasons.every((s) => Number.isFinite(s.gain)), `${base}${teamId}: chart stays finite`);
    if (!result.coverage.missing.length) assert(result.seasons.every((s) => s.rank !== null), `${base}${teamId}: complete team has a seasonal rank`);
  }
}
console.log("OK: Fantrax portfolio (signed gains, horizons, median, ties, coverage, validation, both published leagues)");

