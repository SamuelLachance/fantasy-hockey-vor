/**
 * Builds public/fantrax/dynasty.json — every player's dynasty value for the
 * Captains Dynasty League (young players, veterans, prospects never seen in
 * the NHL), from the synced Fantrax snapshot and the frozen research tables
 * (see scripts/dynasty-inputs.ts and src/lib/dynasty). Deterministic:
 * unchanged inputs give a byte-identical file. `npm run league:sync` runs
 * the same build at its end.
 *
 * Run: npm run dynasty:build [-- --paths 2000] [-- --report] [-- --if-stale]
 *        [-- --no-market] [-- --stability] [-- --out <path>]
 *   --report     sanity table: top 60, reference bands, reference players (growth
 *                driver, eFP path), Quebec roster, gates, keepers per cutdown
 *   --if-stale   skip when dynasty.json already matches the inputs (< 20 h)
 *   --stability  rebuild with two other seeds: in the balanced and long-term top 200 the
 *                95th percentile of rank moves must stay ≤ 12 places (and the top 300 move
 *                ×/÷1.5 at most for ≤ 5%)
 * `npm run league:dynasty` = build + report.
 */
import { marketRanks } from "../src/lib/dynasty/board";
import { dynastyGates, spearman } from "../src/lib/dynasty/checks";
import { explainFr, KEEPER_TEAM_FR, keeperView, PHASE_FR, rosterHintFr } from "../src/lib/dynasty/explain";
import { buildDynasty, DEFAULT_PATHS, type BuildResult, type DynastyRecord } from "../src/lib/dynasty/index";
import { FANTRAX_DEFAULT_TEAM_ID } from "../src/lib/fantrax/config";
import {
  dynastyUpToDate,
  loadDynastyFiles,
  readOptional,
  runDynastyBuild,
  type LoadedDynastyFiles,
} from "./dynasty-inputs";

const args = process.argv.slice(2);
const argValue = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const PATH_COUNT = Number(argValue("--paths") ?? DEFAULT_PATHS);
const OUT = argValue("--out");
const REPORT = args.includes("--report");
const IF_STALE = args.includes("--if-stale");
const NO_MARKET = args.includes("--no-market");
const STABILITY = args.includes("--stability");
/** Seed stability: ranks compared in the top STABILITY_TOP; their 95th-percentile move must stay ≤ STABILITY_P95. */
const STABILITY_TOP = 200;
const STABILITY_P95 = 12;

/**
 * Reference bands from the spec (§9.2): rank ranges in balanced / long-term.
 * Recalibrated after the 2026-09-25 audit fixes (84-game season → K 45.6,
 * keep index without the season shock) only where a near-zero value moved
 * far down the tail: Misa (DV ≈ 5). Young skaters recalibrated for the
 * conditional growth model (dyn-v3) on the youth backtest's what-if re-runs
 * with the historical path (scratchpad/dynasty/youth/whatif.json). dyn-v4
 * (second audit, 2026-09-25), where the model change is the point:
 *  - long-term mode re-set (δ 0.95, w0 0.2, w1 0.5): a rebuild ranking, so
 *    every long-term band of a young player moves up and Ovechkin / Crosby /
 *    Marchand, whose value ends within two seasons, fall out of the top 120-250;
 *  - one rookie rule (the projection is the 2025-26 level at every games
 *    count): Martone and Frondell grow from their 2025-26 age like every
 *    young skater (+9% / +27% by 2028-29), not from 2026-27;
 *  - goalie roles on the raw start share with a tandem tier: starters keep
 *    the job ~0.7 a year, not ~0.9 (Shesterkin, Vejmelka, Bobrovsky and the
 *    goalie prospect Wallstedt lower);
 *  - Demidov, Michkov, Kindel: balanced bands widened toward the top for the
 *    pedigree × production surface and the lower keeper line.
 */
const SOFT_BANDS: Array<{ n: string; bal?: [number, number]; lt?: [number, number]; maxBal?: number }> = [
  { n: "Macklin Celebrini", bal: [1, 1], lt: [1, 1] },
  { n: "Nathan MacKinnon", bal: [1, 3], lt: [1, 6] },
  { n: "Connor McDavid", bal: [1, 4], lt: [1, 6] },
  { n: "Connor Bedard", bal: [1, 10], lt: [1, 6] },
  { n: "Matthew Schaefer", bal: [35, 75], lt: [12, 40] },
  { n: "Matvei Michkov", bal: [80, 180], lt: [40, 120] },
  { n: "Ivan Demidov", bal: [55, 140], lt: [20, 90] },
  { n: "Alex Ovechkin", bal: [50, 100], lt: [140, 400] },
  { n: "Sidney Crosby", bal: [50, 100], lt: [120, 400] },
  { n: "Brad Marchand", bal: [130, 230], lt: [250, 600] },
  { n: "Gavin McKenna", bal: [65, 120], lt: [15, 60] },
  { n: "Ivar Stenberg", bal: [85, 140], lt: [30, 90] },
  { n: "Caleb Malhotra", bal: [130, 220], lt: [50, 130] },
  { n: "Wyatt Cullen", bal: [180, 300], lt: [100, 200] },
  { n: "Carson Carels", bal: [220, 350], lt: [140, 260] },
  { n: "Nikita Klepov", bal: [180, 300], lt: [100, 200] },
  { n: "Porter Martone", bal: [8, 40], lt: [3, 30] },
  { n: "Anton Frondell", bal: [12, 60], lt: [4, 40] },
  { n: "Benjamin Kindel", bal: [90, 200], lt: [25, 120] },
  { n: "Michael Misa", bal: [100, 260], lt: [40, 160] },
  { n: "Calum Ritchie", maxBal: 45 },
  { n: "Chase Reid", bal: [160, 280], lt: [90, 180] },
  { n: "Jesper Wallstedt", bal: [100, 180], lt: [50, 110] },
  { n: "Igor Shesterkin", bal: [20, 45] },
  { n: "Karel Vejmelka", bal: [70, 130] },
  { n: "Sergei Bobrovsky", bal: [90, 150] },
  { n: "Cale Makar", bal: [20, 45] },
  { n: "Gabriel Landeskog", bal: [85, 140] },
  { n: "Justin Sourdif", maxBal: 25 },
  { n: "Nikita Chibrikov", maxBal: 3 },
];

/** Players printed with their growth driver and eFP path in the report. */
const REFERENCE = [
  "Ivan Demidov",
  "Macklin Celebrini",
  "Matvei Michkov",
  "Michael Misa",
  "Benjamin Kindel",
  "Matthew Schaefer",
  "Connor Bedard",
  "Gavin McKenna",
  "Porter Martone",
  "Anton Frondell",
  "Nathan MacKinnon",
  "Connor McDavid",
  "Nikita Kucherov",
  "Alex Ovechkin",
  "Brad Marchand",
];

const pad = (s: string | number, n: number) => String(s).padEnd(n).slice(0, n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);
const f0 = (x: number) => Math.round(x).toString();

function row(id: string, r: DynastyRecord): string {
  const k = r.keeper.pKept27 == null ? "  - " : r.keeper.pKept27.toFixed(2);
  return `${lpad(r.rank.balanced, 4)}/${lpad(r.rank.longTerm, 4)}/${lpad(r.rank.winNow, 4)} ${pad(r.n, 22)} ${r.g} ${r.age.toFixed(1)} ${pad(r.phase, 14)} WN${lpad(f0(r.dv.winNow), 5)} BAL${lpad(f0(r.dv.balanced), 5)} [${r.band.balanced.map((x) => lpad(f0(x), 5)).join("")}] LT${lpad(f0(r.dv.longTerm), 5)} | eG ${r.eG.slice(0, 6).map(f0).join(",")} | P50 ${r.p50G.slice(0, 6).join(",")} | pNHL ${r.pNhl.toFixed(2)} elig ${r.elig.now ? "Y" : "n"}/${r.elig.next.toFixed(2)} k27 ${k} ${pad(r.keeper.status, 6)} ${r.seg}${r.market.w ? ` w${r.market.w}` : ""}${r.dvModel ? ` model ${f0(r.dvModel.balanced)}` : ""}${r.flags ? ` [${r.flags.join(",")}]` : ""} ${id}`;
}

function report(res: BuildResult, L: LoadedDynastyFiles, ms: number) {
  const all = res.all;
  const entries = Object.entries(all);
  const byBal = [...entries].sort((a, b) => a[1].rank.balanced - b[1].rank.balanced);
  const out: string[] = [];
  out.push(
    `dynasty: ${entries.length} modeled (${Object.keys(res.snapshot.players).length} written, ${res.snapshot.zero.length} zero-value ids), paths ${PATH_COUNT}, ${(ms / 1000).toFixed(1)} s; routes ${JSON.stringify(res.routes)}`,
  );
  const P = res.snapshot.params;
  out.push(
    `R_F ${P.repl.F} R_D ${P.repl.D} R_Gs ${P.repl.Gseason} offRef ${P.offRef} K ${P.K.value} (band ${P.K.band.join("-")}, pool ${res.K.pool}${res.K.fallback ? ", FALLBACK" : ""}) keep-index gate ${P.K.gate} (P10-P90 ${P.K.gateBand?.join("-")}) lambda ${P.lambda}`,
    `Expected non-eligible keepers at the 2027 / 2028 / 2029 cutdowns: ${(res.snapshot.diag?.keptPerCutdown ?? []).join(" / ")} (160 slots; later cutdowns miss future draftees and redrafted players)`,
  );
  out.push("", "== Top 60 (balanced; rank bal/LT/WN)");
  for (const [id, r] of byBal.slice(0, 60)) out.push(row(id, r));
  out.push("", "== Soft checks (spec §9.2 reference bands)");
  let soft = 0;
  for (const b of SOFT_BANDS) {
    const hits = entries.filter(([, r]) => r.n === b.n);
    if (!hits.length) {
      out.push(`  ?  ${b.n}: not modeled`);
      continue;
    }
    for (const [id, r] of hits) {
      const fails: string[] = [];
      if (b.bal && (r.rank.balanced < b.bal[0] || r.rank.balanced > b.bal[1])) fails.push(`bal #${r.rank.balanced} not in ${b.bal.join("-")}`);
      if (b.lt && (r.rank.longTerm < b.lt[0] || r.rank.longTerm > b.lt[1])) fails.push(`LT #${r.rank.longTerm} not in ${b.lt.join("-")}`);
      if (b.maxBal != null && r.dv.balanced > b.maxBal) fails.push(`DV ${r.dv.balanced} > ${b.maxBal}`);
      if (fails.length) soft++;
      out.push(`  ${fails.length ? "WARN" : "ok  "} ${row(id, r)}${fails.length ? `  <- ${fails.join("; ")}` : ""}`);
    }
  }
  out.push(`  ${soft} soft-check warnings`);
  out.push("", "== Reference players (growth: base FP/G, base age, production percentile, pick, G_1..G_6 vs the base; eFP 2026-27..2031-32)");
  for (const n of REFERENCE) {
    for (const [id, r] of entries.filter(([, x]) => x.n === n)) {
      const gr = r.growth;
      const g = gr ? ` | growth ${gr.src} base ${gr.base.toFixed(2)} @${gr.baseAge.toFixed(1)} p${Math.round(gr.pct * 100)} #${gr.pick ?? "-"} G ${gr.m.map((x) => x.toFixed(2)).join(",")}` : "";
      out.push(`${row(id, r)}
       eFP ${r.eFP.slice(0, 6).join(",")}${g}
       ${explainFr(r)}`);
    }
  }
  const mine = (L.state.rosters[FANTRAX_DEFAULT_TEAM_ID] ?? []).map((e) => e.id).filter((id) => all[id]);
  out.push("", `== Quebec Trashers (${mine.length} modeled; keeper 2027 against the team's own 10 slots, league-wide status in the row)`);
  const counts = { free: 0, core: 0, bubble: 0, rental: 0 };
  for (const id of mine.sort((a, b) => all[a]!.rank.balanced - all[b]!.rank.balanced)) {
    const r = all[id]!;
    const kv = keeperView(r);
    counts[kv.status]++;
    const team = kv.team && kv.status !== "free" ? ` (P ${kv.p == null ? "-" : kv.p.toFixed(2)}, candidat ${kv.rank ?? "-"})` : "";
    out.push(`${row(id, r)}\n       ${PHASE_FR[r.phase]} · ${KEEPER_TEAM_FR[kv.status]}${team} · ${rosterHintFr(r)} · ${explainFr(r)}`);
  }
  const tq = res.teams?.teams.get(FANTRAX_DEFAULT_TEAM_ID);
  if (tq) {
    const names = tq.draftedIds.map((id) => all[id]?.n ?? id).slice(0, 14);
    out.push(
      `2027 cutdown outlook (Quebec's 10 slots): ${counts.core} safe, ${counts.bubble} on the line, ${counts.rental} outside, ${counts.free} free minors stashes; expected keepers ${tq.roster.toFixed(1)} from this roster + ${tq.drafted.toFixed(1)} from the rest of the draft (market-rank fill: ${names.join(", ")}) = ${(tq.roster + tq.drafted).toFixed(1)} of 10`,
    );
  }
  if (res.teams) {
    const sums = [...res.teams.teams.values()].map((t) => t.roster + t.drafted);
    out.push(`Expected 2027 keepers per team (roster + draft fill): min ${Math.min(...sums).toFixed(1)} max ${Math.max(...sums).toFixed(1)}; league total ${sums.reduce((a, b) => a + b, 0).toFixed(1)} of ${sums.length * 10}`);
  }
  const bench = readOptional<{ keepScore27: Record<string, number> }>(L.paths.benchmarks);
  const gates = dynastyGates({
    snapshot: res.snapshot,
    values: L.values.players,
    rostered: new Set(Object.values(L.state.rosters).flat().map((r) => r.id)),
    adp: L.state.adp,
    ros: L.state.ros,
    minorsEligible: new Set(L.state.minorsEligible),
    keepScore27: bench?.keepScore27,
  });
  const stats = Object.fromEntries(Object.entries(gates.stats).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
  out.push("", `== Gates: ${JSON.stringify(stats)}`);
  for (const e of gates.errors) out.push(`  FAIL ${e}`);
  for (const w of gates.warnings) out.push(`  warn ${w}`);
  const gs = res.snapshot.diag?.goalieStarts0 ?? {};
  out.push(
    `Year-0 goalie depth starts / reference by team: ${Object.entries(gs)
      .map(([t, x]) => `${t} ${Math.round(x.starts)}/${Math.round(x.ref)}`)
      .join(" ")}`,
  );
  const live = (L.state.draft?.picks ?? []).filter((p) => p.playerId).sort((a, b) => a.pick - b.pick);
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
  const ranks = live.map((p) => all[p.playerId!]).filter(Boolean) as DynastyRecord[];
  out.push(
    "",
    `== League draft picks so far (${live.length}): median DV rank bal ${med(ranks.map((r) => r.rank.balanced))} LT ${med(ranks.map((r) => r.rank.longTerm))}`,
  );
  for (const p of live) {
    const r = all[p.playerId!];
    out.push(`#${lpad(p.pick, 3)} ${r ? row(p.playerId!, r) : `${p.playerId} (not modeled)`}`);
  }
  // §9.3 (logged, not a gate): the board's market rank should anticipate the picks.
  // Approximation: rank every drafted player among (still available ∪ drafted).
  const rostered = new Set(Object.values(L.state.rosters).flat().map((r) => r.id));
  const drafted = new Set(live.map((p) => p.playerId!));
  const pool = Object.keys(all).filter((id) => drafted.has(id) || !rostered.has(id));
  const mr = marketRanks(pool, (id) => all[id]!.market.ros, (id) => all[id]!.market.adp);
  const pickedRanks = [...drafted].map((id) => mr.get(id)).filter((x): x is number => x != null);
  out.push(
    `Draft-board market rank of the ${pickedRanks.length} picks among (available ∪ drafted): median ${med(pickedRanks)?.toFixed(1)} (target ≤ 55)`,
  );
  const wk = entries.filter(([id]) => L.state.adp[id] != null && L.state.adp[id]! < 280);
  out.push(
    `Spearman DV bal vs -ADP over modeled players (n=${wk.length}) ${spearman(
      wk.map(([, r]) => r.dv.balanced),
      wk.map(([id]) => -L.state.adp[id]!),
    ).toFixed(3)}`,
  );
  console.log(out.join("\n"));
  return gates;
}

function main() {
  const L = loadDynastyFiles();
  if (IF_STALE) {
    const why = dynastyUpToDate(L, OUT);
    if (why) {
      console.log(`OK: dynasty:build skipped — ${why}`);
      return;
    }
  }
  const { result: res, inputs, ms, out } = runDynastyBuild(
    {
      paths: PATH_COUNT,
      ...(OUT ? { out: OUT } : {}),
      ...(NO_MARKET ? { market: false } : {}),
      onProgress: (d, n) => {
        if (REPORT && d % 500 === 0) process.stderr.write(`  ${d}/${n}\n`);
      },
    },
    L,
  );
  const n = Object.keys(res.snapshot.players).length;
  console.log(
    `OK: dynasty:build wrote ${n} players (K ${res.snapshot.params.K.value}, ${PATH_COUNT} paths, ${(ms / 1000).toFixed(1)} s) → ${out}`,
  );
  if (REPORT && report(res, L, ms).errors.length) process.exitCode = 1;
  if (STABILITY) {
    // Monte Carlo noise: rebuild with two other seeds (same K and gate) and compare ranks
    const q95 = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(0.95 * (a.length - 1))]!;
    for (const seedKey of ["|dyn|stability", "|dyn|stability2"]) {
      const alt = buildDynasty(inputs, L.params, {
        paths: PATH_COUNT,
        K: res.K.value,
        Kgate: res.K.gate,
        seedKey,
        ...(NO_MARKET ? { market: false } : {}),
      });
      const top = Object.entries(res.all)
        .sort((a, b) => a[1].rank.balanced - b[1].rank.balanced)
        .slice(0, 300);
      const moved = top.filter(([id, r]) => {
        const ratio = ((alt.all[id]?.dv.balanced ?? 0) + 10) / (r.dv.balanced + 10);
        return ratio > 1.5 || ratio < 1 / 1.5;
      });
      const share = moved.length / top.length;
      const rankMoves = (m: "balanced" | "longTerm") =>
        Object.entries(res.all)
          .filter(([, r]) => r.rank[m] <= STABILITY_TOP)
          .map(([id, r]) => Math.abs((alt.all[id]?.rank[m] ?? 9999) - r.rank[m]));
      const bal = rankMoves("balanced");
      const lt = rankMoves("longTerm");
      const ok = share <= 0.05 && q95(bal) <= STABILITY_P95 && q95(lt) <= STABILITY_P95;
      console.log(
        `${ok ? "OK" : "FAIL"}: seed stability (${seedKey}) — top ${STABILITY_TOP} rank moves P95 / max: balanced ${q95(bal)} / ${Math.max(...bal)}, long-term ${q95(lt)} / ${Math.max(...lt)} (P95 ≤ ${STABILITY_P95}); ${moved.length}/300 of the top 300 move more than ×/÷1.5${moved.length ? ` (${moved.slice(0, 5).map(([, r]) => r.n).join(", ")})` : ""}`,
      );
      if (!ok) process.exitCode = 1;
    }
  }
}

main();
