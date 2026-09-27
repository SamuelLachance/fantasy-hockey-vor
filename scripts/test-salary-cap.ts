/**
 * The Slapshot salary cap and roster rules as the site applies them
 * (src/lib/fantrax/salary-cap.ts, roster-rules.ts, league-copy.ts): only
 * Active + Reserve count against the cap, IR and Minors are free; the
 * season-by-season commitments; the French lines; the 40 / IR 5 / Minors 17
 * limits; one source for the cap (the config's base = the dynasty profile's).
 * Also validates public/fantrax/slapshot/contracts.json when present.
 * Run: npx tsx scripts/test-salary-cap.ts
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { SLAPSHOT } from "../src/lib/fantrax/config";
import { legalitySummary } from "../src/lib/fantrax/league-copy";
import { evaluateRoster } from "../src/lib/fantrax/roster-rules";
import { isContractsFile, salaryUsage, type ContractsFile } from "../src/lib/fantrax/salary-cap";
import { capGrowthText, fmtMoney, salaryLine } from "../src/lib/fantrax/salary-copy";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const root = process.cwd();
const rules = SLAPSHOT.salaryCap!;

// ---- one source for the cap
{
  const prof = JSON.parse(readFileSync(join(root, "src", "data", "dynasty", "slapshot", "league.json"), "utf8")) as {
    cap: { base: number; growthAfter: number };
    season: { fantasyShare: number };
  };
  assert(prof.cap.base === rules.base, `config cap ${rules.base} = dynasty profile cap ${prof.cap.base}`);
  // season totals on the site and the dynasty values cover the same fantasy season
  assert(SLAPSHOT.cadence.seasonShare === prof.season.fantasyShare, `season share ${SLAPSHOT.cadence.seasonShare} = profile ${prof.season.fantasyShare}`);
  assert(prof.cap.growthAfter > 0 && prof.cap.growthAfter < 0.2, "one growth knob, a plausible rate");
  assert(rules.countedSpots === SLAPSHOT.limits.maxActive + SLAPSHOT.limits.maxReserve, "23 counted spots = Active 20 + Reserve 3");
}

// ---- cap use: Active + Reserve only
const file: ContractsFile = {
  builtAt: "2026-09-27T00:00:00.000Z",
  firstSeason: 2026,
  cap: [105, 114.591, 120.321, 126.337, 132.654, 139.286],
  min: [0.85, 0.928, 0.974, 1.023, 1.074, 1.128],
  nhl: [104, 113.5, 119.175, 125.134, 131.39, 137.96],
  growthAfter: 0.05,
  announced: [2026, 2027],
  lambda: [1.3, 0.2, 0.2, 0.2, 0.2, 0.2],
  players: {
    a: { c: [12, 12, 12, 12, 12, 12], s: 6, x: null, st: "UFA" },
    b: { c: [13.5, 13.5, 6, 6, 6, 6], s: 2, x: 2028, st: "UFA" },
    c: { c: [0.98, 0.98, 0.98, 3.5, 3.5, 3.5], s: 0, x: 2026, st: "RFA", elc: 1 },
    ir: { c: [9, 9, 9, 9, 9, 9], s: 6, x: null, st: "UFA" },
    minors: { c: [7.5, 7.5, 7.5, 7.5, 7.5, 7.5], s: 6, x: null, st: "UFA" },
  },
};
{
  assert(isContractsFile(file), "the fixture is a contracts file");
  const roster = [
    { id: "a", status: "ACTIVE" },
    { id: "b", status: "RESERVE" },
    { id: "c", status: "ACTIVE" },
    { id: "ir", status: "INJURED_RESERVE" },
    { id: "minors", status: "MINORS" },
    { id: "nobody", status: "ACTIVE" },
  ];
  const u = salaryUsage(roster, file, rules);
  assert(u.counted === 4, `4 counted (Active + Reserve), got ${u.counted}`);
  assert(near(u.used[0]!, 12 + 13.5 + 0.98), `2026-27 cap use ${u.used[0]} leaves IR and Minors out`);
  assert(near(u.room[0]!, 105 - 26.48, 1e-6), `room ${u.room[0]}`);
  assert(near(u.signed[2]!, 12), `2028-29 signed commitments ${u.signed[2]} (b's contract ends in 2028)`);
  assert(near(u.used[2]!, 12 + 6 + 0.98, 1e-6), `2028-29 with projected contracts ${u.used[2]}`);
  assert(u.unknown.length === 1 && u.unknown[0] === "nobody", "a counted player without a contract is unknown, not 0");
  assert(!u.over, "under the cap");
  assert(u.top[0]![0] === "b", "top salary first");
  const line = salaryLine(u);
  assert(line.startsWith("Masse salariale : 26,5 M$ / 105,0 M$, marge 78,5 M$"), `cap line: ${line}`);
  assert(/Actifs \+ Réserve seulement/.test(line) && /1 salaire inconnu/.test(line), `cap line says what counts: ${line}`);
  const over = salaryUsage([...Array.from({ length: 10 }, () => ({ id: "b", status: "ACTIVE" }))], file, rules);
  assert(over.over && /dépassement/.test(salaryLine(over)), "over the cap is said so");
  // A drafting team lists more Active players than the 23 counted spots (every
  // pick lands in Active): the cap reads the best 23 by rank, the rest are
  // expected in the minors, cap-free.
  const drafted = [
    ...Array.from({ length: 23 }, (_, i) => ({ id: `n${i}`, status: i < 20 ? "ACTIVE" : "RESERVE" })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, status: "ACTIVE" })),
  ];
  const big: ContractsFile = {
    ...file,
    players: Object.fromEntries(
      drafted.map((e) => [e.id, { c: new Array(6).fill(e.id.startsWith("n") ? 4.5 : 0.98), s: 3, x: 2029, st: "RFA" as const }]),
    ),
  };
  const du = salaryUsage(drafted, big, rules, 4, (id) => (id.startsWith("n") ? 100 : 0));
  assert(du.counted === 23 && du.listed === 33 && du.surplus.length === 10, `23 counted of 33 listed (${du.counted} / ${du.listed})`);
  assert(near(du.used[0]!, 23 * 4.5, 1e-6) && !du.over, `cap over the 23 kept: ${du.used[0]}`);
  assert(du.surplus.every((id) => id.startsWith("p")), "the lowest ranked are the surplus");
  assert(/23 joueurs sur 23; 10 de plus, supposés aux mineures/.test(salaryLine(du)), `line names the surplus: ${salaryLine(du)}`);
  const noRank = salaryUsage(drafted, big, rules);
  assert(noRank.counted === 23 && noRank.surplus.length === 10, "without a rank, the first 23 listed count");
  assert(fmtMoney(0.975) === "0,98 M$" && fmtMoney(105) === "105,0 M$", "money format");
  assert(/\+5 % par saison/.test(capGrowthText(file)), `growth text: ${capGrowthText(file)}`);
}

// ---- roster limits: 40 max (IR apart), IR 5, Minors 17, and the line that names them
{
  const mk = (n: number, status: string, slot = "C") => Array.from({ length: n }, (_, i) => ({ id: `${status}${i}`, slot, status }));
  const legal = evaluateRoster([...mk(20, "ACTIVE"), ...mk(3, "RESERVE"), ...mk(17, "MINORS"), ...mk(5, "INJURED_RESERVE")], {}, {
    limits: SLAPSHOT.limits,
    slotCounts: { C: 20 },
    slotOrder: ["C"],
    iconsKnown: false,
  });
  assert(!legal.illegal, `20 + 3 + 17 + IR 5 is legal: ${JSON.stringify(legal.issues)}`);
  const tooMany = evaluateRoster([...mk(20, "ACTIVE"), ...mk(3, "RESERVE"), ...mk(18, "MINORS")], {}, {
    limits: SLAPSHOT.limits,
    slotCounts: { C: 20 },
    slotOrder: ["C"],
    iconsKnown: false,
  });
  assert(tooMany.issues.some((i) => i.code === "too-many-minors"), "18 in the minors is over 17");
  assert(tooMany.issues.some((i) => i.code === "too-many-total"), "41 players outside IR is over 40");
  const ir6 = evaluateRoster(mk(6, "INJURED_RESERVE"), {}, { limits: SLAPSHOT.limits, iconsKnown: false });
  assert(ir6.issues.some((i) => i.code === "too-many-ir"), "6 on IR is over 5");
  const s = legalitySummary({ ...legal }, true, SLAPSHOT.limits);
  assert(/40\/40 au total \(40 max hors IR\), IR 5\/5, mineures 17\/17/.test(s), `legality line names the limits: ${s}`);
  assert(/23\/23 joueurs comptés/.test(s), `counted over the 23 spots: ${s}`);
  // Captains' line is unchanged (no total published).
  const cap = legalitySummary({ ...legal, minTotal: 15 }, true);
  assert(!/au total/.test(cap), "a league without a published total gets no total");
}

// ---- the published file, when present
{
  const f = join(root, "public", "fantrax", "slapshot", "contracts.json");
  if (existsSync(f)) {
    const c = JSON.parse(readFileSync(f, "utf8")) as ContractsFile;
    assert(isContractsFile(c), "contracts.json parses");
    assert(c.cap[0] === rules.base, `contracts.json cap ${c.cap[0]} = ${rules.base}`);
    assert(Object.keys(c.players).length > 800, `contracts for ${Object.keys(c.players).length} players`);
    const bad = Object.values(c.players).filter((p) => p.c.length !== c.cap.length || !p.c.every((x) => Number.isFinite(x) && x >= 0));
    assert(bad.length === 0, `${bad.length} malformed contract rows`);
  }
}

if (failed) process.exit(1);
console.log("OK: salary cap (Active + Reserve only, commitments by season, 40 / IR 5 / Minors 17, French lines)");
