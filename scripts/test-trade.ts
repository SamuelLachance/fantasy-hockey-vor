/**
 * The trade evaluator (src/lib/trade): team value with roster limits, the
 * best lineup, a trade read from both sides, counter-offers, best offers,
 * the cap, the context built from a real league's committed data, and the
 * guard on its backtest (scripts/backtest-trade.ts): the committed bench
 * share is the one the backtest fitted and scored, and the evaluator still
 * ranks trades better than adding up projected points.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { assetsOf, type AssetRecord, type TeamAssets } from "../src/lib/dynasty/asset-score";
import { fantraxLeague } from "../src/lib/fantrax/config";
import type { ValuesSnapshot, StateSnapshot } from "../src/lib/fantrax/snapshot-types";
import { buildTradeContext, remainingShares, windowHorizon } from "../src/lib/trade/context";
import { acceptable, baseStates, bestOffers, counterOffers, evaluateTrade, type TradeContext } from "../src/lib/trade/evaluate";
import { TRADE_BENCH } from "../src/lib/trade/params";
import { lineupPoints, rosterValue, type Horizon, type LineupRules, type TeamPlayer } from "../src/lib/trade/team-value";

let failures = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    failures++;
    console.error(`FAIL ${msg}`);
  }
}
const near = (a: number, b: number, tol: number, msg: string) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

const P = (id: string, v: number, pos = "C", fp = v, minorsOk = false): TeamPlayer => ({
  id,
  name: id,
  pos: [pos],
  goalie: pos === "G",
  dv: { winNow: v, balanced: v, longTerm: v },
  fp,
  minorsOk,
});

// ---- roster value
{
  const roster = [P("a", 100), P("b", 50), P("c", 10)];
  const r = rosterValue(roster, "balanced", { main: 3, minors: 0 }, [8, 5]);
  near(r.value, 160, 1e-9, "full roster: the sum");
  const two = rosterValue([...roster, P("d", 30)], "balanced", { main: 3, minors: 0 }, [8]);
  near(two.value, 180, 1e-9, "one too many: the cheapest goes");
  assert(two.dropped.length === 1 && two.dropped[0] === "c", "the cheapest is dropped");
  const open = rosterValue([P("a", 100)], "balanced", { main: 3, minors: 0 }, [8, 5]);
  near(open.value, 113, 1e-9, "open spots take the best free agents");
  // a prospect fits in the minors and costs no main spot
  const minors = rosterValue([P("a", 100), P("b", 50), P("c", 10), P("p", 20, "C", 0, true)], "balanced", { main: 3, minors: 2 });
  near(minors.value, 180, 1e-9, "minors-eligible player kept in the minors");
  // ineligible beyond the main roster go, even when the minors have room
  const full = rosterValue([P("a", 100), P("b", 50), P("c", 10), P("d", 5)], "balanced", { main: 3, minors: 5 });
  near(full.value, 160, 1e-9, "minors only take eligible players");
}

// ---- lineup
const rules: LineupRules = {
  seats: [
    { slot: "C", capacity: 2, accepts: ["C"] },
    { slot: "D", capacity: 2, accepts: ["D"] },
    { slot: "G", capacity: 1, accepts: ["G"] },
  ],
  benchShare: 0.3,
  goalieBenchShare: 0.25,
  rosterSize: 6,
  captainBonus: 0,
};
{
  const team = [P("c1", 0, "C", 200), P("c2", 0, "C", 150), P("c3", 0, "C", 100), P("d1", 0, "D", 120), P("g1", 0, "G", 300)];
  const l = lineupPoints(team, rules, { D: 40 });
  near(l.points, 200 + 150 + 120 + 40 + 300 + 0.3 * 100, 1e-9, "lineup: seats, the hole filled by a free agent, the bench at its share");
  // beyond the active roster (6 here), a player never plays: the 7th and 8th add nothing
  const deep = lineupPoints([...team, P("c4", 0, "C", 90), P("c5", 0, "C", 80), P("c6", 0, "C", 70)], rules, { D: 40 }).points;
  near(deep, 200 + 150 + 120 + 40 + 300 + 0.3 * (100 + 90), 1e-9, "lineup: only the active roster plays");
  assert(l.empty.D === 1, "lineup: one empty D seat");
  // a D who fills the hole is worth more to this team than a better C who would sit
  const withD = lineupPoints([...team, P("d2", 0, "D", 90)], rules, { D: 40 }).points;
  const withC = lineupPoints([...team, P("c4", 0, "C", 120)], rules, { D: 40 }).points;
  assert(withD > withC, "positional need: the D who plays beats the better C on the bench");
}

// ---- a trade, both sides
function toyContext(): TradeContext {
  const players: Record<string, TeamPlayer> = {};
  const add = (p: TeamPlayer) => (players[p.id] = p);
  // team A: deep at C, no D; team B: deep at D, thin at C
  ["a1:C:300", "a2:C:250", "a3:C:200", "a4:C:150", "a5:G:280"].forEach((s) => {
    const [id, pos, v] = s.split(":");
    add(P(id!, Number(v), pos!, Number(v)));
  });
  ["b1:D:260", "b2:D:220", "b3:D:180", "b4:C:120", "b5:G:240"].forEach((s) => {
    const [id, pos, v] = s.split(":");
    add(P(id!, Number(v), pos!, Number(v)));
  });
  add(P("fa1", 30, "C", 30));
  add(P("fa2", 25, "D", 25));
  return {
    teams: ["A", "B"],
    rosters: { A: ["a1", "a2", "a3", "a4", "a5"], B: ["b1", "b2", "b3", "b4", "b5"] },
    players,
    picks: { "2027-1-A": { id: "2027-1-A", name: "1re ronde 2027", owner: "A", value: { winNow: 60, balanced: 90, longTerm: 140 } } },
    horizonOf: { A: "balanced", B: "balanced" },
    roster: { main: 5, minors: 0 },
    lineup: rules,
    faValues: { winNow: [30, 25], balanced: [30, 25], longTerm: [30, 25] },
    faBySlot: { C: 30, D: 25, G: 0 },
    cap: null,
  };
}
{
  const ctx = toyContext();
  const bases = baseStates(ctx);
  const empty = evaluateTrade(ctx, { a: { team: "A", players: [], picks: [] }, b: { team: "B", players: [], picks: [] } }, bases);
  near(empty.a.gain, 0, 1e-9, "no trade: no gain");
  // C for D: both teams fill a need
  const swap = evaluateTrade(ctx, { a: { team: "A", players: ["a3"], picks: [] }, b: { team: "B", players: ["b3"], picks: [] } }, bases);
  assert(swap.a.fit > 0 && swap.b.fit > 0, `need-based swap: both lineups gain beyond the points (${swap.a.fit}, ${swap.b.fit})`);
  assert(swap.winWin, "need-based swap: win-win");
  assert(swap.a.received[0]!.id === "b3" && swap.b.received[0]!.id === "a3", "receipts mirror each other");
  // 2-for-1: the receiver must drop someone
  const two = evaluateTrade(ctx, { a: { team: "A", players: ["a4", "a3"], picks: [] }, b: { team: "B", players: ["b1"], picks: [] } }, bases);
  assert(two.b.dropped.length === 1, "2-for-1: the receiver lets one go");
  assert(two.a.dv.balanced > (260 - 350) + 0, "2-for-1: the sender gets an open spot back (a free agent)");
  // a pick moves value on every horizon
  const pick = evaluateTrade(ctx, { a: { team: "A", players: [], picks: ["2027-1-A"] }, b: { team: "B", players: ["b4"], picks: [] } }, bases);
  near(pick.b.dv.longTerm - pick.b.dv.winNow, (140 - 60) - 0, 1e-6, "a pick's value per horizon");
  // counter-offers: acceptable and good for the user
  const lopsided = { a: { team: "A", players: ["a4"], picks: [] }, b: { team: "B", players: ["b1"], picks: [] } };
  for (const c of counterOffers(ctx, lopsided, 4, bases)) {
    assert(acceptable(c.eval) && c.eval.a.gain > 0, `counter-offer acceptable and good: ${c.note}`);
  }
  const offers = bestOffers(ctx, "A", "B", { bases });
  assert(offers.length > 0, "best offers found");
  for (const o of offers) assert(acceptable(o.eval) && o.eval.a.gain > 0, "best offer acceptable and good");
  // the cap: over it after the trade is flagged and never offered
  const capped: TradeContext = {
    ...ctx,
    cap: { seasons: [2026], cap: [10], hits: (id) => (id === "b1" ? [9] : [1]), spots: 5, counted: () => true },
  };
  const over = evaluateTrade(capped, { a: { team: "A", players: ["a4"], picks: [] }, b: { team: "B", players: ["b1"], picks: [] } });
  assert(over.a.cap!.over[0] && !over.b.cap!.over[0], "cap: the receiver of the big contract goes over");
  near(over.a.cap!.after[0]! - over.a.cap!.before[0]!, 8, 1e-9, "cap: the payroll moves by the cap hits");
  for (const o of bestOffers(capped, "A", "B")) assert(!o.eval.a.cap!.over[0] && !o.eval.b.cap!.over[0], "cap: offers stay under the cap");
}

// ---- a real league's committed data
for (const slug of ["captains-dynasty", "slapshot"]) {
  const cfg = fantraxLeague(slug);
  const root = join(process.cwd(), ...cfg.paths.public.split("/"));
  const dyn = JSON.parse(readFileSync(join(root, "dynasty.json"), "utf8")) as { players: Record<string, AssetRecord & { pos?: string[] }> };
  const values = JSON.parse(readFileSync(join(root, "values.json"), "utf8")) as ValuesSnapshot;
  const state = JSON.parse(readFileSync(join(root, "state.json"), "utf8")) as StateSnapshot;
  const teams = Object.keys(state.rosters);
  const rosters = Object.fromEntries(teams.map((t) => [t, state.rosters[t]!.map((e) => e.id)]));
  const input = { kind: slug === "captains-dynasty" ? ("keeper" as const) : ("dynasty" as const), firstSeason: 2026, teams, rosters, records: dyn.players, picks: [], deltas: { winNow: 0.35, balanced: 0.75, longTerm: 0.95 }, keepers: 10 };
  const assets = { winNow: assetsOf(input, "winNow"), balanced: assetsOf(input, "balanced"), longTerm: assetsOf(input, "longTerm") } as Record<Horizon, TeamAssets[]>;
  const ctx = buildTradeContext({
    config: cfg,
    teams,
    rosters: Object.fromEntries(teams.map((t) => [t, state.rosters[t]!.map((e) => ({ id: e.id, status: e.status }))])),
    records: dyn.players,
    values: values.players,
    remaining: () => 1,
    assets,
    contracts: null,
  });
  const me = cfg.defaultTeamId;
  assert(ctx.rosters[me]!.length > 15, `${slug}: my roster resolves`);
  assert(Object.values(ctx.players).filter((p) => p.fp > 0).length > 400, `${slug}: projected points for the league`);
  for (const t of assets.balanced) assert(ctx.horizonOf[t.team] === windowHorizon(t.window), `${slug}: horizon follows the window`);
  const other = teams.find((t) => t !== me)!;
  const t0 = Date.now();
  const offers = [...bestOffers(ctx, me, other, { limit: 3 }), ...bestOffers(ctx, me, other, { limit: 3, mode: "marche" })];
  const ms = Date.now() - t0;
  if (process.env.TRADE_VERBOSE) console.log(slug, ms, "ms", offers.map((o) => `${o.trade.a.players.map((id) => ctx.players[id]?.name).join("+")} -> ${o.trade.b.players.map((id) => ctx.players[id]?.name).join("+")} me ${o.eval.a.gain.toFixed(0)} them ${o.eval.b.gain.toFixed(0)} mkt ${o.eval.b.marketGain.toFixed(0)}`));
  assert(ms < 4000, `${slug}: best offers to one team in ${ms} ms`);
  for (const o of offers) assert(acceptable(o.eval, "marche") && o.eval.a.gain > 0, `${slug}: offer acceptable and good`);
  for (const o of bestOffers(ctx, me, other, { limit: 3 })) assert(o.eval.b.gain >= 0, `${slug}: a « modèle » offer gains for the other team too`);
}
{
  const rem = remainingShares(
    [
      ["2026-10-01T23:00:00Z", "AAA", "BBB"],
      ["2026-11-01T23:00:00Z", "AAA", "CCC"],
    ],
    "2026-09-29",
    "2027-04-10",
    Date.parse("2026-10-15T00:00:00Z"),
  );
  near(rem("AAA"), 0.5, 1e-9, "rest of season: half of AAA's games left");
  near(rem("BBB"), 0, 1e-9, "rest of season: none of BBB's");
  near(rem("ZZZ"), 1, 1e-9, "rest of season: unknown club counts whole");
}

// ---- the backtest guard
{
  const s = JSON.parse(readFileSync(join(process.cwd(), "src", "data", "trade", "backtest-summary.json"), "utf8"));
  assert(
    s.benchShare === TRADE_BENCH.benchShare && s.benchShareFitted === TRADE_BENCH.benchShare && s.goalieBenchShare === TRADE_BENCH.goalieBenchShare && s.goalieBenchShareFitted === TRADE_BENCH.goalieBenchShare,
    "params.ts bench shares = the backtest's fitted and scored ones (re-run scripts/backtest-trade.ts)",
  );
  assert(s.overall.n >= 6000, "a full backtest is committed");
  assert(s.overall.spearmanCI.tool[0] > s.overall.spearman.naive, "the evaluator ranks trades better than adding up points (95 % CI)");
  assert(s.overall.signAccuracy.tool > s.overall.signAccuracy.naive, "the evaluator calls the winner more often");
  for (const [season, m] of Object.entries(s.bySeason) as Array<[string, { spearman: { tool: number; naive: number } }]>) {
    assert(m.spearman.tool > m.spearman.naive, `${season}: the evaluator ranks better`);
  }
  // paired error bars: better ranking overall, and no kind of trade (1-for-1 … 2-for-2) where it ranks worse
  assert(s.overall.toolMinusNaiveCI.spearman[0] > 0 && s.overall.toolMinusNaiveCI.signAccuracy[0] > 0, "tool − naive: Spearman and sign accuracy above 0 (paired 95 % CI)");
  assert(s.overall.mae.tool < s.overall.mae.naive, "the evaluator's point gains are closer to the real ones");
  // the tab's « Validation » paragraph quotes the committed backtest
  const tab = readFileSync(join(process.cwd(), "src", "components", "trade", "TradeTab.tsx"), "utf8").replace(/\s+/g, " ");
  const fr = (x: number, d: number) => x.toFixed(d).replace(".", ",");
  for (const quote of [
    `corrélation de rang ${fr(s.overall.spearman.tool, 2)} contre ${fr(s.overall.spearman.naive, 2)}`,
    `bon sens du gain ${fr(100 * s.overall.signAccuracy.tool, 1)} % contre ${fr(100 * s.overall.signAccuracy.naive, 1)} %`,
    `écart moyen aux points réels ${fr(s.overall.mae.tool, 1)} contre ${fr(s.overall.mae.naive, 1)}`,
  ]) assert(tab.includes(quote), `TradeTab quotes the backtest: « ${quote} »`);
  for (const [kind, m] of Object.entries(s.byKind) as Array<[string, { spearman: { tool: number; naive: number } }]>) {
    assert(m.spearman.tool > m.spearman.naive, `${kind}: the evaluator ranks better`);
  }
}

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log("OK: trade evaluator");
