/**
 * Unit checks for the draft VONA helper and the waiver Δ scorer.
 * Run: npx tsx scripts/test-fantrax-draft-waivers.ts
 */
import type { SlotId } from "../src/lib/fantrax/config";
import { draftOutlook, draftValue, type DraftPickInfo, type DraftPoolPlayer } from "../src/lib/fantrax/draft";
import { eligibleSlots, type LineupCandidate } from "../src/lib/fantrax/lineup";
import { cappedTotal, dayParts, periodTotal, waiverTargets, type WaiverDay } from "../src/lib/fantrax/waivers";
import { capBenchPolicy, withCapBench } from "../src/lib/fantrax/daily-plan";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

// ---- draft: fixed order, me = "me" at picks 4 and 8 of 10.
const picks: DraftPickInfo[] = Array.from({ length: 10 }, (_, i) => ({
  pick: i + 1,
  round: 1,
  teamId: i === 3 || i === 7 ? "me" : `t${i}`,
  ...(i < 2 ? { playerId: `taken${i}` } : {}),
}));
const pool: DraftPoolPlayer[] = [
  { id: "taken0", groups: ["C"], seasonFp: 400, adp: 1 },
  { id: "g1", groups: ["G"], seasonFp: 250, adp: 3 },
  { id: "g2", groups: ["G"], seasonFp: 200, adp: 50 },
  { id: "d1", groups: ["D"], seasonFp: 240, adp: 4 },
  { id: "d2", groups: ["D"], seasonFp: 235, adp: 60 },
  { id: "w1", groups: ["W"], seasonFp: 300, adp: 2 },
  { id: "w2", groups: ["W"], seasonFp: 290, adp: 70 },
  { id: "c1", groups: ["C"], seasonFp: 280, adp: 80 },
];
// A steep synthetic board: checked under the narrow first-guess ADP noise,
// where the mechanics bite hardest (the fitted noise is replayed on the real
// drafts in test-fantrax-vona).
const NARROW = { sigma: 0.35, offset: 5 } as const;
const o = draftOutlook(picks, "me", pool, {}, { adp: NARROW });
assert(o.state === "running" && o.made === 2, "2 of 10 made");
assert(o.current?.pick === 3 && o.next?.pick === 4 && o.following?.pick === 8, "current #3, mine #4 then #8");
assert(o.picksBefore === 1 && o.picksBeforeFollowing === 4, "one pick before mine, four before the next one");
// ADP ranks among the available: w1 1, g1 2, d1 3, g2 4, d2 5, w2 6, c1 7.
// One pool pick before #4, four before #8 (poolShare 1): G drops from g1
// (250) to g2 (200) and g1 goes early, so G is the position to take now.
const row = (out: typeof o, id: string) => out.board.find((b) => b.id === id)!;
assert(o.vona.G.bestId === "g1" && o.vona.G.vona! > 20, `G: steep drop (${o.vona.G.vona})`);
assert(
  o.vona.G.vona! > o.vona.W.vona! && o.vona.G.vona! > o.vona.D.vona! && o.vona.W.vona! > 0 && o.vona.D.vona! > 0,
  "G outranks the flat W and D",
);
assert(near(o.vona.C.vona!, 0) && near(o.vona.C.now, 280), "C: lone deep-ADP c1 is there both times");
assert(o.vona.G.laterId === "g2", "g2 is the likely best G by #8");
// One pool pick before #4, shared among the seven: ADP-first w1 is the
// likeliest to go (~42%), and the odds add up to exactly one player gone.
assert(
  o.board[0]!.id === "w1" &&
    near(o.board[0]!.available, 0.583, 0.005) &&
    o.board.every((b) => b.available >= o.board[0]!.available),
  `ADP-first w1: likeliest gone by #4 (${o.board[0]!.available})`,
);
assert(near(o.board.reduce((a, b) => a + 1 - b.available, 0), 1, 1e-6), "one pool pick → one player expected gone");
assert(row(o, "c1").available > 0.98 && !row(o, "c1").likelyGone, "deep ADP survives");
assert(row(o, "g1").vona! > 40 && row(o, "g1").vonaGroup === "G", "g1: big per-player VONA");
assert(row(o, "g2").vona! < 0, "g2: worth less than the G expected at #8");
assert(!o.board.some((b) => b.id === "taken0"), "drafted players leave the board");
// Empty D/G slots add up to +50%.
assert(near(draftValue(pool[3]!, { D: 1 }), 240 * 1.5) && near(draftValue(pool[3]!, { G: 1 }), 240), "need bonus");
const onClock = draftOutlook(
  picks.map((p) => (p.pick === 3 ? { ...p, playerId: "c1" } : p)),
  "me",
  pool,
  {},
  { adp: NARROW },
);
assert(onClock.picksBefore === 0 && onClock.next?.pick === 4, "on the clock → 0 picks before");
assert(onClock.board.every((b) => b.available === 1), "on the clock → everyone is still there");
assert(near(onClock.vona.W.now, 300) && onClock.vona.W.bestId === "w1" && onClock.vona.W.bestP === 1, "on the clock → best now is the best left");
// When two picks in three go to prospects outside the pool, fewer pool
// players are expected gone: w1 likely survives to #4 and G is less urgent.
const third = draftOutlook(picks, "me", pool, {}, { poolShare: 1 / 3, adp: NARROW });
assert(third.vona.W.bestId === "w1" && !row(third, "w1").likelyGone, "w1 likely survives to #4");
assert(row(third, "w1").available > row(o, "w1").available, "fewer pool picks → better odds");
assert(third.vona.G.vona! > 0 && third.vona.G.vona! < o.vona.G.vona!, "G less urgent with fewer pool picks");
const done = draftOutlook(picks.map((p) => ({ ...p, playerId: p.playerId ?? `x${p.pick}` })), "me", pool);
assert(done.state === "done" && done.next === null, "finished draft");
const last = draftOutlook(picks.map((p) => (p.pick === 8 ? { ...p, teamId: "t7" } : p)), "me", pool);
assert(last.following === null && last.vona.G.vona === null && last.board.every((b) => b.vona === null), "last pick: no VONA");

// ---- waivers: roster with an empty D slot; two lineup days.
const cand = (id: string, e: string, v: number, status = "ACTIVE"): LineupCandidate => {
  const eligible = eligibleSlots(e);
  const values: Partial<Record<SlotId, number>> = {};
  for (const s of eligible) values[s] = s === "Skt" ? 1.5 * v : v;
  return { id, eligible, status, values };
};
const roster = [cand("f1", "W,F,Skt", 3), cand("f2", "W,F,Skt", 2), cand("d1", "D,Skt", 2)];
const pickups: Record<string, number> = { fa: 3, ww: 3.2 };
const days: WaiverDay[] = [0, 1].map((i) => ({
  candidates: roster,
  wwUsable: i >= 1,
  poolCandidate: (id) => (pickups[id] ? cand(id, "D", pickups[id]!, id === "ww" ? "WW" : "FA") : null),
}));
const t = waiverTargets(
  days,
  [
    { id: "fa", status: "FA", fpg: 3 },
    { id: "ww", status: "WW", fpg: 3.2 },
  ],
  { slotCounts: { C: 0, W: 2, F: 0, D: 2, Skt: 1, G: 0 }, needsDrop: false, drops: [], minDelta: 3 },
);
assert(t[0]?.id === "fa" && near(t[0].delta, 6) && t[0].days === 2, "FA plays both days (+6)");
assert(t[1]?.id === "ww" && near(t[1].delta, 3.2) && t[1].days === 1, "WW only from day 2 (+3.2)");
const filtered = waiverTargets(days, [{ id: "ww", status: "WW", fpg: 3.2 }], {
  slotCounts: { C: 0, W: 2, F: 0, D: 2, Skt: 1, G: 0 },
  needsDrop: false,
  drops: [],
  minDelta: 5,
});
assert(filtered.length === 0, "gains below the threshold are hidden");
// Full roster: the cheapest drop is used.
const full = waiverTargets(days, [{ id: "fa", status: "FA", fpg: 3 }], {
  slotCounts: { C: 0, W: 2, F: 0, D: 1, Skt: 0, G: 0 },
  needsDrop: true,
  drops: [
    { id: "f1", action: "drop", fpg: 3 },
    { id: "d1", action: "minors", fpg: 2 },
  ],
  minDelta: 1,
});
assert(full[0]?.drop?.id === "d1" && full[0].drop.action === "minors" && near(full[0].delta, 2), "swap D for D, send the weaker to Minors");


// ---- waivers over the rest of the season (FX-2): the drop d1 is out this
// period (0) but back later at 3 a day, the pickup is a steady 2.5 D.
{
  const slotCounts = { C: 0, W: 2, F: 0, D: 1, Skt: 0, G: 0 };
  const now = [cand("f1", "W,F,Skt", 3), cand("f2", "W,F,Skt", 2), cand("d1", "D,Skt", 0)];
  const later = [cand("f1", "W,F,Skt", 3), cand("f2", "W,F,Skt", 2), cand("d1", "D,Skt", 3)];
  const pc = (id: string) => (id === "fa" ? cand("fa", "D", 2.5, "FA") : null);
  const period: WaiverDay[] = [0, 1].map(() => ({ candidates: now, wwUsable: true, poolCandidate: pc }));
  const rosDays = (weight: number): WaiverDay[] => [{ candidates: later, wwUsable: true, poolCandidate: pc, weight }];
  const run = (weight: number) =>
    waiverTargets(period, [{ id: "fa", status: "FA", fpg: 2.5 }], {
      slotCounts,
      needsDrop: true,
      drops: [{ id: "d1", action: "drop", fpg: 3 }],
      minDelta: 3,
      rosDays: rosDays(weight),
    });
  const short = run(4);
  assert(short[0]?.id === "fa" && near(short[0].delta, 5) && near(short[0].ros, -2) && short[0].rental === true, "a pickup that costs points after the period is a rental (+5 now, -2 later)");
  assert(run(20).length === 0, "a pickup that loses points over the season (+5 now, -10 later) is not shown");
  // Ranking is on the season: a smaller period gain with a lasting edge goes first.
  const pc2 = (id: string) => (id === "fa" ? cand("fa", "D", 2.5, "FA") : id === "fb" ? cand("fb", "D", 2, "FA") : null);
  const two = waiverTargets(
    period.map((d) => ({ ...d, poolCandidate: pc2 })),
    [
      { id: "fa", status: "FA", fpg: 2.5 },
      { id: "fb", status: "FA", fpg: 2 },
    ],
    {
      slotCounts: { ...slotCounts, D: 2 },
      needsDrop: false,
      drops: [],
      minDelta: 3,
      rosDays: [{ candidates: later, wwUsable: true, weight: 10, poolCandidate: (id) => (id === "fa" ? cand("fa", "D", 0) : id === "fb" ? cand("fb", "D", 2) : null) }],
    },
  );
  assert(two.map((t) => t.id).join() === "fb,fa", "fb (+4 now, +20 later) ranks above fa (+5 now, nothing later)");
}

// ---- waivers under a games cap (FX-3): every lineup player plays one game.
{
  const slotCounts = { C: 0, W: 2, F: 0, D: 2, Skt: 0, G: 0 };
  const games = (c: LineupCandidate) => ({ ...c, games: 1 });
  const r = [cand("f1", "W,F,Skt", 3), cand("f2", "W,F,Skt", 2), cand("d1", "D,Skt", 2)].map(games);
  const capDays: WaiverDay[] = [0, 1].map(() => ({ candidates: r, wwUsable: true, poolCandidate: (id) => (id === "fa" ? games(cand("fa", "D", 3, "FA")) : null) }));
  const opts = { slotCounts, needsDrop: false, drops: [], minDelta: -100 };
  const blind = waiverTargets(capDays, [{ id: "fa", status: "FA", fpg: 3 }], opts);
  assert(near(blind[0]!.delta, 6), "no cap: +3 a day for two days");
  // Base: 3 games on day 1, under the cap, so day 2 counts (7 + 7). With him:
  // 4 games on day 1 reach the cap, day 2 counts nothing (10).
  const tightCap = { gpMax: 4, gpUsed: 0, gsMax: null, gsUsed: 0 };
  const capped = (f: (d: WaiverDay) => LineupCandidate[]) => periodTotal(capDays, f, slotCounts, undefined, tightCap);
  const fa = games(cand("fa", "D", 3, "FA"));
  assert(near(capped((d) => d.candidates), 14) && near(capped((d) => [...d.candidates, fa]), 10), "the day the cap is reached counts in full, nothing after it");
  const tight = waiverTargets(capDays, [{ id: "fa", status: "FA", fpg: 3 }], { ...opts, cap: tightCap });
  assert(tight.length === 0, "an add that makes the team hit its cap a day earlier costs points (-4): not shown");
  const loose = waiverTargets(capDays, [{ id: "fa", status: "FA", fpg: 3 }], { ...opts, cap: { gpMax: 8, gpUsed: 0, gsMax: null, gsUsed: 0 } });
  assert(near(loose[0]!.delta, 6), "a cap that is not reached changes nothing");
  const used = waiverTargets(capDays, [{ id: "fa", status: "FA", fpg: 3 }], { ...opts, cap: { gpMax: 8, gpUsed: 5, gsMax: null, gsUsed: 0 } });
  assert(near(used[0]!.delta, 3), "games already played count toward the cap: only day 1 is left (+3)");
}

// ---- the rest of season under each later period's caps (FX-2 / FX-3
// regression): a full roster that reaches its 4-game cap on the first day of
// every later period gains nothing from an add who only fills a seat on a
// day already past the cap; cap-blind, he read as +3 a day.
{
  const slotCounts = { C: 0, W: 2, F: 0, D: 2, Skt: 0, G: 0 };
  const g = (c: LineupCandidate, games = 1) => ({ ...c, games });
  // Day 1 of each period: the four starters play (4 games = the cap). Day 2:
  // only the two wingers play, one D seat is free for the pickup.
  const day1 = [g(cand("f1", "W,F,Skt", 3)), g(cand("f2", "W,F,Skt", 2)), g(cand("d1", "D,Skt", 2)), g(cand("d2", "D,Skt", 2))];
  const day2 = [g(cand("f1", "W,F,Skt", 3)), g(cand("f2", "W,F,Skt", 2)), g(cand("d1", "D,Skt", 0), 0), g(cand("d2", "D,Skt", 0), 0)];
  // A Reserve player who never makes the lineup: his games must not count.
  const reserve = { ...g(cand("r1", "W,F,Skt", 0.5)), status: "RESERVE" };
  const fa = g(cand("fa", "D", 3, "FA"));
  const later: WaiverDay[] = [9, 9, 10, 10].map((capPeriod, i) => ({
    candidates: [...(i % 2 === 0 ? day1 : day2), reserve],
    wwUsable: true,
    capPeriod,
    poolCandidate: (id) => (id === "fa" && i % 2 === 1 ? fa : null),
  }));
  const now: WaiverDay[] = [{ candidates: day2, wwUsable: true, poolCandidate: (id) => (id === "fa" ? fa : null) }];
  const base = { slotCounts, needsDrop: false, drops: [], minDelta: 0, rosDays: later };
  const blind = waiverTargets(now, [{ id: "fa", status: "FA", fpg: 3 }], base);
  assert(near(blind[0]!.ros, 6), `cap-blind: +3 on each later day 2 (${blind[0]?.ros})`);
  const rosCaps = new Map([9, 10].map((n) => [n, { gpMax: 4, gsMax: null }] as const));
  const capped = waiverTargets(now, [{ id: "fa", status: "FA", fpg: 3 }], { ...base, rosCaps });
  assert(capped.length === 1 && near(capped[0]!.ros, 0), `capped: day 2 of each period is past the 4-game cap, the add is worth nothing later (${capped[0]?.ros})`);
  // The counter restarts with each period, and a cap not reached costs nothing.
  const loose = waiverTargets(now, [{ id: "fa", status: "FA", fpg: 3 }], { ...base, rosCaps: new Map([9, 10].map((n) => [n, { gpMax: 6, gsMax: null }] as const)) });
  assert(near(loose[0]!.ros, 6), `a 6-game cap is not reached before day 2: +3 twice (${loose[0]?.ros})`);
  // Only ACTIVE lineup games accrue: with the Reserve winger's games counted
  // a 5-game cap would be reached on day 1; it is not.
  const five = waiverTargets(now, [{ id: "fa", status: "FA", fpg: 3 }], { ...base, rosCaps: new Map([9, 10].map((n) => [n, { gpMax: 5, gsMax: null }] as const)) });
  assert(near(five[0]!.ros, 6), `Reserve players accrue no games toward the cap (${five[0]?.ros})`);
  assert(cappedTotal([{ skaterPoints: 5, goaliePoints: 2, gp: 3, gs: 1 }, { skaterPoints: 5, goaliePoints: 2, gp: 3, gs: 1 }], [1, 1], () => ({ key: 1, cap: { gpMax: 3, gsMax: 1, gpUsed: 0, gsUsed: 0 } })) === 7, "cappedTotal: day 1 in full, nothing after either cap");
  // A dressed player projected at 0 points still uses his games.
  const zero = dayParts(
    [
      { id: "z", eligible: ["C"], status: "ACTIVE", values: { C: 0 }, games: 1 },
      { id: "zg", eligible: ["G"], status: "ACTIVE", values: { G: 0 }, games: 0.6 },
    ],
    { C: 1, W: 0, F: 0, D: 0, Skt: 0, G: 1 },
    undefined,
  );
  assert(zero.gp === 1 && near(zero.gs, 0.6) && zero.skaterPoints === 0, `0-point active players count their games (${JSON.stringify(zero)})`);
}

// ---- games-cap bench policy (FX-8): two weak wingers fill both W seats on
// day 1 and reach the 2-game cap, so the star who only plays day 2 counts
// nothing. Benching anyone under 1 point a game saves the games for him.
{
  const slotCounts = { C: 0, W: 2, F: 0, D: 0, Skt: 0, G: 0 };
  const w = (id: string, v: number, games: number) => ({ ...cand(id, "W", v), games });
  const day1 = [w("w1", 1, 1), w("w2", 1, 1), w("s", 0, 0)];
  const day2 = [w("w1", 1, 1), w("w2", 1, 1), w("s", 4, 1)];
  const capT = { gpMax: 2, gpUsed: 0, gsMax: null, gsUsed: 0 };
  const policy = capBenchPolicy([day1, day2], slotCounts, ["W"], capT, { gp: true, gs: false });
  assert(policy !== null && policy.skater! > 1 && policy.skater! < 4 && policy.goalie === null, `bench the 1-point wingers (${JSON.stringify(policy)})`);
  assert(near(policy!.gain, 2), `gain 4 - 2 (${policy?.gain})`);
  assert(withCapBench(day2, policy!).filter((c) => Object.keys(c.values).length > 0).map((c) => c.id).join() === "s", "only the star stays in the lineup");
  assert(capBenchPolicy([day1, day2], slotCounts, ["W"], { ...capT, gpMax: 4 }, { gp: true, gs: false }) === null, "no policy when the cap does not bite");
  const locked = { ...w("w1", 1, 1), locked: true };
  assert(withCapBench([locked], { skater: 2, goalie: null })[0] === locked, "a locked player is never benched");
}

if (failed) process.exit(1);
console.log("OK: fantrax draft + waivers");
