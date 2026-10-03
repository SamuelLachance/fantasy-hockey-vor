/**
 * Fit the NHLe prospect model (src/lib/dynasty/nhle.ts) on everything known
 * before the 2026-27 season and write src/data/dynasty/prospect-model.json;
 * with --apply, refresh the drafted skaters' records in
 * src/data/dynasty/prospects.json (P(make it), prime FP/G, ETA) from their
 * public NHL landing seasons (pSource « nhle-v2 »).
 *
 * The same fit, run at each past start year with only the data known then,
 * is what scripts/dynasty-backtest.ts scores (variant nhle): the model is
 * shipped only because it beat the draft-slot route there (see
 * prospect-model.json `backtest`). The recorded backtest is kept only while
 * the fitting procedure is the one it scored (`backtest.procedureHash`,
 * scripts/dynasty-model-hash.ts); after a change of procedure it is dropped,
 * and scripts/test-dynasty-nhle.ts fails until the backtest is re-run and
 * re-recorded (scripts/dynasty-scorecard.ts --record).
 *
 * Records replaced (2026-10-02): the earlier research records of the
 * drafted skaters (« nhle(k=…) », an NHLe model fitted on every class, and
 * « nhl-gp-so-far »), which carried a capped scouting-tier logit shift from
 * 2026 opinions. That shift is dropped: it cannot be rebuilt at a past date,
 * so it was never backtested; the v2 record has no scouting input.
 *
 * Records refreshed: skaters with an NHL id, a draft slot, a cached landing,
 * fewer than 100 NHL GP and under 25 on Oct 1, 2026. Undrafted players,
 * goalies and anyone else keep their research record.
 *
 * Run: npx tsx scripts/dynasty-fit-prospects.ts --hist <hist.json> --cache <dir> [--apply]
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { parseParams } from "../src/lib/dynasty/params";
import { predictProspect, prospectFeatures, seasonRows, type ProspectModelV2 } from "../src/lib/dynasty/nhle";
import type { ProspectsFile } from "../src/lib/dynasty/types";
import { ageOn, loadHist, loadProspectHistory } from "./dynasty-backtest-lib";
import { fitProspectModel } from "./dynasty-prospect-fit";
import { procedureHash } from "./dynasty-model-hash";

const args = process.argv.slice(2);
const arg = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const HIST = arg("--hist") ?? process.env.DYNASTY_HIST;
const CACHE = arg("--cache") ?? process.env.DYNASTY_CACHE;
if (!HIST || !CACHE) {
  console.error("dynasty-fit-prospects: --hist <file> and --cache <dir> are required");
  process.exit(2);
}
const APPLY = args.includes("--apply");
const Y0 = 2026;
const DATA = join(process.cwd(), "src", "data", "dynasty");
const params = parseParams(JSON.parse(readFileSync(join(DATA, "params.json"), "utf8")));
const H = loadHist(HIST);
const PH = loadProspectHistory(CACHE);
const fitted = fitProspectModel(H, PH, params, Y0) as ProspectModelV2 & { n?: unknown };
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const factors = Object.fromEntries(
  Object.entries(fitted.factors)
    .filter(([, v]) => v.n >= 8)
    .sort((a, b) => b[1].n - a[1].n)
    .map(([k, v]) => [k, { f: r4(v.f), n: Math.round(v.n) }]),
);
const prev = (() => {
  try {
    return JSON.parse(readFileSync(join(DATA, "prospect-model.json"), "utf8")) as { backtest?: { procedureHash?: string } };
  } catch {
    return {};
  }
})();
const keepBacktest = prev.backtest != null && prev.backtest.procedureHash === procedureHash();
if (prev.backtest && !keepBacktest) console.warn("dynasty-fit-prospects: the fitting procedure changed since the recorded backtest; it is dropped (re-run scripts/dynasty-backtest.ts and scripts/dynasty-scorecard.ts --record)");
const model: ProspectModelV2 & Record<string, unknown> = {
  version: `nhle-v2-${Y0}`,
  source:
    "scripts/dynasty-fit-prospects.ts: NHL draft picks 2005-2026 (api-web draft picks) and their public NHL player landings (seasonTotals), NHL history 2008-09..2025-26 (MoneyPuck season totals). Training rows: every drafted skater at each snapshot from his draft year to draft year + 6 with < 100 NHL GP and age < 25, outcome window of 7 seasons complete before 2026-27. make = 200+ NHL GP by the end of the window (logistic, ridge 2); prime = GP-weighted league-1 FP/G at ages 24-26 rescaled to the 2025-26 scoring level (OLS, ridge 10); lag = first season with 10+ NHL GP minus the snapshot, less the arrival jitter mean (OLS). League factors: season pairs (20+ GP both), direct and through one league, shrunk to a prior with 30 pairs.",
  make: fitted.make.map(r4),
  prime: { coef: fitted.prime.coef.map(r4), sd: r4(fitted.prime.sd) },
  lag: { coef: fitted.lag.coef.map(r4), min: fitted.lag.min, max: fitted.lag.max },
  oddsCal: fitted.oddsCal ?? 1,
  factors,
  fit: fitted.n ?? null,
  ...(keepBacktest ? { backtest: prev.backtest } : {}),
};
writeFileSync(join(DATA, "prospect-model.json"), JSON.stringify(model, null, 1) + "\n");
console.log(`OK: prospect-model.json (${JSON.stringify(fitted.n)})`);

if (APPLY) {
  const path = join(DATA, "prospects.json");
  const file = JSON.parse(readFileSync(path, "utf8")) as ProspectsFile;
  const heightOf = new Map(PH.picks.filter((d) => d.id != null).map((d) => [d.id!, d.height]));
  const pickOf = new Map(PH.picks.filter((d) => d.id != null && d.pos !== "G").map((d) => [d.id!, d]));
  /** The v2 inputs of a drafted skater (null: out of the model's population). */
  const v2 = (nhlId: number, pos: "F" | "D", draft: { year: number; pick: number }, birth: string | null) => {
    const land = PH.landing.get(nhlId);
    const age = ageOn(birth ?? land?.birthDate ?? null, Y0);
    if (!land || age == null || age >= params.eligibility.age) return null;
    const nhlGP = seasonRows(land.seasonTotals, Y0)
      .filter((r) => r.league === "NHL")
      .reduce((a, r) => a + r.gp, 0);
    if (nhlGP >= params.eligibility.skaterGp) return null;
    const f = prospectFeatures(
      { pos, pick: draft.pick, draftYear: draft.year, age, heightIn: heightOf.get(nhlId) ?? land.heightInInches ?? null, seasons: land.seasonTotals },
      Y0,
      fitted.factors,
    );
    return { pm: predictProspect(fitted, f, Y0, params.prospect.primeFloor[pos]), nhlGP, land };
  };
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  let changed = 0;
  let kept = 0;
  for (const rec of Object.values(file.players)) {
    const out = rec.pos !== "G" && rec.draft && rec.nhlId != null ? v2(rec.nhlId, rec.pos, rec.draft, rec.birthDate ?? null) : null;
    if (!out || rec.nhlGP >= params.eligibility.skaterGp) {
      kept++;
      continue;
    }
    rec.pMake = r3(out.pm.pMake);
    rec.fpgIfMake = { mu: r3(out.pm.pi.mu), sd: r3(out.pm.pi.sd) };
    rec.eta = out.pm.eta;
    rec.pSource = "nhle-v2";
    changed++;
  }
  // drafted skaters among the league inputs with no research record (the
  // draft-slot route until now): a v2 record, as the backtest's nhle variant gives them
  const inputs = new Map<string, number | null>();
  const fx = (f: string) => join(process.cwd(), f);
  for (const f of ["public/fantrax/values.json", "public/fantrax/slapshot/values.json", "src/data/fantrax/prospect-pool.json"]) {
    try {
      for (const id of Object.keys((JSON.parse(readFileSync(fx(f), "utf8")) as { players: Record<string, unknown> }).players)) inputs.set(id, inputs.get(id) ?? null);
    } catch {
      /* a league without the file */
    }
  }
  for (const f of ["public/fantrax/pool.json", "public/fantrax/slapshot/pool.json"]) {
    try {
      for (const r of Object.values((JSON.parse(readFileSync(fx(f), "utf8")) as { players: Record<string, { id: string; nhl?: number }> }).players)) inputs.set(r.id, r.nhl ?? inputs.get(r.id) ?? null);
    } catch {
      /* a league without the file */
    }
  }
  for (const f of ["src/data/fantrax/nhl-ids.json", "src/data/fantrax/slapshot/nhl-ids.json"]) {
    const ids = (JSON.parse(readFileSync(fx(f), "utf8")) as { ids: Record<string, number> }).ids;
    for (const [id, nhl] of Object.entries(ids)) if (inputs.has(id) && inputs.get(id) == null) inputs.set(id, nhl);
  }
  let added = 0;
  for (const [id, nhlId] of [...inputs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (file.players[id] || nhlId == null) continue;
    const d = pickOf.get(nhlId);
    if (!d) continue;
    const pos = d.pos === "D" ? "D" : "F";
    const out = v2(nhlId, pos, { year: d.year, pick: d.pick }, null);
    if (!out) continue;
    file.players[id] = {
      nhlId,
      n: `${out.land.firstName ?? ""} ${out.land.lastName ?? ""}`.trim() || d.name,
      pos,
      ...(out.land.birthDate ? { birthDate: out.land.birthDate } : {}),
      draft: { year: d.year, pick: d.pick },
      nhlGP: out.nhlGP,
      pMake: r3(out.pm.pMake),
      pSource: "nhle-v2",
      fpgIfMake: { mu: r3(out.pm.pi.mu), sd: r3(out.pm.pi.sd) },
      eta: out.pm.eta,
      comp: {},
    };
    added++;
  }
  file.players = Object.fromEntries(Object.entries(file.players).sort((a, b) => a[0].localeCompare(b[0])));
  file.builtAt = new Date().toISOString();
  file.source = `${file.source.replace(/ \| nhle-v2:.*$/, "")} | nhle-v2: drafted skaters under 100 NHL GP and 25 refreshed or added by scripts/dynasty-fit-prospects.ts (src/data/dynasty/prospect-model.json). Their pMake carries no scouting-tier shift (dropped 2026-10-02: it cannot be rebuilt at a past date, so it was never backtested); comp keeps the earlier research's components, which the engine does not read.`;
  writeFileSync(path, JSON.stringify(file) + "\n");
  console.log(`OK: prospects.json — ${changed} records refreshed, ${added} added (nhle-v2), ${kept} kept`);
}
