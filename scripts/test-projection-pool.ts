/**
 * Board membership and games budget (src/lib/projection-pool.ts): rookie
 * games by draft slot and club list, stale players, club skater-games band.
 * Run: npx tsx scripts/test-projection-pool.ts
 */
import {
  normalizeTeamSkaterGp,
  rookieGpPrior,
  ROOKIE_OFF_ROSTER_MAX_GP,
  SKATER_GAMES_PER_TEAM,
  staleReason,
} from "../src/lib/projection-pool";
import type { NhlListKind } from "../src/lib/nhl-rosters";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failed++;
    console.error(`FAIL: ${name}${detail ? ` (${detail})` : ""}`);
  }
}

// Rookie games: draft slot × list, never the flat 62 of the old contextual path.
check("1st overall on a roster ~49", rookieGpPrior(1, "roster") === 49, String(rookieGpPrior(1, "roster")));
check("10th overall on a roster ~30", rookieGpPrior(10, "roster") === 30);
check("undrafted on a roster ~17", rookieGpPrior(null, "roster") === 17);
for (const list of ["prospect", "org", null] as Array<NhlListKind | null>) {
  for (const pick of [1, 3, 12, 40, null]) {
    const gp = rookieGpPrior(pick, list);
    check(`off-roster rookie (${list}, pick ${pick}) ≤ ${ROOKIE_OFF_ROSTER_MAX_GP}`, gp <= ROOKIE_OFF_ROSTER_MAX_GP, String(gp));
  }
}
check("a better pick never gets fewer games", rookieGpPrior(2, "roster") >= rookieGpPrior(20, "roster"));

// Stale players.
const lists = new Map<number, NhlListKind>([[1, "roster"], [2, "org"]]);
const hist = (seasons: Array<[number, number]>, isActive = true) => ({
  isActive,
  teamHistory: seasons.map(([seasonId, gamesPlayed]) => ({ seasonId, gamesPlayed })),
});
const last2 = [20252026, 20242025] as const;
check("listed: kept", staleReason(1, lists, hist([]), last2) === null);
check("org list: kept", staleReason(2, lists, hist([[20232024, 70]]), last2) === null);
check("no list, no game since 2023-24: dropped", staleReason(3, lists, hist([[20232024, 70]]), last2) !== null);
check("no list, played 2025-26, inactive in July: kept (the index lags signings)", staleReason(4, lists, hist([[20252026, 67]], false), last2) === null);
check("no list, played 2025-26, active: kept", staleReason(5, lists, hist([[20252026, 67]]), last2) === null);
check("no snapshot: nobody dropped", staleReason(3, null, hist([]), last2) === null);

// Club skater-games budget: 18 × 82 ± 5 %.
{
  const short = Array.from({ length: 24 }, (_, i) => ({ id: i + 1, team: "NSH", gamesPlayed: i < 12 ? 70 : 30 }));
  const total = short.reduce((s, p) => s + p.gamesPlayed, 0); // 1200
  const gp = normalizeTeamSkaterGp(short, 80);
  const after = [...gp.values()].reduce((s, x) => s + x, 0);
  check("short club brought to the band", Math.abs(after - SKATER_GAMES_PER_TEAM * 0.95) < 1, `${total} → ${after.toFixed(1)}`);
  check("never above the ceiling", [...gp.values()].every((x) => x <= 80 + 1e-9));
  const regular = gp.get(1)! - 70;
  const depth = gp.get(13)! - 30;
  check("uncertain availability absorbs more", depth > regular, `${depth.toFixed(1)} vs ${regular.toFixed(1)}`);
  const inBand = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, team: "TOR", gamesPlayed: 74 }));
  check("club inside the band untouched", normalizeTeamSkaterGp(inBand, 80).size === 0);
  const heavy = Array.from({ length: 26 }, (_, i) => ({ id: i + 1, team: "EDM", gamesPlayed: 70 }));
  const down = [...normalizeTeamSkaterGp(heavy, 80).values()].reduce((s, x) => s + x, 0);
  check("heavy club brought down to the band", Math.abs(down - SKATER_GAMES_PER_TEAM * 1.05) < 1, down.toFixed(1));
}

if (failed > 0) {
  console.error(`${failed} projection-pool check(s) failed`);
  process.exit(1);
}
console.log("OK: projection pool (rookie games, stale players, club budget)");
