/**
 * Unit checks for `src/lib/fantrax/points-vor.ts`: the optimal league-wide
 * fill and the replacement levels a Fantrax points league's draft board is
 * ranked by.
 *
 * The reason this file exists: a scratch prototype seated each player at his
 * PRIMARY position only, and on Slapshot's 32 x C4/LW4/RW4/D6/G2 that put the
 * LW replacement level at 134.5 season points against 48.4 for RW — a 2.7x gap
 * between two interchangeable wings, which pushed Kaprizov, Boldy, Kyle Connor
 * and Robertson 20 to 40 ranks below their points rank. The last block runs
 * the real committed pool and pins that the artifact is gone.
 *
 * Run: npx tsx scripts/test-fantrax-points-vor.ts
 */
import { existsSync, readFileSync } from "fs";
import { CAPTAINS_DYNASTY, SLAPSHOT, type FantraxLeagueConfig } from "../src/lib/fantrax/config";
import { seasonFp } from "../src/lib/fantrax/draft-inputs";
import { canRankByPoints, leagueSeats, pointsVor, type VorPlayer } from "../src/lib/fantrax/points-vor";
import type { ValuesSnapshot } from "../src/lib/fantrax/snapshot-types";
import { fantraxPaths } from "./fantrax-paths";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) return;
  failed++;
  console.error(`FAIL: ${msg}`);
}
function eq(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  assert(a === b, `${msg} (got ${a}, expected ${b})`);
}

// ---------------------------------------------------- 1. which leagues it covers
{
  assert(canRankByPoints(SLAPSHOT), "Slapshot: every slot scores a skater alike, so one value per player ranks it");
  assert(
    !canRankByPoints(CAPTAINS_DYNASTY),
    "Captains: a captain slot multiplies the seat's offense, so a single value ordering is the wrong model",
  );
}

// ---------------------------------------------------- 2. the seats are the league's
{
  const seats = leagueSeats(SLAPSHOT);
  eq(seats.map((s) => s.slot), ["C", "LW", "RW", "D", "G"], "seats in the config's slot order");
  eq(seats.map((s) => s.capacity), [128, 128, 128, 192, 64], "32 teams x C4 LW4 RW4 D6 G2");
  eq(seats.reduce((n, s) => n + s.capacity, 0), 640, "640 starting seats");
  // The synced league.json wins over the config's fallback counts.
  eq(
    leagueSeats(SLAPSHOT, { C: 1, LW: 1, RW: 1, D: 1, G: 1 }).map((s) => s.capacity),
    [32, 32, 32, 32, 32],
    "slot counts can come from the synced league.json",
  );
}

// ---------------------------------------------------- 3. the wing artifact, in miniature
/**
 * A two-team league, one seat per wing. Four wingers: two pure LW and two
 * LW/RW duals, the duals better. Seating each player at his first slot fills
 * LW with the two duals and leaves RW to a pure LW who cannot sit there, so RW
 * ends up empty (or filled by someone far worse) while LW looks deep. The
 * optimal fill moves the duals to RW and seats the pure LWs at LW.
 */
{
  const league: FantraxLeagueConfig = {
    ...SLAPSHOT,
    slug: "mini",
    teams: 2,
    slots: { order: ["LW", "RW"], counts: { LW: 1, RW: 1 } },
  };
  const players: VorPlayer[] = [
    { id: "dual1", eligiblePos: "LW,RW", seasonFp: 100 },
    { id: "dual2", eligiblePos: "LW,RW", seasonFp: 90 },
    { id: "lw1", eligiblePos: "LW", seasonFp: 80 },
    { id: "lw2", eligiblePos: "LW", seasonFp: 70 },
    { id: "rw1", eligiblePos: "RW", seasonFp: 10 },
    { id: "lw3", eligiblePos: "LW", seasonFp: 5 },
  ];
  const v = pointsVor(league, players, { reservePerTeam: 0 });
  eq(v.seats, 4, "4 seats (2 teams x LW1 RW1)");
  eq(v.seated, 4, "all four seats filled");
  // The four best wingers are seated, whatever side they nominally play.
  eq(
    v.rows.filter((r) => r.slot !== null).map((r) => r.id).sort(),
    ["dual1", "dual2", "lw1", "lw2"],
    "the four best wingers are seated, not the two duals plus whoever happens to be RW",
  );
  // rw1 (10 points) would be a starter under a naive per-side fill; he is not.
  eq(v.byId.get("rw1")!.slot, null, "a 10-point right wing does not start ahead of an 80-point left wing");
  // One level per WING, each the weakest seated player eligible there. A dual
  // counts for both, so the flex chain is built in.
  eq(v.replacement.LW, 70, "the LW level is the weakest seated LW-eligible starter (lw2)");
  eq(v.replacement.RW, 90, "the RW level is the weakest seated RW-eligible starter (dual2)");
  // …and the value of a dual is unchanged by the split: he is measured against
  // whichever of his wings replaces him most cheaply, which is what he would
  // really cost the league.
  eq(v.byId.get("dual1")!.vor, 30, "VOR of the best winger");
  eq(v.marginalStarter, { LW: 70, RW: 90 }, "the weakest starter of each slot");
  // The other reading, reported beside it: the best winger nobody holds.
  eq(v.rawReplacement.LW, 5, "best untaken LW (lw3)");
  eq(v.rawReplacement.RW, 10, "best untaken RW (rw1)");
}

// ---------------------------------------------------- 4. positional scarcity
/**
 * Two teams, D2 and G1 per team. A 100-point defenceman with a 95-point
 * replacement is worth far less than a 100-point goalie with a 20-point one,
 * and that is the whole job of the model.
 */
{
  const league: FantraxLeagueConfig = {
    ...SLAPSHOT,
    slug: "scarce",
    teams: 2,
    slots: { order: ["D", "G"], counts: { D: 2, G: 1 } },
  };
  const players: VorPlayer[] = [
    { id: "d1", eligiblePos: "D", seasonFp: 100 },
    { id: "d2", eligiblePos: "D", seasonFp: 99 },
    { id: "d3", eligiblePos: "D", seasonFp: 97 },
    { id: "d4", eligiblePos: "D", seasonFp: 95 },
    { id: "d5", eligiblePos: "D", seasonFp: 94 },
    { id: "g1", eligiblePos: "G", seasonFp: 100 },
    { id: "g2", eligiblePos: "G", seasonFp: 20 },
    { id: "g3", eligiblePos: "G", seasonFp: 5 },
  ];
  const v = pointsVor(league, players, { reservePerTeam: 0 });
  eq(v.replacement.D, 95, "the 4th and last D seat sets the D level");
  eq(v.replacement.G, 20, "the 2nd and last G seat sets the G level");
  eq(v.byId.get("g1")!.rank, 1, "the scarce goalie outranks the equally productive defenceman");
  eq(v.byId.get("d1")!.vor, 5, "the defenceman is 5 points better than the last starting D");
  eq(v.byId.get("g1")!.vor, 80, "the goalie is 80 points better than the last starting G");
  eq(v.byId.get("g1")!.groupRank, 1, "rank inside the goalie group");
  eq(v.byId.get("d1")!.groupRank, 1, "rank inside the D group");
}

// ---------------------------------------------------- 5. reserve seats and the untaken pool
{
  const league: FantraxLeagueConfig = {
    ...SLAPSHOT,
    slug: "reserve",
    teams: 1,
    slots: { order: ["C", "G"], counts: { C: 1, G: 1 } },
  };
  const players: VorPlayer[] = [
    { id: "c1", eligiblePos: "C", seasonFp: 100 },
    { id: "c2", eligiblePos: "C", seasonFp: 90 },
    { id: "c3", eligiblePos: "C", seasonFp: 80 },
    { id: "g1", eligiblePos: "G", seasonFp: 70 },
    { id: "g2", eligiblePos: "G", seasonFp: 60 },
    { id: "g3", eligiblePos: "G", seasonFp: 50 },
  ];
  // 2 reserve seats: the two best players left, both skaters here. The goalie
  // number is a CAP, not a reservation — an unspent goalie seat goes to a skater.
  const v = pointsVor(league, players, { reservePerTeam: 2, reserveGoaliesPerTeam: 1 });
  eq(v.taken, 4, "2 starters + 2 reserve seats");
  eq(v.untaken, 2, "g2 and g3 are left");
  eq(v.rawReplacement.C, v.replacement.C, "no untaken centre: the level falls back to the starting one");
  eq(v.rawReplacement.G, 60, "best untaken goalie");
  // The cap bites when goalies ARE the best players left. Without it, a bench
  // of spare keepers would push the goalie pool down to its 4-game tail — the
  // exact reason the goalie level is read off the last STARTING seat instead.
  const gHeavy: VorPlayer[] = [
    { id: "c1", eligiblePos: "C", seasonFp: 100 },
    { id: "g1", eligiblePos: "G", seasonFp: 99 },
    { id: "g2", eligiblePos: "G", seasonFp: 98 },
    { id: "g3", eligiblePos: "G", seasonFp: 97 },
    { id: "g4", eligiblePos: "G", seasonFp: 10 },
  ];
  const capped = pointsVor(league, gHeavy, { reservePerTeam: 2, reserveGoaliesPerTeam: 1 });
  eq(capped.taken, 3, "1 C + 1 G started, and only one spare goalie benched");
  eq(capped.rawReplacement.G, 97, "the cap leaves g3 in the pool");
  const uncapped = pointsVor(league, gHeavy, { reservePerTeam: 2, reserveGoaliesPerTeam: 2 });
  eq(uncapped.rawReplacement.G, 10, "without the cap the spare keepers take the pool down to its tail");
  // The level VOR subtracts is the weakest STARTER, not either of those.
  eq(v.replacement.C, 100, "the only C seat is the level");
  eq(v.replacement.G, 70, "the only G seat is the level");
  // A bench with no goalie cap would hold g2 AND g3 and leave no untaken goalie.
  const all = pointsVor(league, players, { reservePerTeam: 4, reserveGoaliesPerTeam: 4 });
  eq(all.taken, 6, "a deep bench holds everyone");
  eq(all.rawReplacement.G, all.replacement.G, "with nobody untaken the two readings agree");
}

// ---------------------------------------------------- 6. a player nobody's league can seat
{
  const v = pointsVor(SLAPSHOT, [
    { id: "ok", eligiblePos: "C", seasonFp: 100 },
    // Captains tokens: no slot of this league takes them.
    { id: "alien", eligiblePos: "W,F,Skt", seasonFp: 500 },
    { id: "zero", eligiblePos: "C", seasonFp: 0 },
  ]);
  eq(v.rows.map((r) => r.id), ["ok"], "a player eligible for no slot, and a 0-point one, are left out");
}

// ---------------------------------------------------- 7. determinism
{
  const players: VorPlayer[] = Array.from({ length: 40 }, (_, i) => ({
    id: `p${i}`,
    // Ties everywhere: the fill must still be reproducible.
    eligiblePos: ["C", "LW", "RW", "D", "G", "LW,RW"][i % 6]!,
    seasonFp: 100 - (i % 5),
  }));
  const a = pointsVor(SLAPSHOT, players, { reservePerTeam: 1 });
  const b = pointsVor(SLAPSHOT, [...players].reverse(), { reservePerTeam: 1 });
  eq(a.rows.map((r) => r.id), b.rows.map((r) => r.id), "the same pool in another order gives the same board");
  eq(a.replacement, b.replacement, "and the same levels");
}

// ---------------------------------------------------- 8. the real board
/**
 * The committed Slapshot values: the artifact the scratch prototype had must
 * be gone. « Near his points rank » is the test — VOR is allowed to move a
 * winger a rank or two (the winger pool is deeper than the centre pool), but
 * not 20 to 40.
 */
{
  const paths = fantraxPaths(SLAPSHOT);
  if (!existsSync(paths.values)) {
    console.warn(`WARN: ${SLAPSHOT.slug} values.json missing — skipping the real-board check`);
  } else {
    const values = JSON.parse(readFileSync(paths.values, "utf8")) as ValuesSnapshot;
    const league = JSON.parse(readFileSync(paths.league, "utf8")) as { slotCounts: Record<string, number> };
    const proj = Object.entries(values.players).filter(([, r]) => r.src === "proj");
    const pool: VorPlayer[] = proj.map(([id, r]) => ({ id, eligiblePos: r.e, seasonFp: seasonFp(r, SLAPSHOT) }));
    const v = pointsVor(SLAPSHOT, pool, { slotCounts: league.slotCounts });
    eq(v.seats, 640, "the real league has 640 starting seats");
    eq(v.seated, 640, "and the projected pool fills every one of them");

    // The three forward pools must come out at the same depth: that IS the fix.
    const { C, LW, RW } = v.marginalStarter;
    const wings = [C!, LW!, RW!];
    const spread = Math.max(...wings) / Math.min(...wings);
    assert(
      spread < 1.15,
      `C / LW / RW replacement levels agree within 15% (${wings.map((x) => x.toFixed(1)).join(" / ")}, spread ${spread.toFixed(2)}x)`,
    );

    // Splitting the wings must not split their DEPTH: an optimal league-wide
    // fill moves LW/RW duals to the open side, so the two levels come out
    // within a couple of points and no winger is valued off the wrong wing.
    const lw = v.replacement.LW ?? 0;
    const rw = v.replacement.RW ?? 0;
    assert(
      Math.abs(lw - rw) / Math.max(lw, rw) < 0.1,
      `the two winger levels agree within 10% (LW ${lw.toFixed(1)}, RW ${rw.toFixed(1)})`,
    );

    const byName = new Map(Object.entries(values.players).map(([id, r]) => [r.n, id]));
    const fpRank = new Map([...pool].sort((a, b) => b.seasonFp - a.seasonFp).map((p, i) => [p.id, i + 1] as const));
    for (const who of ["Kirill Kaprizov", "Matt Boldy", "Kyle Connor", "Jason Robertson"]) {
      const id = byName.get(who);
      const row = id ? v.byId.get(id) : undefined;
      if (!row || !id) {
        console.warn(`WARN: ${who} is not in the committed pool — skipped`);
        continue;
      }
      const gap = Math.abs(row.rank - fpRank.get(id)!);
      assert(gap <= 6, `${who}: VOR rank ${row.rank} is near his points rank ${fpRank.get(id)} (gap ${gap})`);
      assert(row.group === "LW" || row.group === "RW", `${who} is valued as a winger (got ${row.group})`);
    }
    // Multi-eligibility really moves people: at least one LW/RW dual is seated
    // on the right wing (Boldy, in the 2026-09-27 pool).
    const duals = v.rows.filter((r) => values.players[r.id]!.e === "LW,RW" && r.slot === "RW");
    assert(duals.length > 0, "an LW/RW dual is seated at RW, which a per-side fill can never do");
    // Goalies are scarce here, but not 40% of the board.
    const gTop100 = v.rows.slice(0, 100).filter((r) => r.group === "G").length;
    assert(gTop100 <= 26, `goalies in the top 100 stay plausible (${gTop100}; 64 of 640 seats are goalie seats)`);
    // In season the order moves with the stats (scripts/update-in-season.ts):
    // a star stays near the top, whoever leads this week.
    const mack = v.rows.findIndex((r) => r.id === byName.get("Nathan MacKinnon"));
    assert(mack >= 0 && mack < 10, `MacKinnon stays in the top 10 of the board (${mack + 1})`);
  }
}

if (failed) process.exit(1);
console.log("OK: Fantrax points VOR (optimal league fill, replacement levels, the real Slapshot board)");
