/**
 * Walk-forward backtest of the published goalie games played.
 *
 * For each season T (2015-16 .. 2025-26): the v2 goalie base models are
 * trained on the seasons before T, the stacked GP metas on the out-of-sample
 * signals of the seasons before T (as scripts/train-v2.ts does for the
 * bundle), then every goalie who played in T is projected through the
 * production inference path (inferGoalieForPlayer, no hindsight) and each
 * club's goalies go through a team allocation. Scored against the games he
 * played in T on an 82-game basis (gp82, the 2012-13 / 2019-20 / 2020-21
 * seasons scaled), by role from his history before T:
 *  - starter: last eligible season 40+ GP, 30+ starts or 35+ GP (the
 *    meta's own split, isStarterGoalie);
 *  - backup: any other goalie with an eligible season (8+ GP);
 *  - new: no eligible season (the board's prospect prior, 15 games);
 *  - established: 50+ GP in each of the two seasons before T (subset).
 *
 * Methods: `published` (renormalizeGoalieGamesByTeam, today's rule);
 * `legacyRenorm` (the rule it replaced: clear starter 1.35 × his backup
 * kept, else the top three pro rata to 80); `previousEngine` (the
 * 2026-09-27 board: legacyRenorm, then gp:recalibrate's history share —
 * starter = 80 × goalieStarterShare(0.7 GP T-1 + 0.3 GP T-2)); `model`
 * (the stacked GP alone); baselines `lag1` (last eligible season, gp82),
 * `ewma3` (0.5 / 0.3 / 0.2) and `fixedRole` (58 / 24 / 15).
 *
 * Two club rosters: `played` (the goalies who played for the club in T)
 * and `depth` (the same plus one org-depth goalie at the 15-game prospect
 * prior, unscored: the board lists the org depth too, and a roster known
 * only in hindsight flatters the allocations that split the budget).
 * The starter's budget elasticity α is swept, and chosen walk-forward
 * (α minimizing the MAE of the seasons before T, scored on T).
 * Goalies who did not play in T (retired, abroad, out all season) are not
 * scored: the board drops the first two, the third is rare.
 *
 * Writes src/data/ml/goalie-gp-backtest.json (checked by
 * scripts/check-preseason.ts). Run: npm run gp:goalie-backtest
 */
import { readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { calibratedGoalieGp } from "../src/lib/gp-calibration";
import { datasetManifestOf } from "../src/lib/ml/dataset-manifest";
import { gp82 } from "../src/lib/ml/dataset-view";
import { attachDurability } from "../src/lib/ml/gamelog-durability";
import { sanitizeTargetSeasonRow } from "../src/lib/ml/features";
import {
  buildGoalieExamples,
  buildGoalieLeagueContext,
  buildGoalieLevels,
  buildGoalieMatrix,
  computeGoalieSignals,
  fitGoalieMetas,
  goalieEligible,
  GOALIE_STARTER_BUDGET_ELASTICITY,
  GOALIE_TEAM_GAMES,
  inferGoalieForPlayer,
  isStarterGoalie,
  renormalizeGoalieGamesByTeam,
  trainGoalieBoundary,
  type GoalieExample,
  type GoalieSeasonPredictions,
} from "../src/lib/ml/goalie-v2";
import type { MlDataset, PlayerSeasonRow } from "../src/lib/ml/types";
import type { PlayerProfile } from "../src/lib/profile-types";
import { loadMoneyPuckRegistrySync } from "../src/lib/moneypuck-goalies";
import { normalizeTeamAbbrev } from "../src/lib/team-abbreviations";

const DATA_PATH = join(process.cwd(), "src", "data", "ml", "dataset.json");
const GOALIE_GP_BACKTEST_PATH = join(process.cwd(), "src", "data", "ml", "goalie-gp-backtest.json");
const POOL_FROM = 20112012;
const EVAL_FROM = 20152016;
const PROSPECT_PRIOR_GP = 15;
const ALPHAS = [0, 0.1, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.75, 1];

type Role = "starter" | "backup" | "new";
interface Rec {
  id: number;
  name: string;
  T: number;
  team: string;
  role: Role;
  established: boolean;
  /** Model GP (stacked meta) or the prospect prior. */
  m: number;
  lag1: number;
  ewma3: number;
  /** Raw GP of T-1 and T-2 (the previous engine's history share). */
  gpPrev1: number;
  gpPrev2: number;
  y: number;
  synthetic?: boolean;
}

/** The allocation published until 2026-10-02 (kept here as the reference). */
function legacyRenormalize(players: Rec[], teamBudget = 80): Map<number, number> {
  const out = new Map<number, number>(players.map((p) => [p.id, Math.round(p.m)]));
  const ordered = [...players].sort((a, b) => out.get(b.id)! - out.get(a.id)!);
  if (ordered.length < 2) return out;
  const active = ordered.slice(0, 3);
  const depth = ordered.slice(3);
  const sum = active.reduce((s, p) => s + out.get(p.id)!, 0);
  if (!(sum > 0)) return out;
  const lead = out.get(active[0]!.id)!;
  const second = out.get(active[1]!.id) ?? 0;
  if (second > 0 && lead / second >= 1.35) {
    const starterGp = Math.max(4, Math.min(65, Math.round(lead)));
    out.set(active[0]!.id, starterGp);
    const restModeled = active.slice(1).reduce((s, p) => s + out.get(p.id)!, 0);
    const remaining = Math.max(0, teamBudget - starterGp);
    for (const p of active.slice(1)) {
      const share = restModeled > 0 ? out.get(p.id)! / restModeled : 0.5;
      out.set(p.id, Math.max(4, Math.min(starterGp, Math.round(remaining * share))));
    }
  } else if (Math.abs(sum - teamBudget) > 5) {
    const scale = teamBudget / sum;
    for (const p of active) out.set(p.id, Math.max(4, Math.min(72, Math.round(out.get(p.id)! * scale))));
  }
  for (const p of depth) out.set(p.id, 4);
  return out;
}

function published(club: Rec[], alpha = GOALIE_STARTER_BUDGET_ELASTICITY): Map<number, number> {
  const res = renormalizeGoalieGamesByTeam(
    club.map((p) => ({ id: p.id, team: p.team, isGoalie: true, gamesPlayed: Math.round(p.m) })),
    GOALIE_TEAM_GAMES,
    alpha,
  );
  return new Map(res.map((p) => [p.id, p.gamesPlayed]));
}

function previousEngine(club: Rec[]): Map<number, number> {
  const legacy = legacyRenormalize(club);
  const T = club[0]!.T;
  const y = Math.floor(T / 10000);
  const season = `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  const profiles = new Map<number, PlayerProfile>(
    club.map((p) => [
      p.id,
      {
        teamHistory: [
          { isGoalie: true, seasonId: T - 10001, gamesPlayed: p.gpPrev1 },
          { isGoalie: true, seasonId: T - 20002, gamesPlayed: p.gpPrev2 },
        ],
      } as unknown as PlayerProfile,
    ]),
  );
  const cal = calibratedGoalieGp(
    club.map((p) => ({ id: p.id, team: p.team, isGoalie: true, gamesPlayed: legacy.get(p.id)!, modelGamesPlayed: legacy.get(p.id)! })),
    profiles,
    season,
  );
  return new Map(club.map((p) => [p.id, cal.get(p.id) ?? legacy.get(p.id)!]));
}

const METHODS: Record<string, (club: Rec[]) => Map<number, number>> = {
  published: (c) => published(c),
  legacyRenorm: legacyRenormalize,
  previousEngine,
  model: (c) => new Map(c.map((p) => [p.id, Math.max(4, Math.min(72, p.m))])),
  lag1: (c) => new Map(c.map((p) => [p.id, p.lag1])),
  ewma3: (c) => new Map(c.map((p) => [p.id, p.ewma3])),
  fixedRole: (c) => new Map(c.map((p) => [p.id, p.role === "starter" ? 58 : p.role === "backup" ? 24 : PROSPECT_PRIOR_GP])),
};

interface Cell {
  n: number;
  mae: number;
  bias: number;
  rmse: number;
}
const GROUPS = ["all", "starter", "backup", "new", "established"] as const;

function score(recs: Rec[], pred: Map<string, number>): Record<string, Cell> {
  const acc: Record<string, { n: number; ae: number; e: number; se: number }> = {};
  for (const r of recs) {
    if (r.synthetic) continue;
    const p = pred.get(`${r.id}:${r.T}`)!;
    const groups: string[] = ["all", r.role];
    if (r.established) groups.push("established");
    for (const g of groups) {
      const a = (acc[g] ??= { n: 0, ae: 0, e: 0, se: 0 });
      a.n++;
      a.ae += Math.abs(p - r.y);
      a.e += p - r.y;
      a.se += (p - r.y) ** 2;
    }
  }
  const out: Record<string, Cell> = {};
  for (const g of GROUPS) {
    const a = acc[g];
    if (!a) continue;
    const r2 = (x: number) => Math.round(x * 100) / 100;
    out[g] = { n: a.n, mae: r2(a.ae / a.n), bias: r2(a.e / a.n), rmse: r2(Math.sqrt(a.se / a.n)) };
  }
  return out;
}

function predictAll(clubs: Rec[][], f: (club: Rec[]) => Map<number, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const club of clubs) for (const [id, gp] of f(club)) out.set(`${id}:${club[0]!.T}`, gp);
  return out;
}

function main() {
  const raw = readFileSync(DATA_PATH);
  const dataset = JSON.parse(raw.toString("utf8")) as MlDataset;
  const manifest = datasetManifestOf(raw, dataset);
  const rows = dataset.rows;
  attachDurability(rows);
  const registry = loadMoneyPuckRegistrySync();
  const league = buildGoalieLeagueContext(rows, registry);
  const examples = buildGoalieExamples(rows);
  const matrix = buildGoalieMatrix(examples, league, registry);
  const levels = buildGoalieLevels(rows);

  const byPlayer = new Map<number, PlayerSeasonRow[]>();
  for (const r of rows) {
    if (!r.isGoalie) continue;
    const l = byPlayer.get(r.playerId) ?? [];
    l.push(r);
    byPlayer.set(r.playerId, l);
  }
  for (const l of byPlayer.values()) l.sort((a, b) => a.seasonId - b.seasonId);
  const exBySeason = new Map<number, number[]>();
  examples.forEach((e, i) => {
    const l = exBySeason.get(e.seasonId) ?? [];
    l.push(i);
    exBySeason.set(e.seasonId, l);
  });

  const seasons = [...new Set(rows.map((r) => r.seasonId))].filter((s) => s >= POOL_FROM).sort();
  const pool: GoalieSeasonPredictions[] = [];
  const recs: Rec[] = [];
  for (const T of seasons) {
    const models = trainGoalieBoundary(examples, matrix, league, registry, T, levels);
    if (T >= EVAL_FROM) {
      const metas = fitGoalieMetas(pool, T);
      for (const r of rows) {
        if (!r.isGoalie || r.seasonId !== T || !(r.gamesPlayed > 0)) continue;
        const history = (byPlayer.get(r.playerId) ?? []).filter((h) => h.seasonId < T);
        const eligible = goalieEligible(history);
        const target = sanitizeTargetSeasonRow(r, rows);
        const res =
          eligible.length > 0
            ? inferGoalieForPlayer(
                { ...models, keptFeatureNames: models.keptFeatureNames },
                metas,
                history,
                target,
                league,
                registry,
                levels,
              )
            : null;
        const g82 = eligible.map((h) => Math.min(82, gp82(h)));
        const w = [0.5, 0.3, 0.2];
        let ew = 0;
        let ws = 0;
        for (let i = 0; i < Math.min(3, g82.length); i++) {
          ew += g82[g82.length - 1 - i]! * w[i]!;
          ws += w[i]!;
        }
        const gpIn = (sid: number) => history.filter((h) => h.seasonId === sid).reduce((s, h) => s + h.gamesPlayed, 0);
        const role: Role =
          eligible.length === 0
            ? "new"
            : isStarterGoalie({ history, targetRow: target, actualRow: target } as GoalieExample)
              ? "starter"
              : "backup";
        recs.push({
          id: r.playerId,
          name: r.name,
          T,
          team: normalizeTeamAbbrev(r.team) || r.team,
          role,
          established: gpIn(T - 10001) >= 50 && gpIn(T - 20002) >= 50,
          m: res ? res.gamesPlayed : PROSPECT_PRIOR_GP,
          lag1: g82.length ? g82.at(-1)! : PROSPECT_PRIOR_GP,
          ewma3: ws > 0 ? ew / ws : PROSPECT_PRIOR_GP,
          gpPrev1: gpIn(T - 10001),
          gpPrev2: gpIn(T - 20002),
          y: Math.min(82, gp82(r)),
        });
      }
    }
    const idx = exBySeason.get(T) ?? [];
    const signals = computeGoalieSignals(models, idx.map((i) => examples[i]!), idx, matrix, league, registry, levels);
    pool.push({ seasonId: T, examples: idx.map((i) => examples[i]!), signals });
    console.log(`${T}: ${idx.length} training examples${T >= EVAL_FROM ? `, ${recs.filter((r) => r.T === T).length} goalies scored` : ""}`);
  }

  const clubsOf = (withDepth: boolean): Rec[][] => {
    const m = new Map<string, Rec[]>();
    for (const r of recs) {
      const k = `${r.team}:${r.T}`;
      const l = m.get(k) ?? [];
      l.push(r);
      m.set(k, l);
    }
    const clubs = [...m.values()];
    if (withDepth) {
      let n = 0;
      for (const c of clubs) {
        const base = c[0]!;
        c.push({ ...base, id: -1 - n++, name: "org depth", role: "new", established: false, m: PROSPECT_PRIOR_GP, y: 0, synthetic: true });
      }
    }
    return clubs;
  };

  const scenarios = { played: clubsOf(false), depth: clubsOf(true) };
  const evalSeasons = [...new Set(recs.map((r) => r.T))].sort();
  const result: Record<string, unknown> = {};
  for (const [scen, clubs] of Object.entries(scenarios)) {
    const methods: Record<string, Record<string, Cell>> = {};
    const established: Record<string, { meanPred: number; meanActual: number; under45: number }> = {};
    for (const [name, f] of Object.entries(METHODS)) {
      const pred = predictAll(clubs, f);
      methods[name] = score(recs, pred);
      const est = recs.filter((r) => r.established);
      established[name] = {
        meanPred: Math.round((est.reduce((s, r) => s + pred.get(`${r.id}:${r.T}`)!, 0) / est.length) * 10) / 10,
        meanActual: Math.round((est.reduce((s, r) => s + r.y, 0) / est.length) * 10) / 10,
        under45: est.filter((r) => pred.get(`${r.id}:${r.T}`)! < 45).length,
      };
    }
    // α sweep, and α picked walk-forward on the seasons before T.
    const byAlpha = new Map(ALPHAS.map((a) => [a, predictAll(clubs, (c) => published(c, a))]));
    const sweep: Record<string, number> = {};
    for (const [a, pred] of byAlpha) sweep[String(a)] = score(recs, pred).all!.mae;
    const picks: [number, number][] = [];
    const wfPred = new Map<string, number>();
    for (const T of evalSeasons) {
      const past = recs.filter((r) => r.T < T);
      let best = GOALIE_STARTER_BUDGET_ELASTICITY;
      if (past.length > 0) {
        let bestMae = Infinity;
        for (const [a, pred] of byAlpha) {
          const mae = score(past, pred).all!.mae;
          if (mae < bestMae - 1e-9) {
            bestMae = mae;
            best = a;
          }
        }
      }
      picks.push([T, best]);
      for (const r of recs) if (r.T === T) wfPred.set(`${r.id}:${r.T}`, byAlpha.get(best)!.get(`${r.id}:${r.T}`)!);
    }
    result[scen] = { methods, established, alphaSweep: sweep, walkForwardAlpha: { picks, scores: score(recs.filter((r) => r.T > evalSeasons[0]!), wfPred) } };
  }

  const out = {
    version: 1,
    fittedAt: new Date().toISOString(),
    datasetSha1: manifest.sha1,
    seasons: [evalSeasons[0], evalSeasons.at(-1)],
    goalies: recs.length,
    teamGames: GOALIE_TEAM_GAMES,
    alpha: GOALIE_STARTER_BUDGET_ELASTICITY,
    source:
      "scripts/backtest-goalie-gp.ts: walk-forward (base models and GP metas trained on the seasons before T, production inference), every goalie who played in T, scored on his games of T on an 82-game basis; roles from the history before T",
    ...result,
  };
  writeFileAtomic(GOALIE_GP_BACKTEST_PATH, `${JSON.stringify(out, null, 1)}\n`);

  for (const scen of Object.keys(scenarios)) {
    const s = result[scen] as {
      methods: Record<string, Record<string, Cell>>;
      established: Record<string, { meanPred: number; meanActual: number; under45: number }>;
      alphaSweep: Record<string, number>;
      walkForwardAlpha: { picks: [number, number][]; scores: Record<string, Cell> };
    };
    console.log(`\n== clubs: ${scen} (MAE / bias, games on an 82-game basis)`);
    console.log(`${"method".padEnd(15)}${GROUPS.map((g) => g.padStart(20)).join("")}   established mean pred / actual, < 45`);
    for (const [name, cells] of Object.entries(s.methods)) {
      const e = s.established[name]!;
      console.log(
        `${name.padEnd(15)}${GROUPS.map((g) => {
          const c = cells[g];
          return (c ? `${c.n} ${c.mae.toFixed(2)} ${c.bias >= 0 ? "+" : ""}${c.bias.toFixed(2)}` : "").padStart(20);
        }).join("")}   ${e.meanPred} / ${e.meanActual}, ${e.under45}`,
      );
    }
    console.log(`α sweep (MAE all): ${Object.entries(s.alphaSweep).map(([a, m]) => `${a}: ${m.toFixed(2)}`).join(", ")}`);
    console.log(
      `α walk-forward: ${s.walkForwardAlpha.picks.map(([t, a]) => `${String(t).slice(4)} ${a}`).join(", ")}; MAE ${s.walkForwardAlpha.scores.all!.mae.toFixed(2)} (seasons after the first)`,
    );
  }
}

main();
