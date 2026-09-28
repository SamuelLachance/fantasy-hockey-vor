/**
 * Fit the dynasty model's undrafted route (params.json `prospect.undrafted`,
 * src/lib/dynasty/prospect.ts `undraftedProspect`) from the repo's history:
 * an undrafted player in an NHL organisation with next to no NHL games (the
 * players the Fantrax pools now list: org-players.ts) was valued at zero.
 *
 * P(make it | undrafted, age a, < 20 NHL GP) — make it = 200 NHL GP for a
 * skater, one 40-game season for a goalie (the research's pMake) — as a
 * steady-state ratio of two counts over the same population, undrafted
 * players on an NHL club's books at age a:
 *  - M_a: undrafted players per birth cohort (1985-1996: all past 30, so
 *    their careers are known) who made it, had fewer than 20 NHL games
 *    before the season they played at age a, and played NHL games that
 *    season: the only sign of an NHL contract the history carries
 *    (src/data/league-seasons.json: every NHL player since 2005-06, from
 *    the NHL landings). Verifier 2026-09-28: counting every player with a
 *    North American pro season by then (AHL and ECHL deals included) and an
 *    NHL game up to 2 seasons later put more players in M_a than the
 *    population U_a counts (age 21 F: 1.83 per cohort for 2 today), and the
 *    odds came out at 0.19-0.34. This M_a misses the players on an NHL deal
 *    at age a who first played a season or two later: a lower bound;
 *  - U_a: undrafted players of age a in NHL organisations today with fewer
 *    than 20 NHL games (src/data/nhl-rosters.json, their draft status from
 *    the profiles, league-seasons.json and nhl-org-bios.json), scaled by
 *    the league's size then (30.5 clubs) over now (32).
 * Either way the route caps the odds at the draft-slot model's for a
 * late-round pick of his age (`capPick`, prospect.ts): an undrafted player
 * is never worth more than a drafted one who has not arrived either.
 * The age curve is pooled over skaters (F and D share its shape; their level
 * is each group's own pooled ratio) and made non-increasing with age; goalies
 * are too few for a curve and take their pooled ratio times the skater shape.
 *  - arrival (eta): the median years from the season at age a to the first
 *    NHL season with 40+ games (skaters) among the M_a players;
 *  - prime FP/G if he makes it: league scoring (growth.ts seasonFpgLeague)
 *    of the undrafted skaters with 200+ NHL games in the current profiles,
 *    seasons at 24-27 with 40+ games, per group (goalies keep the slot
 *    model's prior).
 *
 * Run: npx tsx scripts/fit-undrafted-prospects.ts [--write]
 */
import { readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { seasonFpgLeague } from "../src/lib/dynasty/growth";
import { parseParams } from "../src/lib/dynasty/params";
import { interpPairs, lateSlotPMake } from "../src/lib/dynasty/prospect";
import type { NhlOrgBiosFile } from "../src/lib/fantrax/org-players";
import type { LeagueSeasonsCache } from "../src/lib/league-seasons";
import type { NhlRostersFile } from "../src/lib/nhl-rosters";
import type { PlayerProfile } from "../src/lib/profile-types";

const ROOT = process.cwd();
const read = <T>(...p: string[]) => JSON.parse(readFileSync(join(ROOT, ...p), "utf8")) as T;
const PARAMS = join(ROOT, "src", "data", "dynasty", "params.json");
const rawParams = JSON.parse(readFileSync(PARAMS, "utf8")) as Record<string, unknown>;
const params = parseParams(rawParams);

const COHORTS: [number, number] = [1985, 1996];
const AGES = Array.from({ length: 13 }, (_, i) => 18 + i); // 18 … 30
/** Age bands pooled for the fit (the players on NHL deals are too few per age to read one). */
const BANDS = [
  [18, 19],
  [20, 21, 22],
  [23, 24],
  [25, 26],
  [27, 28, 29, 30],
];
const MAX_GP = 20;
/**
 * The ceiling's draft slot: the last pick of round 5, the middle of the late
 * rounds (4-7) of a 32-club draft.
 */
const CAP_PICK = 160;
const CLUBS_THEN = 30.5;
const CLUBS_NOW = 32;
const NOW = 2026;

type G3 = "F" | "D" | "G";
const groupOf = (pos: string): G3 => (pos === "G" ? "G" : pos === "D" ? "D" : "F");
/** Age on Oct 1 of the season starting in `year`. */
const ageOn = (birth: string, year: number) => {
  const y = Number(birth.slice(0, 4));
  const md = birth.slice(5);
  return year - y - (md > "10-01" ? 1 : 0);
};

const seasons = read<LeagueSeasonsCache>("src", "data", "league-seasons.json").players;
const profiles = read<{ profiles: PlayerProfile[] }>("src", "data", "player-profiles.json").profiles;
const rosters = read<NhlRostersFile>("src", "data", "nhl-rosters.json").players;
const orgBios = read<NhlOrgBiosFile>("src", "data", "nhl-org-bios.json").players;

// ---- history: M_a per group and age (per cohort), and the arrival lags
const made = { F: new Map<number, number>(), D: new Map<number, number>(), G: new Map<number, number>() };
const lags = { F: new Map<number, number[]>(), D: new Map<number, number[]>(), G: new Map<number, number[]>() };
const madeTotal = { F: 0, D: 0, G: 0 };
for (const p of Object.values(seasons)) {
  if (!p || p.draft != null || p.draftYear != null || !/^\d{4}-\d{2}-\d{2}$/.test(p.birth)) continue;
  const by = Number(p.birth.slice(0, 4));
  if (by < COHORTS[0] || by > COHORTS[1]) continue;
  const g = groupOf(p.pos);
  const nhl = new Map<number, number>();
  for (const l of p.seasons) if (l[1] === "NHL") nhl.set(Math.floor(l[0] / 10000), (nhl.get(Math.floor(l[0] / 10000)) ?? 0) + l[2]);
  const years = [...nhl.keys()].sort((a, b) => a - b);
  const total = [...nhl.values()].reduce((s, x) => s + x, 0);
  const didMake = g === "G" ? years.some((y) => nhl.get(y)! >= 40) : total >= 200;
  if (!didMake) continue;
  madeTotal[g]++;
  const arrival = years.find((y) => nhl.get(y)! >= 40) ?? years[years.length - 1]!;
  for (const a of AGES) {
    // the season he plays at age a starts in the year where ageOn(...) = a
    const y = by + a + (p.birth.slice(5) > "10-01" ? 1 : 0);
    // on an NHL deal at age a: NHL games that season
    if (!nhl.has(y)) continue;
    const before = years.filter((s) => s < y).reduce((s, x) => s + nhl.get(x)!, 0);
    if (before >= MAX_GP) continue;
    made[g].set(a, (made[g].get(a) ?? 0) + 1);
    lags[g].set(a, [...(lags[g].get(a) ?? []), Math.max(0, arrival - y)]);
  }
}
const nCohorts = COHORTS[1] - COHORTS[0] + 1;

// ---- today: U_a per group and age (undrafted, fewer than 20 NHL games, in an organisation)
const profById = new Map(profiles.map((p) => [p.id, p]));
const atRisk = { F: new Map<number, number>(), D: new Map<number, number>(), G: new Map<number, number>() };
let unknown = 0;
for (const r of rosters) {
  const prof = profById.get(r.id);
  const ls = seasons[String(r.id)];
  const bio = orgBios[String(r.id)];
  const birth = prof?.bio?.birthDate ?? ls?.birth ?? bio?.b ?? r.birthDate;
  let undrafted: boolean | null = null;
  if (prof) undrafted = !prof.draft;
  else if (ls) undrafted = ls.draft == null && ls.draftYear == null;
  else if (bio) undrafted = bio.d == null;
  if (undrafted === null || !birth) {
    unknown++;
    continue;
  }
  if (!undrafted) continue;
  const gp = prof?.careerTotals?.gamesPlayed ?? (ls ? ls.seasons.filter((l) => l[1] === "NHL").reduce((s, l) => s + l[2], 0) : 0);
  if (gp >= MAX_GP) continue;
  const a = ageOn(birth, NOW);
  const g = groupOf(r.code);
  atRisk[g].set(a, (atRisk[g].get(a) ?? 0) + 1);
}

// ---- ratios
const scale = CLUBS_THEN / CLUBS_NOW;
const rows = AGES.map((a) => {
  const m = (g: G3) => (made[g].get(a) ?? 0) / nCohorts;
  const u = (g: G3) => (atRisk[g].get(a) ?? 0) * scale;
  return { a, mF: m("F"), mD: m("D"), mG: m("G"), uF: u("F"), uD: u("D"), uG: u("G") };
});
console.log(`history: undrafted who made it, cohorts ${COHORTS.join("-")}: F ${madeTotal.F}, D ${madeTotal.D}, G ${madeTotal.G}; today: ${unknown} organisation players without a draft status or birth date (skipped)`);
console.log("age | M_a F  D  G (per cohort) | U_a F  D  G (today × 30.5/32) | ratio F  D  S(katers)  G | median lag S");
for (const r of rows) {
  const S = r.uF + r.uD > 0 ? (r.mF + r.mD) / (r.uF + r.uD) : NaN;
  const lagList = [...(lags.F.get(r.a) ?? []), ...(lags.D.get(r.a) ?? [])].sort((x, y) => x - y);
  const lag = lagList.length ? lagList[lagList.length >> 1]! : NaN;
  console.log(
    `${r.a} | ${r.mF.toFixed(2)} ${r.mD.toFixed(2)} ${r.mG.toFixed(2)} | ${r.uF.toFixed(0)} ${r.uD.toFixed(0)} ${r.uG.toFixed(0)} | ${(r.mF / r.uF).toFixed(3)} ${(r.mD / r.uD).toFixed(3)} ${S.toFixed(3)} ${(r.mG / r.uG).toFixed(3)} | ${lag} (n ${lagList.length})`,
  );
}

// ---- smoothing: the counts per age are small (a few to 24 players today), so
// ages pool into bands; one skater shape over the bands, non-increasing
// (pool-adjacent-violators weighted by U), each group's level its pooled
// ratio over the same ages; a band's value sits at its mean age.
function pava(xs: Array<{ v: number; w: number }>): number[] {
  const blocks = xs.map((x) => ({ v: x.v, w: x.w, n: 1 }));
  for (let i = 0; i < blocks.length - 1; ) {
    if (blocks[i]!.v < blocks[i + 1]!.v) {
      const a = blocks[i]!;
      const b = blocks[i + 1]!;
      const w = a.w + b.w;
      blocks.splice(i, 2, { v: (a.v * a.w + b.v * b.w) / w, w, n: a.n + b.n });
      if (i > 0) i--;
    } else i++;
  }
  return blocks.flatMap((b) => new Array<number>(b.n).fill(b.v));
}
const sum = (ages: number[], f: (r: (typeof rows)[number]) => number) => rows.filter((r) => ages.includes(r.a)).reduce((s, r) => s + f(r), 0);
const bandStats = BANDS.map((ages) => {
  const m = sum(ages, (r) => r.mF + r.mD);
  const u = sum(ages, (r) => r.uF + r.uD);
  return { ages, at: ages.reduce((x, y) => x + y, 0) / ages.length, S: m / u, u };
});
// 18-19 stand apart: undrafted then means passed over at the draft (a player
// drafted a year later leaves the undrafted history), and the rate rises to
// the 20-22 band; from 20 on it only falls with age.
const shape = [bandStats[0]!.S, ...pava(bandStats.slice(1).map((b) => ({ v: b.S, w: b.u })))];
const fitAgesAll = BANDS.flat();
const pooled = (g: "F" | "D" | "G") =>
  sum(fitAgesAll, (r) => (g === "F" ? r.mF : g === "D" ? r.mD : r.mG)) / sum(fitAgesAll, (r) => (g === "F" ? r.uF : g === "D" ? r.uD : r.uG));
const all = sum(fitAgesAll, (r) => r.mF + r.mD) / sum(fitAgesAll, (r) => r.uF + r.uD);
const r3 = (x: number) => Math.round(x * 1000) / 1000;
for (const [i, b] of bandStats.entries()) console.log(`band ${b.ages[0]}-${b.ages[b.ages.length - 1]}: skaters ${r3(b.S)} (U ${b.u.toFixed(0)}), non-increasing ${r3(shape[i]!)}`);
const curve = (g: "F" | "D" | "G") => bandStats.map((b, i) => [b.at, r3((shape[i]! * pooled(g)) / all)] as [number, number]);
const lagCurve = bandStats.map((b) => {
  const l = b.ages.flatMap((a) => [...(lags.F.get(a) ?? []), ...(lags.D.get(a) ?? [])]).sort((p, q) => p - q);
  return [b.at, l.length ? l[l.length >> 1]! : 1] as [number, number];
});
console.log(`pooled ratio F ${r3(pooled("F"))} D ${r3(pooled("D"))} G ${r3(pooled("G"))} (skaters ${r3(all)})`);

// ---- prime FP/G of undrafted skaters who made it (current profiles)
const prime: Record<"F" | "D", number[]> = { F: [], D: [] };
for (const p of profiles) {
  if (p.draft || p.isGoalie || !p.bio?.birthDate || (p.careerTotals?.gamesPlayed ?? 0) < 200) continue;
  const g = p.position === "D" ? "D" : "F";
  const by = p.bio.birthDate;
  for (const h of p.teamHistory ?? []) {
    const y = Math.floor(h.seasonId / 10000);
    const a = ageOn(by, y);
    if (a < 24 || a > 27 || (h.gamesPlayed ?? 0) < 40) continue;
    const s = seasonFpgLeague(params, g, [
      {
        season: y,
        gp: h.gamesPlayed ?? 0,
        toi: null,
        goals: h.stats?.goals ?? 0,
        assists: h.stats?.assists ?? 0,
        shots: h.stats?.shots ?? 0,
        hits: h.advanced?.hits ?? 0,
        blocks: h.advanced?.blocks ?? 0,
        takeaways: h.advanced?.takeaways ?? 0,
      },
    ]);
    if (s) prime[g].push(s.fpg);
  }
}
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, s.length - 1));
  return { n: s.length, mean: r3(mean), median: r3(s[s.length >> 1]!), sd: r3(sd) };
};
const pf = stats(prime.F);
const pd = stats(prime.D);
console.log(`prime FP/G (seasons at 24-27, 40+ GP, undrafted with 200+ GP in the current profiles): F ${JSON.stringify(pf)} D ${JSON.stringify(pd)}; params undraftedPrior F ${params.prospect.undraftedPrior.F} D ${params.prospect.undraftedPrior.D}`);

const block = {
  source: `scripts/fit-undrafted-prospects.ts (${new Date().toISOString().slice(0, 10)}): P(make it = 200 NHL GP, a 40-game season for goalies | undrafted, age on Oct 1, < ${MAX_GP} NHL GP, on an NHL club's books) = M_a / U_a over that one population, M_a = undrafted players per birth cohort ${COHORTS.join("-")} who made it with < ${MAX_GP} NHL GP before their age-a season and NHL games in it (on an NHL deal then: a lower bound, it misses those who first played later) (league-seasons.json: F ${madeTotal.F}, D ${madeTotal.D}, G ${madeTotal.G} made it), U_a = today's undrafted organisation players of age a with < ${MAX_GP} NHL GP (nhl-rosters.json × ${CLUBS_THEN}/${CLUBS_NOW} clubs); ages pooled in bands 18-19, 20-22, 23-24, 25-26, 27-30 (a band's value at its mean age), one skater shape non-increasing from 20 on (weighted PAVA; 18-19, still draft-eligible, stand apart), each group's level its pooled ratio. Ages outside the table take its end values. The route (segment.ts) takes organisation players under maxGp NHL GP only, and caps these odds at the draft-slot model's for pick capPick (the last of round 5, mid late rounds) with as many post-draft seasons as his age (prospect.ts lateSlotPMake): an undrafted player never outranks a drafted one of his age who has not arrived either (verifier 2026-09-28). eta = season + median years to the first 40-game NHL season (skaters). Prime if he makes it: undrafted 200+ GP skaters' FP/G at 24-27 in the current profiles (F n ${pf.n} mean ${pf.mean} sd ${pf.sd}; D n ${pd.n} mean ${pd.mean} sd ${pd.sd}), goalies the slot prior.`,
  pMake: { F: curve("F"), D: curve("D"), G: curve("G") },
  etaLag: lagCurve,
  prime: { F: { mu: pf.mean, sd: pf.sd }, D: { mu: pd.mean, sd: pd.sd } },
  maxGp: MAX_GP,
  capPick: CAP_PICK,
};
console.log(JSON.stringify(block, null, 1));
console.log("age | fitted F D G | late-slot cap F D G | used F D G");
for (const a of [18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5, 26.5, 28.5]) {
  const f = (g: G3) => interpPairs(block.pMake[g], a);
  const c = (g: G3) => lateSlotPMake(params, g, a, CAP_PICK, NOW);
  const row = (fn: (g: G3) => number) => (["F", "D", "G"] as const).map((g) => fn(g).toFixed(3)).join(" ");
  console.log(`${a} | ${row(f)} | ${row(c)} | ${row((g) => Math.min(f(g), c(g)))}`);
}
if (process.argv.includes("--write")) {
  const prospect = rawParams.prospect as Record<string, unknown>;
  prospect.undrafted = block;
  writeFileAtomic(PARAMS, `${JSON.stringify(rawParams, null, 1)}\n`);
  console.log(`OK: params.json prospect.undrafted written`);
}
