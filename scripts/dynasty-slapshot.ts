/**
 * File side of the Slapshot Fantasy League dynasty build
 * (`npm run dynasty:build -- --league slapshot`): the league-1 universe and
 * research tables (scripts/dynasty-inputs.ts: every projected NHL player,
 * the prospect model, the prospect pool) run through the same engine under
 * the Slapshot profile (src/lib/dynasty/slapshot.ts): Slapshot scoring,
 * replacement from its 640 starting seats, no captain, no keeper cutdown,
 * and the salary-cap layer.
 *
 * Reads, besides the league-1 inputs: src/data/dynasty/slapshot/league.json
 * (profile), pool.json (Fantrax positions, rosters, picks: scripts/slapshot-sync.ts),
 * contract-seasons.json (capwages per-season cap hits: scripts/fetch-contract-seasons.ts;
 * player-profiles.json `contract` as the fallback), src/data/players.json
 * (projected stats → Slapshot points).
 * Writes public/fantrax/slapshot/dynasty.json and, with --lite PATH, the
 * compact board file for the live draft page.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { makeLevel } from "../src/lib/dynasty/aging";
import { buildDynasty, DEFAULT_PATHS, type BuildResult, type DynastyRecord, type Group, type Mode } from "../src/lib/dynasty/index";
import { projectedX } from "../src/lib/dynasty/scale";
import type { Routed } from "../src/lib/dynasty/segment";
import {
  explainSlapshotFr,
  fitSalaryModel,
  goalieFpg,
  nhlCapOf,
  parseSlapshotProfile,
  lambdaBySeason,
  prepareSlapshot,
  rosterSpotCost,
  skaterFpg,
  slapshotRecord,
  type KnownContract,
  type SalaryModel,
  type SalaryRow,
  type SeatPlayer,
  type SlapPlayerData,
  type SlapPos,
  type SlapPrepared,
  type SlapshotProfile,
  type SlapshotRecord,
} from "../src/lib/dynasty/slapshot";
import type { PlayerProfile } from "../src/lib/profile-types";
import type { ProjectionsDataset } from "../src/lib/types";
import { assembleDynastyInputs, loadDynastyFiles, type LoadedDynastyFiles } from "./dynasty-inputs";
import type { ContractSeasonsFile } from "./fetch-contract-seasons";
import type { SlapshotPool } from "./slapshot-sync";

export function slapshotPaths(root = process.cwd()) {
  const dir = join(root, "src", "data", "dynasty", "slapshot");
  return {
    league: join(dir, "league.json"),
    pool: join(dir, "pool.json"),
    contracts: join(dir, "contract-seasons.json"),
    out: join(root, "public", "fantrax", "slapshot", "dynasty.json"),
  };
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

/** Paths of the calibration pass (season pools for λ_t, the roster-spot rent). */
const PASS1_PATHS = 600;
/** Seasons whose λ is solved from their own pool (then held per share of the cap). */
const LAMBDA_SEASONS = 3;

export interface SlapshotSnapshot {
  builtAt: string;
  league: { id: string; name: string; teams: number };
  season: "2026-27";
  version: 1;
  inputs: {
    valuesFetchedAt: string;
    projectionsAt: string;
    prospectsBuiltAt: string;
    poolFetchedAt: string;
    contractsFetchedAt: string | null;
    paramsVersion: string;
    profileVersion: string;
  };
  params: {
    T: number;
    paths: number;
    modes: Record<Mode, { delta: number; w0: number; w1?: number }>;
    fantasyShare: number;
    scoring: SlapshotProfile["scoring"]["skater"] & { goalie: SlapshotProfile["scoring"]["goalie"] };
    /** Replacement: season points by position, skaters per NHL game (fantasy season), goalies per season slot. */
    repl: { season: Record<SlapPos, number>; perGame: Record<string, number>; G: number };
    kDefault: Record<Group, number>;
    cap: { league: number[]; nhl: number[]; min: number[]; growthAfter: number };
    /** Cap shadow price per season (league points per M$ above the minimum). */
    lambda: number[];
    /** Per solved season (2026-27 …): both estimators and the snake allocation's team caps. */
    lambdaDiag: {
      method: string;
      seasons: Array<{
        season: number;
        aggregate: number;
        capUsedAt0: number;
        budget: number;
        snake: { mean: number; sd: number; reps: number; median: number; over: number; teamCap: { min: number; median: number; max: number } };
      }>;
    };
    /** Roster-spot rent charged per held season from 2027-28 (and the keep / drop gate), league points. */
    rosterSpot: { cost: number; rank: number };
    salaryModel: SalaryModel;
    market: { enabled: boolean };
  };
  players: Record<string, SlapshotRecord>;
  /** Modeled players left out (value < 0.5 in every mode, not rostered): read 0. */
  zero: string[];
}

/** Known contract seasons of one NHL player: capwages rows (newest contract wins), else the profile. */
export function knownContract(
  prof: SlapshotProfile,
  cw: ContractSeasonsFile["players"][string] | undefined,
  pr: PlayerProfile | undefined,
  y0: number,
): KnownContract {
  if (cw && !cw.err && cw.segs.length) {
    const seasons: Record<string, number> = {};
    let exp: KnownContract["exp"] = null;
    let elc = false;
    let lastYear = -1;
    // newest contract first; a newer contract ends an older one from its first season
    // (a bought-out or terminated deal keeps listing its old seasons: Skinner's 9 M$ in 2026-27)
    const segs = cw.segs
      .filter((s) => s.seasons.length)
      .map((s) => ({ s, first: Math.min(...s.seasons.map((x) => x[0])) }))
      .sort((a, b) => b.first - a.first);
    let cutoff = Number.POSITIVE_INFINITY;
    for (const { s: seg, first } of segs) {
      const until = cutoff;
      cutoff = Math.min(cutoff, first);
      for (const [y, hit] of seg.seasons) {
        if (y < y0 || y >= until || seasons[String(y)] != null) continue;
        seasons[String(y)] = hit / 1e6;
        if (y === y0 && /entry/i.test(seg.type ?? "")) elc = true;
        if (y > lastYear) {
          lastYear = y;
          exp = /RFA/i.test(seg.exp ?? "") ? "RFA" : /UFA/i.test(seg.exp ?? "") ? "UFA" : null;
        }
      }
    }
    if (Object.keys(seasons).length) return { seasons, exp, elc, source: "capwages" };
    // capwages has him but nothing from 2026-27 on: unsigned now
    return { seasons: {}, exp: null, elc: false, source: "capwages" };
  }
  const c = pr?.contract;
  if (c?.capHitUsd && c.yearsRemaining != null && c.yearsRemaining > 0) {
    const seasons: Record<string, number> = {};
    const yr = c.yearsRemaining;
    // more than 8 seasons = the current contract + an extension listed at the extension's cap hit
    const pre = Math.max(0, yr - 8);
    for (let i = 0; i < yr; i++) seasons[String(y0 + i)] = i < pre ? prof.cap.elcCapHit : c.capHitUsd / 1e6;
    const exp = /RFA/i.test(c.expiryStatus ?? "") ? "RFA" : /UFA/i.test(c.expiryStatus ?? "") ? "UFA" : null;
    return { seasons, exp, elc: /entry/i.test(c.contractType ?? "") && pre === 0, source: "profile" };
  }
  return { seasons: {}, exp: null, elc: false, source: "none" };
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/** "Jul. 29, 2026" / "Sept. 1, 2024" → ms. */
export function parseSigned(s: string | null | undefined): number | null {
  const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/.exec(s ?? "");
  if (!m) return null;
  const mo = MONTHS[m[1]!.toLowerCase()];
  return mo == null ? null : Date.UTC(Number(m[3]), mo, Number(m[2]));
}

/** Training rows: non-ELC contracts whose first season is 2023-24 … 2027-28, against today's level and role. */
export function salaryRows(
  prof: SlapshotProfile,
  routed: readonly Routed[],
  cw: ContractSeasonsFile | null,
  profiles: ReadonlyMap<number, PlayerProfile>,
): SalaryRow[] {
  const rows: SalaryRow[] = [];
  if (!cw) return rows;
  for (const r of routed) {
    if (r.path !== "nhl" || !r.sim || r.sim.theta0 == null || !r.input.nhlId) continue;
    const rec = cw.players[r.input.nhlId];
    if (!rec || rec.err) continue;
    const birth = profiles.get(r.input.nhlId)?.bio?.birthDate ?? r.input.birthDate;
    const bms = birth ? Date.parse(birth) : NaN;
    rec.segs.forEach((seg, i) => {
      if (/entry/i.test(seg.type ?? "") || !seg.seasons.length) return;
      const first = Math.min(...seg.seasons.map((s) => s[0]));
      if (first < 2023 || first > 2027) return;
      const aav = seg.seasons.reduce((s, x) => s + x[1], 0) / seg.seasons.length / 1e6;
      const signedMs = parseSigned(seg.signed) ?? Date.UTC(first, 6, 1);
      const age = Number.isFinite(bms) ? (signedMs - bms) / (365.25 * 864e5) : r.age0 - (2026 - first) - 0.25;
      const prev = rec.segs[i + 1];
      rows.push({
        g: r.g,
        pct: aav / nhlCapOf(prof, first),
        age,
        theta: r.sim!.theta0!,
        share: r.sim!.share0 ?? 0.5,
        rfa: /RFA/i.test(prev?.exp ?? "") || (!prev && age < prof.contracts.ufaAge),
      });
    });
  }
  return rows;
}

export interface SlapshotBuild {
  result: BuildResult;
  prep: SlapPrepared;
  snapshot: SlapshotSnapshot;
  records: Record<string, SlapshotRecord>;
  pool: SlapshotPool;
  profile: SlapshotProfile;
  model: SalaryModel;
  salaryRowCount: number;
  /** The λ = 0 build's records (compareNoCap), for the contract-effect table. */
  noCap: Record<string, DynastyRecord> | null;
  ms: number;
}

export function runSlapshotBuild(
  opts: {
    paths?: number;
    out?: string | null;
    market?: boolean;
    onProgress?: (d: number, n: number) => void;
    /** Also build with λ = 0 (the report's contract-effect table). */
    compareNoCap?: boolean;
  } = {},
  L: LoadedDynastyFiles = loadDynastyFiles(),
): SlapshotBuild {
  const t0 = Date.now();
  const SP = slapshotPaths();
  const profile = parseSlapshotProfile(readJson(SP.league));
  const pool = readJson<SlapshotPool>(SP.pool);
  const cw = existsSync(SP.contracts) ? readJson<ContractSeasonsFile>(SP.contracts) : null;
  const p = L.params;
  const y0 = p.firstSeasonYear;
  const dataset = readJson<ProjectionsDataset>(L.paths.players);
  const projById = new Map(dataset.players.map((x) => [x.id, x]));
  const profiles = new Map(readJson<{ profiles: PlayerProfile[] }>(L.paths.profiles).profiles.map((x) => [x.id, x]));

  const base = assembleDynastyInputs(L);
  const rosteredIds = new Set(Object.values(pool.rosters).flat());
  const leaguePick = new Map(pool.picks.map(([pick, , id]) => [id, pick]));
  const inputs = {
    ...base,
    players: base.players.map((x) => {
      const { leaguePick: _lp, ...rest } = x;
      void _lp;
      return { ...rest, rostered: rosteredIds.has(x.id), ...(leaguePick.has(x.id) ? { leaguePick: leaguePick.get(x.id)! } : {}) };
    }),
    league: undefined,
  };

  // per-player league data: scoring ratio, Slapshot positions, known contract
  const data = new Map<string, SlapPlayerData>();
  for (const inp of inputs.players) {
    const pj = inp.nhlId ? projById.get(inp.nhlId) : undefined;
    let k: number | null = null;
    if (pj && inp.proj?.src === "proj") {
      const isG = inp.proj.gE !== undefined;
      const g: Group = isG ? "G" : /(^|,)D(,|$)/.test(inp.e) && !/(^|,)(C|W)(,|$)/.test(inp.e) ? "D" : "F";
      const x = projectedX(g, inp.proj);
      const j = pj.projection as unknown as Record<string, number>;
      const fpg = isG
        ? goalieFpg(profile, { gp: pj.gamesPlayed, wins: j.wins ?? 0, shutouts: j.shutouts ?? 0, saves: j.saves ?? 0, savePct: j.savePct ?? 0.9 })
        : skaterFpg(profile, g === "D" ? "D" : "F", {
            gp: pj.gamesPlayed,
            goals: j.goals ?? 0,
            assists: j.assists ?? 0,
            shots: j.shots ?? 0,
            ppp: j.powerplayPoints ?? 0,
          });
      if (x > 0.3 && fpg > 0 && pj.gamesPlayed >= 5) k = fpg / x;
    }
    const pos = (pool.pos[inp.id] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is SlapPos => s === "C" || s === "LW" || s === "RW" || s === "D" || s === "G");
    const known = knownContract(profile, inp.nhlId ? cw?.players[inp.nhlId] : undefined, inp.nhlId ? profiles.get(inp.nhlId) : undefined, y0);
    data.set(inp.id, { k, pos, known });
  }

  const level = makeLevel(p);
  const N = opts.paths ?? DEFAULT_PATHS;
  const T = p.T;
  let salaryRowCount = 0;
  let model: SalaryModel | null = null;
  const run = (paths: number, gate: { K: number } | null, lambda: number[] | undefined, progress: boolean) => {
    let prep: SlapPrepared | null = null;
    const result = buildDynasty(inputs, p, {
      paths,
      ...(opts.market != null ? { market: opts.market } : {}),
      ...(progress && opts.onProgress ? { onProgress: opts.onProgress } : {}),
      ...(gate ? { K: gate.K, Kgate: gate.K } : {}),
      league: {
        keeperGate: !!gate,
        prepare: (routed) => {
          if (!model) {
            const rows = salaryRows(profile, routed, cw, profiles);
            salaryRowCount = rows.length;
            model = fitSalaryModel(rows);
          }
          prep = prepareSlapshot(profile, p, level, routed, data, model, {
            ...(lambda ? { lambda } : {}),
            rosterGate: !!gate,
          });
        },
      },
    });
    return { result, prep: prep as unknown as SlapPrepared };
  };
  // Pass 1 (ungated, 2026-27 λ held per share of the cap): season-t pools for
  // λ_t, and the marginal rostered asset for the roster-spot rent.
  const pass1 = run(Math.min(N, PASS1_PATHS), null, undefined, false);
  const pools: SeatPlayer[][] = [];
  for (let t = 0; t < LAMBDA_SEASONS; t++) {
    const pool: SeatPlayer[] = [];
    for (const [id, rec] of Object.entries(pass1.result.all)) {
      const fp = (rec.eFP[t] ?? 0) * (pass1.prep.kEff.get(id) ?? 0);
      if (!(fp > 0)) continue;
      pool.push({ id, pos: pass1.prep.pos.get(id) ?? [], fp, cap: pass1.prep.contracts.get(id)!.cap[t]! });
    }
    pools.push(pool);
  }
  const lam = lambdaBySeason(profile, pass1.prep.capSeries, pools);
  const rosterRank = profile.league.teams * profile.roster.max;
  const spot = rosterSpotCost(
    Object.values(pass1.result.all).map((r) => r.dv.balanced),
    rosterRank,
    p.modes.balanced.delta,
  );
  // Pass 2: λ by season, roster-spot rent and the keep / drop gate every September.
  const { result, prep: pr } = run(N, { K: spot }, lam.lambda, true);
  // Report only: the same build with λ = 0 (what the contracts alone move).
  const noCap = opts.compareNoCap ? run(N, { K: spot }, new Array<number>(T).fill(0), false).result.all : null;
  const md = model as unknown as SalaryModel;

  const records: Record<string, SlapshotRecord> = {};
  for (const [id, rec] of Object.entries(result.all)) records[id] = slapshotRecord(rec, pr, id, (r) => explainSlapshotFr(r, y0));
  const players: Record<string, SlapshotRecord> = {};
  const zero: string[] = [];
  for (const id of Object.keys(records).sort()) {
    const r = records[id]!;
    if (rosteredIds.has(id) || r.dv.longTerm >= p.output.minLongTerm || r.dv.balanced >= p.output.minLongTerm) players[id] = r;
    else zero.push(id);
  }
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const meta = inputs.meta;
  const builtAt = [meta.valuesFetchedAt, meta.projectionsAt, meta.prospectsBuiltAt, pool.fetchedAt, cw?.fetchedAt ?? ""].filter(Boolean).sort().pop()!;
  const snapshot: SlapshotSnapshot = {
    builtAt,
    league: { id: profile.league.id, name: profile.league.name, teams: profile.league.teams },
    season: "2026-27",
    version: 1,
    inputs: {
      valuesFetchedAt: meta.valuesFetchedAt,
      projectionsAt: meta.projectionsAt,
      prospectsBuiltAt: meta.prospectsBuiltAt,
      poolFetchedAt: pool.fetchedAt,
      contractsFetchedAt: cw?.fetchedAt ?? null,
      paramsVersion: p.version,
      profileVersion: profile.version,
    },
    params: {
      T: p.T,
      paths: N,
      modes: result.snapshot.params.modes,
      fantasyShare: profile.season.fantasyShare,
      scoring: { ...profile.scoring.skater, goalie: profile.scoring.goalie },
      repl: {
        season: Object.fromEntries(Object.entries(pr.repl.season).map(([k, v]) => [k, Math.round(v)])) as Record<SlapPos, number>,
        perGame: Object.fromEntries(Object.entries(pr.repl.perGame).map(([k, v]) => [k, r3(v)])),
        G: Math.round(pr.repl.G),
      },
      kDefault: { F: r3(pr.kDefault.F), D: r3(pr.kDefault.D), G: r3(pr.kDefault.G) },
      cap: { league: pr.capSeries.league, nhl: pr.capSeries.nhl, min: pr.capSeries.min, growthAfter: profile.cap.growthAfter },
      lambda: pr.lambda.map(r3),
      lambdaDiag: {
        method: profile.lambda.method,
        seasons: lam.diag.map((d, t) => ({
          season: y0 + t,
          aggregate: r3(d.aggregate),
          capUsedAt0: Math.round(d.capUsedAt0),
          budget: Math.round(d.budget * 10) / 10,
          snake: {
            mean: r3(d.snake.mean),
            sd: r3(d.snake.sd),
            reps: d.snake.reps,
            median: r3(d.snake.median),
            over: Math.round(d.snake.over * 10) / 10,
            teamCap: {
              min: Math.round(d.snake.teamCap.min * 10) / 10,
              median: Math.round(d.snake.teamCap.median * 10) / 10,
              max: Math.round(d.snake.teamCap.max * 10) / 10,
            },
          },
        })),
      },
      rosterSpot: { cost: r3(spot), rank: rosterRank },
      salaryModel: {
        skater: { ...md.skater, beta: md.skater.beta.map(r3), r2: r3(md.skater.r2), rmse: r3(md.skater.rmse) },
        goalie: { ...md.goalie, beta: md.goalie.beta.map(r3), r2: r3(md.goalie.r2), rmse: r3(md.goalie.rmse) },
      },
      market: { enabled: opts.market ?? p.market.enabled },
    },
    players,
    zero,
  };
  if (opts.out !== null) writeFileAtomic(opts.out ?? SP.out, `${JSON.stringify(snapshot)}\n`);
  return { result, prep: pr, snapshot, records, pool, profile, model: md, salaryRowCount, noCap, ms: Date.now() - t0 };
}

/** Hard gates on the Slapshot snapshot (the build fails on any). */
export function slapshotChecks(b: SlapshotBuild): string[] {
  const errors: string[] = [];
  const s = b.snapshot;
  const finite = (x: number) => Number.isFinite(x);
  const lam = s.params.lambda;
  if (!lam.every((x) => finite(x) && x >= 0)) errors.push(`λ not finite / negative: ${lam.join(",")}`);
  const rp = s.params.repl;
  for (const [k, v] of Object.entries(rp.perGame)) if (!(v > 0.3 && v < 3)) errors.push(`replacement ${k} ${v} pts/GP outside 0.3-3`);
  if (!(rp.G > 0)) errors.push(`goalie replacement ${rp.G}`);
  let bad = 0;
  let belowSpot = 0;
  // a season's gain is never below minus the roster-spot rent (the minors / drop floor)
  const floor = -s.params.rosterSpot.cost - 0.051;
  for (const r of Object.values(s.players)) {
    const nums = [...Object.values(r.dv), ...r.eG, ...r.contract.cap, ...r.contract.capFP, ...r.band.balanced, ...r.band.longTerm];
    if (!nums.every(finite) || r.contract.cap.some((x) => x < 0)) bad++;
    if (r.eG.some((x) => x < floor)) belowSpot++;
  }
  if (bad) errors.push(`${bad} records with NaN / Infinity or a negative cap hit`);
  if (belowSpot) errors.push(`${belowSpot} records with a season gain below minus the roster-spot rent`);
  if (Object.keys(s.players).length < 800) errors.push(`only ${Object.keys(s.players).length} players written`);
  const rostered = Object.values(b.pool.rosters).flat();
  const missing = rostered.filter((id) => b.records[id] && !s.players[id]);
  if (missing.length) errors.push(`${missing.length} rostered players missing from the output`);
  const byName = (n: string) => Object.values(b.records).find((r) => r.n === n);
  for (const n of ["Connor McDavid", "Nathan MacKinnon"]) {
    const r = byName(n);
    if (!r || r.rank.winNow > 25) errors.push(`${n} win-now rank ${r?.rank.winNow ?? "missing"} (expected top 25)`);
  }
  return errors;
}

const pad = (s: string | number, n: number) => String(s).padEnd(n).slice(0, n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);

function line(id: string, r: SlapshotRecord, fpRank?: number): string {
  const c = r.contract;
  const cap = `${c.cap[0]!.toFixed(2)}M ${c.signed}y${c.elc ? " ELC" : ""}${c.expiry != null && c.nextAav != null ? ` ->${c.nextAav.toFixed(1)}` : ""}`;
  return `${lpad(r.rank.balanced, 4)}/${lpad(r.rank.longTerm, 4)}/${lpad(r.rank.winNow, 4)} ${pad(r.n, 22)} ${pad(r.pos.join("/"), 7)} ${r.age.toFixed(1)} ${pad(r.phase, 14)} BAL${lpad(Math.round(r.dv.balanced), 5)} LT${lpad(Math.round(r.dv.longTerm), 5)} WN${lpad(Math.round(r.dv.winNow), 5)} fp0 ${lpad(r.fp0 ?? "-", 4)}${fpRank ? ` (#${fpRank})` : ""} | ${pad(cap, 22)} capFP ${c.capFP.slice(0, 3).map((x) => Math.round(x)).join(",")} | eG ${r.eG.slice(0, 5).map((x) => Math.round(x)).join(",")} ${id}`;
}

/** Sanity report: tops, winners / losers vs the season-points ranking, reference players. */
export function slapshotReport(b: SlapshotBuild): string[] {
  const out: string[] = [];
  const s = b.snapshot;
  const P = s.params;
  const all = Object.entries(b.records);
  out.push(
    `routes ${JSON.stringify(b.result.routes)}; salary model on ${b.salaryRowCount} contracts: skaters n ${P.salaryModel.skater.n} R² ${P.salaryModel.skater.r2} rmse ${P.salaryModel.skater.rmse} [${P.salaryModel.skater.beta.join(", ")}] (${P.salaryModel.skater.features.join(", ")}); goalies n ${P.salaryModel.goalie.n} R² ${P.salaryModel.goalie.r2} rmse ${P.salaryModel.goalie.rmse}`,
    `replacement season pts ${JSON.stringify(P.repl.season)} per GP ${JSON.stringify(P.repl.perGame)} G/slot ${P.repl.G}; k default ${JSON.stringify(P.kDefault)}`,
    `cap league ${P.cap.league.slice(0, 5).join(", ")} … ; min ${P.cap.min.slice(0, 3).join(", ")}; λ ${P.lambda.slice(0, 6).join(", ")} … (${P.lambdaDiag.method}); roster-spot rent ${P.rosterSpot.cost} pts/season (asset #${P.rosterSpot.rank})`,
    ...P.lambdaDiag.seasons.map(
      (d) =>
        `  ${d.season}: aggregate λ ${d.aggregate} (points-optimal counting set costs ${d.capUsedAt0} of ${d.budget} M$); snake λ mean ${d.snake.mean} (sd ${d.snake.sd} over ${d.snake.reps} draft orders) median team ${d.snake.median}, ${d.snake.over} teams over, team caps ${JSON.stringify(d.snake.teamCap)}`,
    ),
  );
  const fpRank = new Map(
    all
      .filter(([, r]) => r.fp0 != null)
      .sort((a, b2) => b2[1].fp0! - a[1].fp0!)
      .map(([id], i) => [id, i + 1]),
  );
  for (const m of ["balanced", "longTerm"] as const) {
    out.push("", `== Top 60 ${m} (rank bal/LT/WN)`);
    for (const [id, r] of [...all].sort((a, c) => a[1].rank[m] - c[1].rank[m]).slice(0, 60)) out.push(line(id, r, fpRank.get(id)));
  }
  // winners / losers: balanced DV rank vs 2026-27 season points rank (NHL-path players in either top 300)
  const cmp = all
    .filter(([id, r]) => fpRank.has(id) && (r.rank.balanced <= 300 || fpRank.get(id)! <= 300))
    .map(([id, r]) => ({ id, r, d: fpRank.get(id)! - r.rank.balanced }));
  out.push("", "== 20 biggest winners (balanced DV rank above the 2026-27 season-points rank)");
  for (const x of [...cmp].sort((a, c) => c.d - a.d).slice(0, 20)) out.push(`${lpad(`+${x.d}`, 5)} ${line(x.id, x.r, fpRank.get(x.id))}`);
  out.push("", "== 20 biggest losers");
  for (const x of [...cmp].sort((a, c) => a.d - c.d).slice(0, 20)) out.push(`${lpad(x.d, 5)} ${line(x.id, x.r, fpRank.get(x.id))}`);
  if (b.noCap) {
    // what the contracts alone move: the same build with λ = 0 (top 300 either way)
    const nc = b.noCap;
    const ncRank = new Map(
      Object.entries(nc)
        .sort((a, c) => c[1].dv.balanced - a[1].dv.balanced || a[0].localeCompare(c[0]))
        .map(([id], i) => [id, i + 1]),
    );
    const moves = all
      .filter(([id, r]) => ncRank.has(id) && (r.rank.balanced <= 300 || ncRank.get(id)! <= 300))
      .map(([id, r]) => ({ id, r, d: ncRank.get(id)! - r.rank.balanced, dv: r.dv.balanced - nc[id]!.dv.balanced }));
    out.push("", "== Contract effect: balanced rank with the cap vs the same build at λ = 0 (20 up, 20 down)");
    for (const x of [...moves].sort((a, c) => c.d - a.d || c.dv - a.dv).slice(0, 20))
      out.push(`${lpad(`+${x.d}`, 5)} ΔDV ${lpad(Math.round(x.dv), 4)} ${line(x.id, x.r, fpRank.get(x.id))}`);
    out.push("  --");
    for (const x of [...moves].sort((a, c) => a.d - c.d || a.dv - c.dv).slice(0, 20))
      out.push(`${lpad(x.d, 5)} ΔDV ${lpad(Math.round(x.dv), 4)} ${line(x.id, x.r, fpRank.get(x.id))}`);
  }
  out.push("", "== Reference players");
  for (const n of REFERENCE) for (const [id, r] of all.filter(([, x]) => x.n === n)) out.push(`${line(id, r, fpRank.get(id))}\n       ${r.explanation}`);
  const mine = b.pool.rosters[b.profile.league.userTeam] ?? [];
  out.push("", `== ${b.pool.teamNames[b.profile.league.userTeam] ?? "user team"} (${mine.length})`);
  for (const id of mine) {
    const r = b.records[id];
    out.push(r ? `${line(id, r, fpRank.get(id))}\n       ${r.explanation}` : `${id} (not modeled)`);
  }
  return out;
}

const REFERENCE = [
  "Macklin Celebrini",
  "Connor McDavid",
  "Nathan MacKinnon",
  "Leon Draisaitl",
  "Kirill Kaprizov",
  "Auston Matthews",
  "Connor Bedard",
  "Leo Carlsson",
  "Ivan Demidov",
  "Matthew Schaefer",
  "Lane Hutson",
  "Matvei Michkov",
  "Nikita Kucherov",
  "Sidney Crosby",
  "Alex Ovechkin",
  "Gavin McKenna",
  "Ivar Stenberg",
  "Porter Martone",
  "Michael Misa",
  "Igor Shesterkin",
  "Jesper Wallstedt",
  "Cale Makar",
  "Quinn Hughes",
];

/** The compact board file for the live draft page. */
export function slapshotLite(b: SlapshotBuild) {
  const s = b.snapshot;
  type LitePlayer = {
    n: string;
    dvB: number;
    dvL: number;
    dvW: number;
    rankB: number;
    rankL: number;
    phase: string;
    pos: string;
    capM: number;
    years: number;
    expiry: number | null;
    /** Cap hits 2026-27 … 2029-30 (M$; projected after the signed years). */
    c4: number[];
    /** Discounted cap burden (balanced weights, × P(in the NHL)): dvB moves by −Δλ × capPV for another λ. */
    capPV: number;
  };
  const players: Record<string, LitePlayer> = {};
  const w = s.params.modes.balanced;
  const minM = s.params.cap.min;
  for (const [id, r] of Object.entries(s.players)) {
    const pIn = b.result.internals.get(id)?.value?.pInNhl ?? [];
    const pv = r.contract.cap.reduce(
      (acc, c, t) => acc + (t === 0 ? w.w0 : t === 1 ? (w.w1 ?? 1) : 1) * Math.pow(w.delta, t) * Math.max(0, c - minM[t]!) * (pIn[t] ?? 0),
      0,
    );
    players[id] = {
      n: r.n,
      dvB: r.dv.balanced,
      dvL: r.dv.longTerm,
      dvW: r.dv.winNow,
      rankB: r.rank.balanced,
      rankL: r.rank.longTerm,
      phase: r.phase,
      pos: r.pos.join(","),
      capM: r.contract.cap[0]!,
      years: r.contract.signed,
      expiry: r.contract.expiry,
      c4: r.contract.cap.slice(0, 4),
      capPV: Math.round(pv * 10) / 10,
    };
  }
  return {
    builtAt: new Date().toISOString(),
    params: {
      source: "public/fantrax/slapshot/dynasty.json (scripts/dynasty-slapshot.ts)",
      unit: "dynasty points = expected discounted Slapshot fantasy points above replacement, net of the cap charge (12 seasons)",
      modes: s.params.modes,
      lambda: s.params.lambda.slice(0, 4),
      lambdaMethod: s.params.lambdaDiag.method,
      rosterSpot: s.params.rosterSpot.cost,
      capLeague: s.params.cap.league.slice(0, 4),
      repl: s.params.repl,
      fantasyShare: s.params.fantasyShare,
      years: "signed seasons from 2026-27 (0 = no contract for 2026-27); expiry = first season without a signed contract",
    },
    players,
  };
}
