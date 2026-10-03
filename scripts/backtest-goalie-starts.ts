/**
 * Goalie start odds, off CI: how well the plan's P(start) — each goalie's
 * share of his club's starts (last 20 games, shrunk to last season's share),
 * moved toward the backup on the second night of a back-to-back
 * (`backToBackShares`, the starter keeps `factor` of his share) — predicts
 * who starts, over every club game of past seasons (NHL stats REST goalie
 * game lines, `mgmt-sim.ts`). Brier score and log loss per goalie-night,
 * for factors 0.2..1 (1 = no back-to-back adjustment) and the season-long
 * share alone.
 *
 * Run: npx tsx scripts/backtest-goalie-starts.ts --cache=<dir> [--seasons=...]
 */
import { Knowledge, loadSeason, meanCi } from "./mgmt-sim";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const CACHE = arg("cache") ?? process.env.MGMT_CACHE;
if (!CACHE) {
  console.error("--cache=<dir> is required (see mgmt-sim.ts)");
  process.exit(1);
}
const SEASONS = (arg("seasons") ?? "20212022,20222023,20232024,20242025,20252026").split(",");
const FACTORS = (arg("factors") ?? "0.15,0.25,0.35,0.45,0.5,0.55,0.6,0.7,1").split(",").map(Number);
const MAX_SHARE = 0.85;

/** The plan's back-to-back move, with the starter keeping `f` of his share. */
function b2b(shares: Map<number, number>, f: number): Map<number, number> {
  const ranked = [...shares.entries()].filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]);
  const out = new Map(shares);
  if (!ranked.length) return out;
  const [sid, sp] = ranked[0]!;
  const moved = sp * (1 - f);
  out.set(sid, sp - moved);
  if (ranked[1]) out.set(ranked[1][0], Math.min(MAX_SHARE, ranked[1][1] + moved));
  return out;
}

const res: Record<string, { brier: number[]; ll: number[] }> = {};
const add = (key: string, p: number, y: number) => {
  const r = (res[key] ??= { brier: [], ll: [] });
  const q = Math.min(0.99, Math.max(0.01, p));
  r.brier.push((q - y) ** 2);
  r.ll.push(-(y * Math.log(q) + (1 - y) * Math.log(1 - q)));
};
let b2bNights = 0;
for (const sid of SEASONS) {
  const s = loadSeason(CACHE!, sid);
  const k = new Knowledge(s);
  // Starts by club and day.
  const starter = new Map<string, number>();
  for (const [id, list] of s.gl) for (const g of list) if (g.gs > 0) starter.set(`${g.team}|${g.day}`, id);
  for (const [team, days] of s.teamDays) {
    for (const x of days) {
      if (x < 14) continue;
      const truth = starter.get(`${team}|${x}`);
      if (truth === undefined) continue;
      // The club's goalies as known that morning.
      const shares = new Map<number, number>();
      for (const id of s.gl.keys()) {
        const v = k.view(id, x);
        if (v.team === team && !v.out && v.p > 0) shares.set(id, v.p);
      }
      if (!shares.size) continue;
      const isB2b = s.teamPlays.get(team)?.has(x - 1) ?? false;
      if (isB2b) b2bNights++;
      for (const f of FACTORS) {
        const p = isB2b ? b2b(shares, f) : shares;
        for (const [id, q] of p) {
          add(`f=${f}${isB2b ? " b2b" : ""}`, q, id === truth ? 1 : 0);
          add(`f=${f} all`, q, id === truth ? 1 : 0);
        }
      }
    }
  }
}
console.log(`back-to-back second nights: ${b2bNights}`);
for (const [key, r] of Object.entries(res).sort()) {
  const b = meanCi(r.brier);
  console.log(`${key.padEnd(12)} Brier ${b.mean.toFixed(4)} [${b.lo.toFixed(4)}, ${b.hi.toFixed(4)}]  log loss ${meanCi(r.ll).mean.toFixed(4)}  n=${b.n}`);
}
