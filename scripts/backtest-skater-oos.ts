/**
 * Walk-forward out-of-sample records of the v2 skater stack, for the
 * post-hoc calibrations that must be fitted on the NEXT season (not on the
 * board's own past): the games-played calibration (src/lib/gp-calibration.ts)
 * and the rate diagnostics.
 *
 * For every test season T, the base models are trained on seasons < T and
 * the meta on the walk-forward seasons < T, exactly as `ml:backtest`. Unlike
 * the training examples (target seasons of 10+ games only), the scored
 * population is every skater a pre-season board would project: the usual
 * examples PLUS the players with a 10+ game season at T-1 or T-2 who then
 * played fewer than 10 games at T, or none. Their actual T is 0 (or the few
 * games played). `active` says whether such a player was still around:
 * an NHL game after T, or (last season) a place on an NHL club's roster,
 * prospect or organisation list (src/data/nhl-rosters.json) or a game this
 * season. Retirements are not on a board, so they are left out of the fit.
 *
 * Usage:
 *   npx tsx scripts/backtest-skater-oos.ts --out=<records.json>
 *     [--seasons=20182019,...] (test seasons; walk-forward starts 2 earlier)
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  actualRate,
  buildFeatureMatrix,
  buildLeagueContext,
  buildSkaterExamples,
  buildTargetLevels,
  eligibleHistory,
  gp82,
  indexPlayers,
  V2_MIN_ELIGIBLE_GP,
  type SkaterExample,
} from "../src/lib/ml/dataset-view";
import { sanitizeTargetSeasonRow } from "../src/lib/ml/features";
import { attachDurability } from "../src/lib/ml/gamelog-durability";
import {
  computeBaseSignals,
  fitStackedMetas,
  metaGpPrediction,
  metaRatePrediction,
  trainBoundary,
  V2_SKATER_TARGETS,
  type SeasonPredictions,
} from "../src/lib/ml/stack";
import {
  buildTeamDepthFromRows,
  setTrainingTeamDepthCache,
  type TeamDepthContext,
} from "../src/lib/ml/team-depth";
import type { MlDataset, PlayerSeasonRow } from "../src/lib/ml/types";

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const OUT = arg("out");
if (!OUT) throw new Error("--out=<records.json> required");
const DATA = arg("data") ?? join(process.cwd(), "src", "data", "ml", "dataset.json");
const TEST = (arg("seasons") ?? "20182019,20192020,20202021,20212022,20222023,20232024,20242025,20252026")
  .split(",")
  .map(Number);

const prevId = (s: number, k = 1) => s - 10001 * k;

function main() {
  const ds = JSON.parse(readFileSync(DATA, "utf8")) as MlDataset;
  const rows = ds.rows;
  attachDurability(rows);
  const allSeasons = [...new Set(rows.map((r) => r.seasonId))].sort((a, b) => a - b);
  const lastSeason = allSeasons[allSeasons.length - 1];
  const first = Math.min(...TEST);
  const wfSeasons = allSeasons.filter((s) => s >= prevId(first, 2) && s <= Math.max(...TEST));

  const historyMap = new Map<number, PlayerSeasonRow[]>();
  for (const r of rows) {
    const l = historyMap.get(r.playerId) ?? [];
    l.push(r);
    historyMap.set(r.playerId, l);
  }
  for (const l of historyMap.values()) l.sort((a, b) => a.seasonId - b.seasonId);
  const depth = new Map<number, Map<number, TeamDepthContext>>();
  for (const s of allSeasons) depth.set(s, buildTeamDepthFromRows(rows, historyMap, s));
  setTrainingTeamDepthCache(depth);

  // Still around after the last season: on a club list, or playing now.
  const activeNow = new Set<number>();
  const rosterPath = join(process.cwd(), "src", "data", "nhl-rosters.json");
  if (existsSync(rosterPath)) {
    const r = JSON.parse(readFileSync(rosterPath, "utf8")) as { players: Array<{ id: number }> };
    for (const p of r.players) activeNow.add(p.id);
  }

  const skaters = indexPlayers(rows, false);
  const league = buildLeagueContext(rows);
  const examples = buildSkaterExamples(rows);
  const levels = buildTargetLevels(rows, V2_SKATER_TARGETS, false);
  const matrix = buildFeatureMatrix(examples, league);
  const bySeason = new Map<number, number[]>();
  examples.forEach((ex, i) => {
    const l = bySeason.get(ex.seasonId) ?? [];
    l.push(i);
    bySeason.set(ex.seasonId, l);
  });

  // Non-survivors per season: 10+ games at T-1 or T-2, under 10 (or none) at T.
  const extrasOf = (T: number): Array<{ ex: SkaterExample; active: boolean }> => {
    const out: Array<{ ex: SkaterExample; active: boolean }> = [];
    const scored = new Set((bySeason.get(T) ?? []).map((i) => examples[i].playerId));
    for (const [id, hist] of skaters) {
      if (scored.has(id)) continue;
      const prior = hist.filter((r) => r.seasonId < T);
      const recent = prior.some(
        (r) => (r.seasonId === prevId(T) || r.seasonId === prevId(T, 2)) && r.gamesPlayed >= V2_MIN_ELIGIBLE_GP,
      );
      if (!recent || eligibleHistory(prior).length === 0) continue;
      const atT = hist.find((r) => r.seasonId === T);
      const later = hist.some((r) => r.seasonId > T);
      const active = Boolean(atT) || later || (T === lastSeason && activeNow.has(id));
      const last = prior[prior.length - 1];
      const years = (T - last.seasonId) / 10001;
      const base: PlayerSeasonRow = atT ?? {
        ...last,
        seasonId: T,
        gamesPlayed: 0,
        goals: 0,
        assists: 0,
        shots: 0,
        blocks: 0,
        hits: 0,
        powerplayPoints: 0,
        penaltyMinutes: 0,
        faceoffWins: 0,
        points: 0,
        age: last.age != null ? last.age + years : last.age,
      };
      out.push({
        ex: {
          playerId: id,
          seasonId: T,
          targetRow: sanitizeTargetSeasonRow(base, rows),
          actualRow: base,
          history: prior,
        },
        active,
      });
    }
    return out;
  };

  const t0 = Date.now();
  const seasons: SeasonPredictions[] = [];
  const extraSeasons = new Map<number, { list: Array<{ ex: SkaterExample; active: boolean }>; sig: ReturnType<typeof computeBaseSignals> }>();
  for (const T of wfSeasons) {
    const idx = bySeason.get(T) ?? [];
    if (idx.length === 0) continue;
    const models = trainBoundary(examples, matrix, rows, T, levels);
    const sig = computeBaseSignals(models, idx.map((i) => examples[i]), idx, matrix, levels);
    seasons.push({ seasonId: T, examples: idx.map((i) => examples[i]), exampleRows: idx, signals: sig });
    if (TEST.includes(T)) {
      const list = extrasOf(T);
      const em = buildFeatureMatrix(list.map((e) => e.ex), league);
      const esig = computeBaseSignals(models, list.map((e) => e.ex), list.map((_, i) => i), em, levels);
      extraSeasons.set(T, { list, sig: esig });
    }
    console.log(`boundary ${T}: ${idx.length} examples, ${extraSeasons.get(T)?.list.length ?? 0} non-survivors, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }

  const out: unknown[] = [];
  for (const T of TEST) {
    const sp = seasons.find((s) => s.seasonId === T);
    if (!sp) continue;
    const pool = seasons.filter((s) => s.seasonId < T);
    const { rateMetas, gpMeta } = fitStackedMetas(pool, T);
    const lastLine = (h: PlayerSeasonRow[]) => {
      const l = eligibleHistory(h).at(-1);
      return l
        ? { p82: ((l.goals + l.assists) * 82) / Math.max(1, l.gamesPlayed), toi: (l.toiPerGame ?? 0) / 60, gp82: gp82(l), s: l.seasonId }
        : null;
    };
    for (let k = 0; k < sp.examples.length; k++) {
      const ex = sp.examples[k];
      const young = eligibleHistory(ex.history).length <= 2;
      const isD = ex.targetRow.position === "D";
      const r: Record<string, unknown> = {};
      for (const t of V2_SKATER_TARGETS) {
        const s = sp.signals.rates[t];
        r[t] = {
          a: actualRate(ex.actualRow, t),
          st: metaRatePrediction(rateMetas[t], s, k, young, isD),
          mkt: s.market?.[k] ?? s.marcel[k],
          mar: s.marcel[k],
          ewma: s.ewma[k],
          lag1: s.lag1[k],
        };
      }
      out.push({
        T, id: ex.playerId, name: ex.actualRow.name, pos: ex.targetRow.position, age: ex.targetRow.age ?? null,
        young, surv: true, active: true, gpAct: ex.actualRow.gamesPlayed, act82: Math.min(82, gp82(ex.actualRow)),
        gpModel: metaGpPrediction(gpMeta, sp.signals.gp, k, young), last: lastLine(ex.history), r,
      });
    }
    const extra = extraSeasons.get(T);
    if (extra) {
      extra.list.forEach(({ ex, active }, k) => {
        const young = eligibleHistory(ex.history).length <= 2;
        out.push({
          T, id: ex.playerId, name: ex.actualRow.name, pos: ex.targetRow.position, age: ex.targetRow.age ?? null,
          young, surv: false, active, gpAct: ex.actualRow.gamesPlayed, act82: Math.min(82, gp82(ex.actualRow)),
          gpModel: metaGpPrediction(gpMeta, extra.sig.gp, k, young), last: lastLine(ex.history),
        });
      });
    }
    console.log(`scored ${T}: ${sp.examples.length} + ${extra?.list.length ?? 0}`);
  }
  writeFileSync(OUT!, JSON.stringify(out));
  console.log(`wrote ${out.length} records to ${OUT} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main();
