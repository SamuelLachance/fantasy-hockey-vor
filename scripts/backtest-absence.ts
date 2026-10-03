/**
 * How long a « known out » NHL regular stays out, off CI: every day a skater
 * who had dressed for 10+ of his club's games has missed its last 3, the
 * club games until he dresses again (NHL stats REST game lines,
 * `mgmt-sim.ts`). The share back within k club games is what an absent
 * player's later games are worth (`returnOdds`), instead of nothing for the
 * rest of the season.
 *
 * Run: npx tsx scripts/backtest-absence.ts --cache=<dir> [--seasons=...]
 */
import { loadSeason } from "./mgmt-sim";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const CACHE = arg("cache") ?? process.env.MGMT_CACHE;
if (!CACHE) {
  console.error("--cache=<dir> is required (see mgmt-sim.ts)");
  process.exit(1);
}
const SEASONS = (arg("seasons") ?? "20212022,20222023,20232024,20242025,20252026").split(",");
const K = [1, 2, 3, 5, 7, 10, 15, 20, 30, 40];
const back = K.map(() => 0);
let n = 0;
let never = 0;
for (const sid of SEASONS) {
  const s = loadSeason(CACHE!, sid);
  for (const [, games] of s.sk) {
    // Club game index of each of his games (his club at the time).
    let lastTeam = "";
    for (let i = 0; i < games.length; i++) {
      const g = games[i]!;
      lastTeam = g.team;
      if (i + 1 < 10) continue;
      const td = s.teamDays.get(lastTeam)!;
      const played = new Set(games.map((x) => x.day));
      // Walk the club's games after this one; once he misses 3 in a row he is « out ».
      let j = td.indexOf(g.day) + 1;
      let missed = 0;
      while (j < td.length && !played.has(td[j]!)) {
        missed++;
        j++;
        if (missed === 3) break;
      }
      if (missed < 3) continue;
      // Out as of the next club game: club games until he dresses again.
      let wait = 0;
      let k = j;
      while (k < td.length && !played.has(td[k]!)) {
        wait++;
        k++;
      }
      n++;
      if (k >= td.length) never++;
      else K.forEach((kk, idx) => wait < kk && back[idx]!++);
    }
  }
}
console.log(`absences (regulars out 3+ club games): ${n}, never back that season ${((never / n) * 100).toFixed(1)} %`);
K.forEach((kk, i) => console.log(`  back within ${String(kk).padStart(2)} more club games: ${((back[i]! / n) * 100).toFixed(1)} %`));
