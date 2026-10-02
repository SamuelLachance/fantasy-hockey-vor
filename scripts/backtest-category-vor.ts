/**
 * Backtest of the category-league VOR engine (`src/lib/leagues/category-vor.ts`)
 * on real NHL weeks — OFF CI: it needs the NHL stats REST cache (season totals
 * and Monday-Sunday weekly aggregates, a few hundred MB), which is not
 * committed. Every choice that moves the goalie / skater exchange rate (the
 * over-dispersion φ, the SV% shrink, the leverage spread, a pinned weight,
 * bench goalies, the soft cap) is a method here; change one only with this
 * backtest run before and after.
 *
 *   npx tsx scripts/backtest-category-vor.ts --cache <dir> [--fetch] [--sv-f 0.3]
 *       [--seasons 20212022,...] [--draft-fields E_old,E_new,LAG1] [--fixture]
 *
 * --cache    directory of cached responses (or env CATEGORY_BACKTEST_CACHE)
 * --fetch    download what is missing from api.nhle.com/stats/rest, public and
 *            unauthenticated, >= 1.2 s apart, descriptive User-Agent
 * --fixture  also write scripts/fixtures/category-weekly-totals.json, the
 *            weekly team totals `scripts/test-category-vor.ts` re-measures φ on
 *
 * How it measures (the design of the 2026-10 audit, reproduced to the digit):
 * - Projections are a Marcel proxy (3 seasons weighted 5/4/3, regressed to
 *   the position mean, mild age curve), the SAME for every method, so only
 *   the valuation differs.
 * - Realized value: 12 teams snake-built from the season's realized starters;
 *   a player's value is the category points (win 1, tie 0.5) his weekly lines
 *   earn when he replaces his team's weakest starter of his kind, over every
 *   team, opponent and week, minus the replacement level of his group.
 *   Goalie appearances are topped up to the league's weekly minimum with a
 *   streamer (the per-game line of that week's undrafted goalies), which the
 *   audit's simulation did not do: without it a team's goalies play ~3.4
 *   games a week instead of >= 4 and the realized goalie leverage is ~8 %
 *   high.
 * - Ranking metrics per method: Spearman with realized VOR (all, goalies),
 *   capture of the oracle's top 72 / 144, precision of the top 216, goalie /
 *   skater pair concordance among the realized top 150, goalies in the top 72.
 * - Simulated draft: one team drafts by the method while the 11 others draft
 *   by a FIELD method (18-round snake, slot-feasible); the season is replayed
 *   on the real weeks. Paired difference in category points per week vs the
 *   field's own score, over 5 seasons x 12 draft slots. Run it in several
 *   fields: an edge that only exists against one field is not an edge.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { applyCategoryVor, type CategoryVorOptions, type CategoryVorResult, type LeaguePoolPlayer } from "../src/lib/leagues/category-vor";
import { parseLeagueProfile } from "../src/lib/leagues/profile";
import type { CategoryLeagueProfile } from "../src/lib/leagues/types";

// ---------------------------------------------------------------- args
const args = process.argv.slice(2);
const arg = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const RAW = arg("--cache") ?? process.env.CATEGORY_BACKTEST_CACHE;
/**
 * --sv-f f: the proxy's goalie SV% = league + f x (its Marcel SV% - league).
 * 1 (default) keeps the Marcel proxy (1500 shots of regression, close to the
 * raw three-season record); ~0.3 matches the production board, whose save%
 * is shrunk toward the league out of sample (spread 0.0022 on 2026-27).
 */
const SV_F = Number(arg("--sv-f") ?? 1);
const ROOT = process.cwd();

// ---------------------------------------------------------------- fetch
const UA = "fantasy-hockey-vor-backtest/1.0 (read-only research, personal fantasy hockey project)";
const STATS = "https://api.nhle.com/stats/rest/en";
const WEEK_SEASONS: Record<number, [string, string]> = {
  20212022: ["2021-10-11", "2022-05-01"],
  20222023: ["2022-10-03", "2023-04-16"],
  20232024: ["2023-10-09", "2024-04-21"],
  20242025: ["2024-09-30", "2025-04-20"],
  20252026: ["2025-10-06", "2026-04-19"],
};
let lastFetch = 0;
async function getJson(url: string): Promise<unknown> {
  for (let i = 0; i < 4; i++) {
    const wait = Math.max(0, lastFetch + 1200 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastFetch = Date.now();
    try {
      const r = await fetch(url, { headers: { "user-agent": UA } });
      if (r.ok) return await r.json();
      console.error("HTTP", r.status, url);
    } catch (e) {
      console.error("ERR", e instanceof Error ? e.message : String(e), url);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}
async function fetchMissing(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const cached = async (name: string, url: string) => {
    const f = join(dir, name);
    if (existsSync(f)) return;
    const j = await getJson(url);
    if (j) writeFileSync(f, JSON.stringify(j));
  };
  const enc = encodeURIComponent;
  for (let y = 2017; y <= 2025; y++) {
    const sid = `${y}${y + 1}`;
    for (const [kind, rep] of [["skater", "realtime"], ["skater", "summary"], ["goalie", "summary"], ["skater", "bios"], ["goalie", "bios"]] as const) {
      await cached(`${kind}_${rep}_${sid}.json`, `${STATS}/${kind}/${rep}?isAggregate=false&isGame=false&limit=-1&start=0&cayenneExp=${enc(`gameTypeId=2 and seasonId=${sid}`)}`);
    }
  }
  for (const [sid, [start, end]] of Object.entries(WEEK_SEASONS)) {
    for (let d = Date.parse(`${start}T12:00:00Z`); d <= Date.parse(`${end}T12:00:00Z`); d += 7 * 86_400_000) {
      const a = new Date(d).toISOString().slice(0, 10);
      const b = new Date(d + 6 * 86_400_000).toISOString().slice(0, 10);
      const exp = `gameTypeId=2 and gameDate>="${a}" and gameDate<="${b}"`;
      for (const [kind, rep] of [["skater", "summary"], ["skater", "realtime"], ["goalie", "summary"]] as const) {
        await cached(`wk_${sid}_${a}_${kind}_${rep}.json`, `${STATS}/${kind}/${rep}?isAggregate=true&isGame=true&limit=-1&start=0&cayenneExp=${enc(exp)}`);
      }
    }
  }
}

// ---------------------------------------------------------------- data
type Row = Record<string, number | string | null | undefined>;
function readRows(...names: string[]): Row[] | null {
  for (const n of names) {
    const f = join(RAW!, n);
    if (!existsSync(f)) continue;
    const j = JSON.parse(readFileSync(f, "utf8")) as { data?: Row[] };
    if (j.data) return j.data;
  }
  return null;
}
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const SEASON_GAMES: Record<number, number> = { 20122013: 48, 20192020: 70, 20202021: 56 };
const sched = (sid: number) => SEASON_GAMES[sid] ?? 82;
export const prevSid = (sid: number, k = 1) => {
  const y = Math.floor(sid / 10000) - k;
  return Number(`${y}${y + 1}`);
};

interface SkLine { id: number; name: string; pos: "C" | "LW" | "RW" | "D"; gp: number; goals: number; assists: number; powerplayPoints: number; shots: number; hits: number; blocks: number; team: string }
interface GLine { id: number; name: string; gp: number; wins: number; shutouts: number; saves: number; shots: number; ga: number; team: string }
interface Season { sid: number; sk: Map<number, SkLine>; g: Map<number, GLine> }
const POS: Record<string, SkLine["pos"]> = { C: "C", L: "LW", R: "RW", D: "D" };
const SK_CATS = ["goals", "assists", "powerplayPoints", "shots", "hits", "blocks"] as const;
type SkCat = (typeof SK_CATS)[number];

const seasonCache = new Map<number, Season>();
function loadSeason(sid: number): Season {
  const hit = seasonCache.get(sid);
  if (hit) return hit;
  const sum = readRows(`skater_summary_${sid}.json`, `nhlstats-skater-summary-${sid}-season.json`);
  const rt = readRows(`skater_realtime_${sid}.json`, `nhlstats-skater-realtime-${sid}-season.json`);
  const gs = readRows(`goalie_summary_${sid}.json`, `nhlstats-goalie-summary-${sid}-season.json`);
  if (!sum || !rt || !gs) throw new Error(`missing season ${sid} in ${RAW}`);
  const rtBy = new Map<number, { hits: number; blocks: number }>();
  for (const r of rt) {
    const id = num(r.playerId);
    const prev = rtBy.get(id) ?? { hits: 0, blocks: 0 };
    prev.hits += num(r.hits);
    prev.blocks += num(r.blockedShots);
    rtBy.set(id, prev);
  }
  const sk = new Map<number, SkLine>();
  for (const r of sum) {
    const id = num(r.playerId);
    const t = rtBy.get(id) ?? { hits: 0, blocks: 0 };
    const line = sk.get(id) ?? { id, name: String(r.skaterFullName), pos: POS[String(r.positionCode)] ?? "C", gp: 0, goals: 0, assists: 0, powerplayPoints: 0, shots: 0, hits: t.hits, blocks: t.blocks, team: String(r.teamAbbrevs ?? "") };
    line.gp += num(r.gamesPlayed);
    line.goals += num(r.goals);
    line.assists += num(r.assists);
    line.powerplayPoints += num(r.ppPoints);
    line.shots += num(r.shots);
    sk.set(id, line);
  }
  const g = new Map<number, GLine>();
  for (const r of gs) {
    const id = num(r.playerId);
    const line = g.get(id) ?? { id, name: String(r.goalieFullName), gp: 0, wins: 0, shutouts: 0, saves: 0, shots: 0, ga: 0, team: String(r.teamAbbrevs ?? "") };
    line.gp += num(r.gamesPlayed);
    line.wins += num(r.wins);
    line.shutouts += num(r.shutouts);
    line.saves += num(r.saves);
    line.shots += num(r.shotsAgainst);
    line.ga += num(r.goalsAgainst);
    g.set(id, line);
  }
  const s = { sid, sk, g };
  seasonCache.set(sid, s);
  return s;
}

const births = new Map<number, string>();
function ageAt(id: number, sid: number): number | null {
  if (births.size === 0) {
    for (let y = 2007; y <= 2025; y++) {
      const s = `${y}${y + 1}`;
      for (const n of [`skater_bios_${s}.json`, `goalie_bios_${s}.json`, `nhlstats-skater-bios-${s}-season.json`]) {
        for (const r of readRows(n) ?? []) if (r.birthDate) births.set(num(r.playerId), String(r.birthDate));
      }
    }
  }
  const b = births.get(id);
  if (!b) return null;
  return (Date.UTC(Math.floor(sid / 10000), 9, 1) - Date.parse(b)) / (365.25 * 86_400_000);
}

type Proj = Record<string, number>;
const pool = (p: Omit<LeaguePoolPlayer, "projection"> & { projection: Proj }) => p as unknown as LeaguePoolPlayer;

/** Realized season pool in the engine's shape (actual totals). */
function realizedPool(sid: number): LeaguePoolPlayer[] {
  const s = loadSeason(sid);
  const out: LeaguePoolPlayer[] = [];
  for (const l of s.sk.values()) {
    if (l.gp < 1) continue;
    out.push(pool({ id: l.id, name: l.name, team: l.team, position: l.pos, primaryPosition: l.pos, positions: [l.pos], isGoalie: false, gamesPlayed: l.gp, projection: { goals: l.goals, assists: l.assists, powerplayPoints: l.powerplayPoints, shots: l.shots, hits: l.hits, blocks: l.blocks, penaltyMinutes: 0, faceoffWins: 0 } }));
  }
  for (const l of s.g.values()) {
    if (l.gp < 1 || l.shots <= 0) continue;
    out.push(pool({ id: l.id, name: l.name, team: l.team, position: "G", primaryPosition: "G", positions: ["G"], isGoalie: true, gamesPlayed: l.gp, projection: { wins: l.wins, shutouts: l.shutouts, saves: l.saves, savePct: l.saves / l.shots } }));
  }
  return out;
}

/** Marcel-style projection for `sid` from the three seasons before it. */
function marcelPool(sid: number): LeaguePoolPlayer[] {
  const hist = [1, 2, 3].map((k) => {
    try {
      return loadSeason(prevSid(sid, k));
    } catch {
      return null;
    }
  });
  const s1 = hist[0]!;
  const W = [5, 4, 3];
  const lg: Record<"F" | "D", Record<SkCat, number>> = { F: {} as Record<SkCat, number>, D: {} as Record<SkCat, number> };
  for (const grp of ["F", "D"] as const) {
    const tot: Record<string, number> = { gp: 0 };
    for (const l of s1.sk.values()) {
      if (l.gp < 20 || (grp === "D") !== (l.pos === "D")) continue;
      tot.gp! += l.gp;
      for (const c of SK_CATS) tot[c] = (tot[c] ?? 0) + l[c];
    }
    for (const c of SK_CATS) lg[grp][c] = tot[c]! / tot.gp!;
  }
  const R: Record<SkCat, number> = { goals: 30, assists: 30, powerplayPoints: 30, shots: 15, hits: 10, blocks: 10 };
  const ids = new Set<number>();
  for (const h of hist) if (h) for (const id of [...h.sk.keys(), ...h.g.keys()]) ids.add(id);
  const gpProj = (gps: Array<number | null>) => {
    const w = [0.5, 0.2, 0.1];
    let n = 0;
    let d = 0;
    gps.forEach((g, i) => {
      if (g != null) {
        n += w[i]! * g;
        d += w[i]!;
      }
    });
    return d === 0 ? 0 : Math.min(82, (n / d) * 0.8 + 0.2 * 72);
  };
  let lgSv = 0, lgSh = 0, lgW = 0, lgSO = 0, lgGp = 0;
  for (const l of s1.g.values()) {
    lgSv += l.saves; lgSh += l.shots; lgW += l.wins; lgSO += l.shutouts; lgGp += l.gp;
  }
  const lgSvPct = lgSv / lgSh, lgShotsPg = lgSh / lgGp, lgWinPg = lgW / lgGp, lgSoPg = lgSO / lgGp;
  const out: LeaguePoolPlayer[] = [];
  for (const id of ids) {
    if (hist.some((h) => h?.g.has(id))) {
      const lines = hist.map((h) => h?.g.get(id) ?? null);
      if (!lines[0] && !lines[1]) continue;
      const n = { w: 0, so: 0, sv: 0, sh: 0, gp: 0 };
      lines.forEach((l, i) => {
        if (l) { n.w += W[i]! * l.wins; n.so += W[i]! * l.shutouts; n.sv += W[i]! * l.saves; n.sh += W[i]! * l.shots; n.gp += W[i]! * l.gp; }
      });
      const gp = gpProj(lines.map((l, i) => (l ? (l.gp * 82) / sched(prevSid(sid, i + 1)) : hist[i] ? 0 : null)));
      if (gp < 5) continue;
      const svPct = lgSvPct + SV_F * ((n.sv + 1500 * lgSvPct) / (n.sh + 1500) - lgSvPct);
      const shotsPg = (n.sh + 10 * lgShotsPg) / (n.gp + 10);
      const any = lines.find(Boolean)!;
      out.push(pool({ id, name: any.name, team: any.team, position: "G", primaryPosition: "G", positions: ["G"], isGoalie: true, gamesPlayed: gp, projection: { wins: ((n.w + 15 * lgWinPg) / (n.gp + 15)) * gp, shutouts: ((n.so + 20 * lgSoPg) / (n.gp + 20)) * gp, saves: shotsPg * gp * svPct, savePct: svPct } }));
      continue;
    }
    const lines = hist.map((h) => h?.sk.get(id) ?? null);
    if (!lines[0] && !lines[1]) continue;
    const any = lines.find(Boolean)!;
    const grp = any.pos === "D" ? "D" : "F";
    const gp = gpProj(lines.map((l, i) => (l ? (l.gp * 82) / sched(prevSid(sid, i + 1)) : hist[i] ? 0 : null)));
    if (gp < 5) continue;
    const age = ageAt(id, sid) ?? 27;
    const ageF = Math.max(0.85, Math.min(1.1, 1 + 0.015 * (26 - age)));
    const proj: Proj = { penaltyMinutes: 0, faceoffWins: 0 };
    for (const c of SK_CATS) {
      let n = 0, d = 0;
      lines.forEach((l, i) => {
        if (l) { n += W[i]! * l[c]; d += W[i]! * l.gp; }
      });
      let rate = (n + R[c] * lg[grp][c]) / (d + R[c]);
      if (c === "goals" || c === "assists" || c === "powerplayPoints" || c === "shots") rate *= ageF;
      proj[c] = rate * gp;
    }
    out.push(pool({ id, name: any.name, team: any.team, position: any.pos, primaryPosition: any.pos, positions: [any.pos], isGoalie: false, gamesPlayed: gp, projection: proj }));
  }
  return out;
}

interface GWeek { gp: number; wins: number; shutouts: number; saves: number; shots: number; ga: number; toi: number }
interface WeekData { start: string; sk: Map<number, Record<string, number>>; g: Map<number, GWeek> }
function loadWeeks(sid: number): WeekData[] {
  const starts = new Set<string>();
  const re = new RegExp(`^wk_${sid}_(\\d{4}-\\d{2}-\\d{2})_goalie_summary\\.json$`);
  for (const f of readdirSync(RAW!)) {
    const m = re.exec(f);
    if (m) starts.add(m[1]!);
  }
  const out: WeekData[] = [];
  for (const a of [...starts].sort()) {
    const sum = readRows(`wk_${sid}_${a}_skater_summary.json`);
    const rt = readRows(`wk_${sid}_${a}_skater_realtime.json`);
    const gs = readRows(`wk_${sid}_${a}_goalie_summary.json`);
    if (!sum || !rt || !gs || gs.length === 0) continue;
    const sk = new Map<number, Record<string, number>>();
    for (const r of sum) sk.set(num(r.playerId), { gp: num(r.gamesPlayed), goals: num(r.goals), assists: num(r.assists), powerplayPoints: num(r.ppPoints), shots: num(r.shots), hits: 0, blocks: 0 });
    for (const r of rt) {
      const x = sk.get(num(r.playerId));
      if (x) { x.hits = num(r.hits); x.blocks = num(r.blockedShots); }
    }
    const g = new Map<number, GWeek>();
    for (const r of gs) g.set(num(r.playerId), { gp: num(r.gamesPlayed), wins: num(r.wins), shutouts: num(r.shutouts), saves: num(r.saves), shots: num(r.shotsAgainst), ga: num(r.goalsAgainst), toi: num(r.timeOnIce) });
    // Holiday / opening stubs with almost no games are dropped.
    if (g.size > 20) out.push({ start: a, sk, g });
  }
  return out;
}

// ---------------------------------------------------------------- stats
function ranks(v: number[]): number[] {
  const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(v.length).fill(0);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    for (let k = i; k <= j; k++) r[idx[k]![1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
function pearson(x: number[], y: number[]): number {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i]! - mx) * (y[i]! - my); sxx += (x[i]! - mx) ** 2; syy += (y[i]! - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}
const spearman = (x: number[], y: number[]) => pearson(ranks(x), ranks(y));
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length);
const sdev = (x: number[]) => {
  const m = mean(x);
  return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, x.length - 1));
};

// ---------------------------------------------------------------- weekly H2H
const SKC = ["goals", "assists", "powerplayPoints", "shots", "hits", "blocks"] as const;
interface Tot { sk: number[]; skgp: number; gp: number; w: number; so: number; sv: number; sh: number; ga: number; toi: number }
const zero = (): Tot => ({ sk: [0, 0, 0, 0, 0, 0], skgp: 0, gp: 0, w: 0, so: 0, sv: 0, sh: 0, ga: 0, toi: 0 });
const clone = (t: Tot): Tot => ({ ...t, sk: t.sk.slice() });
function addSk(t: Tot, x: Record<string, number> | undefined, sign = 1) {
  if (!x) return;
  for (let i = 0; i < 6; i++) t.sk[i]! += sign * (x[SKC[i]!] ?? 0);
  t.skgp += sign * (x.gp ?? 0);
}
function addG(t: Tot, x: GWeek | undefined, sign = 1) {
  if (!x) return;
  t.w += sign * x.wins; t.so += sign * x.shutouts; t.sv += sign * x.saves; t.sh += sign * x.shots; t.ga += sign * x.ga; t.toi += sign * x.toi; t.gp += sign * x.gp;
}
/** Tops a team's goalie appearances up to the weekly minimum with the week's streamer line. */
function withStreamer(t: Tot, streamer: GWeek | null, min: number): Tot {
  if (!streamer || t.gp >= min) return t;
  const k = min - t.gp;
  const out = clone(t);
  out.w += k * streamer.wins; out.so += k * streamer.shutouts; out.sv += k * streamer.saves; out.sh += k * streamer.shots; out.ga += k * streamer.ga; out.toi += k * streamer.toi; out.gp += k;
  return out;
}
const cmp = (a: number, b: number) => (a > b ? 1 : a === b ? 0.5 : 0);
function catPoints(a: Tot, b: Tot): { sk: number; g: number } {
  let sk = 0;
  for (let i = 0; i < 6; i++) sk += cmp(a.sk[i]!, b.sk[i]!);
  let g = cmp(a.w, b.w) + cmp(a.so, b.so);
  const aOk = a.sh > 0 && a.toi > 0, bOk = b.sh > 0 && b.toi > 0;
  if (aOk && bOk) g += cmp(a.sv / a.sh, b.sv / b.sh) + cmp(b.ga / b.toi, a.ga / a.toi);
  else if (aOk) g += 2;
  else if (!bOk) g += 1;
  return { sk, g };
}

/** Per-appearance line of the week's goalies nobody rosters (the streamer). */
function streamerLine(w: WeekData, rostered: Set<number>): GWeek | null {
  const s: GWeek = { gp: 0, wins: 0, shutouts: 0, saves: 0, shots: 0, ga: 0, toi: 0 };
  for (const [id, x] of w.g) {
    if (rostered.has(id) || !(x.gp > 0)) continue;
    s.gp += x.gp; s.wins += x.wins; s.shutouts += x.shutouts; s.saves += x.saves; s.shots += x.shots; s.ga += x.ga; s.toi += x.toi;
  }
  if (!(s.gp > 0)) return null;
  return { gp: 1, wins: s.wins / s.gp, shutouts: s.shutouts / s.gp, saves: s.saves / s.gp, shots: s.shots / s.gp, ga: s.ga / s.gp, toi: s.toi / s.gp };
}

interface SimResult {
  h2h: Map<number, number>;
  real: CategoryVorResult;
  teams: Array<{ skaters: number[]; goalies: number[] }>;
  weeks: WeekData[];
  /** Weekly team totals for the φ fixture: [week][team] per series. */
  series: Record<string, number[][]>;
}

function simulate(sid: number, profile: CategoryLeagueProfile, streaming: boolean): SimResult {
  const real = applyCategoryVor(profile, realizedPool(sid), { goalieWeight: 1, softCap: false, savePctSkillSd: null });
  const weeks = loadWeeks(sid);
  const T = profile.teams;
  const min = streaming ? profile.minGoalieAppearancesPerWeek : 0;
  const bySlot = new Map<string, typeof real.players>();
  for (const p of real.players) {
    if (!p.modelSlot || p.modelSlot === "BN") continue;
    bySlot.set(p.modelSlot, [...(bySlot.get(p.modelSlot) ?? []), p]);
  }
  const teams = Array.from({ length: T }, () => ({ skaters: [] as number[], goalies: [] as number[] }));
  const valueOf = new Map(real.players.map((p) => [p.id, p.value]));
  for (const [slot, list] of bySlot) {
    list.sort((a, b) => b.value - a.value);
    list.forEach((p, i) => {
      const k = i % T;
      const t = Math.floor(i / T) % 2 === 0 ? k : T - 1 - k;
      (slot === "G" ? teams[t]!.goalies : teams[t]!.skaters).push(p.id);
    });
  }
  const rostered = new Set(real.draftedIds);
  const streamers = weeks.map((w) => streamerLine(w, rostered));
  const raw: Tot[][] = weeks.map((w) =>
    teams.map((tm) => {
      const t = zero();
      for (const id of tm.skaters) addSk(t, w.sk.get(id));
      for (const id of tm.goalies) addG(t, w.g.get(id));
      return t;
    }),
  );
  const fin: Tot[][] = raw.map((row, wi) => row.map((t) => withStreamer(t, streamers[wi]!, min)));
  const weakest = (ids: number[]) => ids.slice().sort((a, b) => valueOf.get(a)! - valueOf.get(b)!)[0]!;
  const weakSk = teams.map((tm) => weakest(tm.skaters));
  const weakG = teams.map((tm) => weakest(tm.goalies));
  const h2h = new Map<number, number>();
  const pseudo = [{ id: -1, isGoalie: false }, { id: -2, isGoalie: true }];
  for (const p of [...real.players, ...pseudo]) {
    let pts = 0;
    weeks.forEach((w, wi) => {
      for (let t = 0; t < T; t++) {
        const cand = clone(raw[wi]![t]!);
        if (p.isGoalie) {
          addG(cand, w.g.get(weakG[t]!), -1);
          addG(cand, w.g.get(p.id));
        } else {
          addSk(cand, w.sk.get(weakSk[t]!), -1);
          addSk(cand, w.sk.get(p.id));
        }
        const c = withStreamer(cand, streamers[wi]!, min);
        for (let o = 0; o < T; o++) {
          if (o === t) continue;
          const x = catPoints(c, fin[wi]![o]!);
          pts += p.isGoalie ? x.g : x.sk;
        }
      }
    });
    h2h.set(p.id, pts / (T * (T - 1)));
  }
  const series: Record<string, number[][]> = {};
  for (const k of [...SKC, "wins", "shutouts", "goalieGp", "skaterGp"]) series[k] = raw.map(() => new Array<number>(T).fill(0));
  raw.forEach((row, wi) =>
    row.forEach((t, ti) => {
      SKC.forEach((c, i) => (series[c]![wi]![ti] = t.sk[i]!));
      series.wins![wi]![ti] = t.w;
      series.shutouts![wi]![ti] = t.so;
      series.goalieGp![wi]![ti] = t.gp;
      series.skaterGp![wi]![ti] = t.skgp;
    }),
  );
  return { h2h, real, teams, weeks, series };
}

// ---------------------------------------------------------------- simulated draft
const SLOTS: Array<[string[], number]> = [[["C"], 2], [["LW"], 2], [["RW"], 2], [["C", "LW", "RW"], 1], [["D"], 4], [["C", "LW", "RW", "D"], 1], [["G"], 2]];
const BENCH = 4, MAX_G = 3, ROUNDS = 18;
interface DP { id: number; pos: string; isG: boolean }
function openSlots(roster: DP[]) {
  const open = SLOTS.map(([acc, n]) => ({ acc, n }));
  for (const q of roster) {
    const s = open.find((o) => o.n > 0 && o.acc.includes(q.pos));
    if (s) s.n--;
  }
  return open;
}
function canStart(roster: DP[], p: DP): boolean {
  return openSlots(roster).some((o) => o.n > 0 && o.acc.includes(p.pos));
}
function wouldBlockStarters(roster: DP[], p: DP): boolean {
  void p;
  const openStarters = openSlots(roster).reduce((s, o) => s + o.n, 0);
  return openStarters > ROUNDS - roster.length - 1;
}
function runDraft(orders: number[][], players: Map<number, DP>, T: number): DP[][] {
  const rosters: DP[][] = Array.from({ length: T }, () => []);
  const taken = new Set<number>();
  for (let r = 0; r < ROUNDS; r++) {
    for (let k = 0; k < T; k++) {
      const t = r % 2 === 0 ? k : T - 1 - k;
      const roster = rosters[t]!;
      const nG = roster.filter((p) => p.isG).length;
      for (const id of orders[t]!) {
        if (taken.has(id)) continue;
        const p = players.get(id)!;
        if (p.isG && nG >= MAX_G) continue;
        if (canStart(roster, p) || (roster.length < 14 + BENCH && !wouldBlockStarters(roster, p))) {
          taken.add(id);
          roster.push(p);
          break;
        }
      }
    }
  }
  return rosters;
}
function weekTotals(roster: DP[], w: WeekData): Tot {
  const t = zero();
  const open = SLOTS.map(([acc, n]) => ({ acc, n }));
  for (const q of roster) {
    const line = q.isG ? w.g.get(q.id) : w.sk.get(q.id);
    if (!line || !(line.gp > 0)) continue;
    const s = open.find((o) => o.n > 0 && o.acc.includes(q.pos));
    if (!s) continue;
    s.n--;
    if (q.isG) addG(t, line as GWeek);
    else addSk(t, line as Record<string, number>);
  }
  return t;
}

// ---------------------------------------------------------------- methods
type Method = { name: string; opts?: CategoryVorOptions; lag?: true; value?: true };
// The engine as it was before the 2026-10 fixes: Poisson noise, the goalie
// leverage read off the SHRUNK SV% spread, no calibration.
const OLD: CategoryVorOptions = { overdispersion: {}, goalieLeverageOnShrunk: true, goalieWeightCalibration: 1 };
const PHI_WINS_RANDOM = { goals: 1.03, assists: 1.05, powerplayPoints: 1.01, shots: 1.35, hits: 1.37, blocks: 1.23, wins: 1.25, shutouts: 0.98 };
const METHODS: Method[] = [
  { name: "E_old", opts: OLD },
  { name: "E_new", opts: {} },
  { name: "E_uncal", opts: { goalieWeightCalibration: 1 } },
  { name: "E_phi_uncal", opts: { goalieLeverageOnShrunk: true, goalieWeightCalibration: 1 } },
  { name: "E_raw_uncal", opts: { overdispersion: {}, goalieWeightCalibration: 1 } },
  { name: "E_new_w125", opts: { overdispersion: PHI_WINS_RANDOM } },
  { name: "E_new_sv23", opts: { savePctSkillSd: 0.0023 } },
  { name: "E_new_noShrink", opts: { savePctSkillSd: null } },
  { name: "E_new_noCap", opts: { softCap: false } },
  { name: "E_w0.6", opts: { goalieWeight: 0.6 } },
  { name: "E_w0.8", opts: { goalieWeight: 0.8 } },
  { name: "E_w1.0", opts: { goalieWeight: 1.0 } },
  { name: "E_new_bench0", opts: { benchGoaliesPerTeam: 0 } },
  { name: "E_new_bench2", opts: { benchGoaliesPerTeam: 2 } },
  { name: "LAG1", lag: true },
];

// ---------------------------------------------------------------- main
async function main() {
  if (!RAW) {
    console.error("FAIL: backtest-category-vor needs --cache <dir> (or CATEGORY_BACKTEST_CACHE); add --fetch to fill it");
    process.exit(1);
  }
  if (args.includes("--fetch")) await fetchMissing(RAW);
  const profile = parseLeagueProfile(JSON.parse(readFileSync(join(ROOT, "src/data/leagues/light-the-lamp.json"), "utf8")));
  const data = JSON.parse(readFileSync(join(ROOT, "src/data/players.json"), "utf8")) as { categoryWeights?: Record<string, Record<string, { r2: number }>> };
  const r2: Record<string, number | null> = {};
  for (const g of Object.values(data.categoryWeights ?? {})) for (const [c, m] of Object.entries(g ?? {})) r2[c] = m.r2;
  const seasons = (arg("--seasons") ?? Object.keys(WEEK_SEASONS).join(",")).split(",").map(Number);
  const fields = (arg("--draft-fields") ?? "E_old,E_new,LAG1").split(",").filter(Boolean);
  const streaming = !args.includes("--no-streaming");
  // --weights 0.5,0.7: extra methods with the goalie weight pinned.
  for (const w of (arg("--weights") ?? "").split(",").filter(Boolean).map(Number)) {
    if (!METHODS.some((m) => m.name === `E_w${w}`)) METHODS.push({ name: `E_w${w}`, opts: { goalieWeight: w } });
  }
  // --methods E_old,E_new: run only these (fields are always kept).
  const only = arg("--methods")?.split(",");
  if (only) {
    const keep = new Set([...only, ...(arg("--draft-fields") ?? "E_old,E_new,LAG1").split(",")]);
    for (let i = METHODS.length - 1; i >= 0; i--) if (!keep.has(METHODS[i]!.name) && !METHODS[i]!.name.startsWith("E_w")) METHODS.splice(i, 1);
  }
  const T = profile.teams;

  const table: Record<string, Record<string, number[]>> = {};
  const add = (m: string, k: string, v: number) => ((table[m] ??= {})[k] ??= []).push(v);
  const draftRes: Record<string, Record<string, number[]>> = {};
  const fixture: Record<string, Record<string, number[][]>> = {};
  for (const sid of seasons) {
    const sim = simulate(sid, profile, streaming);
    fixture[sid] = sim.series;
    const real = sim.real;
    const drafted = new Set(real.draftedIds);
    const grpOf = (p: { isGoalie: boolean; positions: readonly string[] }) => (p.isGoalie ? "G" : p.positions.includes("D") ? "D" : "F");
    const repl: Record<string, number> = {};
    for (const g of ["F", "D", "G"]) {
      const und = real.players.filter((p) => grpOf(p) === g && !drafted.has(p.id)).map((p) => sim.h2h.get(p.id)!).sort((a, b) => b - a);
      repl[g] = mean(und.slice(0, 3));
    }
    const proj = marcelPool(sid);
    const projById = new Map(proj.map((p) => [p.id, p]));
    const realVor = new Map<number, number>();
    for (const p of proj) realVor.set(p.id, (sim.h2h.get(p.id) ?? sim.h2h.get(p.isGoalie ? -2 : -1)!) - repl[grpOf(p)]!);
    const E = proj.filter((p) => p.gamesPlayed >= 20).map((p) => p.id);
    const oracle = [...E].sort((a, b) => realVor.get(b)! - realVor.get(a)!);
    const top150 = new Set(oracle.slice(0, 150));
    const lagRes = applyCategoryVor(profile, realizedPool(prevSid(sid)), { r2, savePctSkillSd: null });
    const lagVor = new Map(lagRes.players.map((p) => [p.id, p.vor]));
    const scores: Record<string, Map<number, number>> = {};
    const weights: Record<string, number> = {};
    for (const m of METHODS) {
      if (m.lag) {
        scores[m.name] = new Map(E.map((id) => [id, lagVor.get(id) ?? -999]));
        continue;
      }
      const res = applyCategoryVor(profile, proj, { r2, ...m.opts });
      weights[m.name] = res.goalieWeight.weight;
      scores[m.name] = new Map(res.players.map((p) => [p.id, p.vor]));
    }
    console.log(`\n=== ${sid}: ${E.length} projected regulars, ${sim.weeks.length} weeks; derived weights ${Object.entries(weights).filter(([k]) => !k.startsWith("E_w")).map(([k, w]) => `${k} ${w.toFixed(3)}`).join(", ")}`);
    for (const m of METHODS) {
      const sc = scores[m.name]!;
      const ids = E.filter((id) => sc.has(id));
      const order = [...ids].sort((a, b) => sc.get(b)! - sc.get(a)!);
      const capt = (n: number) => order.slice(0, n).reduce((s, id) => s + realVor.get(id)!, 0) / oracle.slice(0, n).reduce((s, id) => s + realVor.get(id)!, 0);
      const gs = ids.filter((id) => projById.get(id)!.isGoalie);
      const top216 = new Set(oracle.slice(0, 216));
      // goalie / skater pair concordance among the realized top 150
      let agree = 0, pairs = 0;
      const gTop = [...top150].filter((id) => projById.get(id)!.isGoalie && sc.has(id));
      const sTop = [...top150].filter((id) => !projById.get(id)!.isGoalie && sc.has(id));
      for (const g of gTop) for (const s of sTop) {
        const dm = sc.get(g)! - sc.get(s)!, dr = realVor.get(g)! - realVor.get(s)!;
        agree += dm === 0 || dr === 0 ? 0.5 : Math.sign(dm) === Math.sign(dr) ? 1 : 0;
        pairs++;
      }
      // Goalie bias: realized VOR of the method's top-216 goalies against what
      // the skaters' own score -> realized slope (method top 300) predicts.
      const top300 = order.slice(0, 300);
      const skTop = top300.filter((id) => !projById.get(id)!.isGoalie);
      const xs = skTop.map((id) => sc.get(id)!), ys = skTop.map((id) => realVor.get(id)!);
      const mxs = mean(xs), mys = mean(ys);
      const slope = xs.reduce((a, x, i) => a + (x - mxs) * (ys[i]! - mys), 0) / xs.reduce((a, x) => a + (x - mxs) ** 2, 0);
      const gTop216 = order.slice(0, 216).filter((id) => projById.get(id)!.isGoalie);
      const biasG216 = mean(gTop216.map((id) => realVor.get(id)! - (mys + slope * (sc.get(id)! - mxs))));
      const row = {
        rho: spearman(ids.map((id) => sc.get(id)!), ids.map((id) => realVor.get(id)!)),
        rhoG: spearman(gs.map((id) => sc.get(id)!), gs.map((id) => realVor.get(id)!)),
        cap72: capt(72),
        cap144: capt(144),
        prec216: order.slice(0, 216).filter((id) => top216.has(id)).length / 216,
        concGS: pairs ? agree / pairs : NaN,
        gTop72: order.slice(0, 72).filter((id) => projById.get(id)!.isGoalie).length,
        biasG216,
      };
      for (const [k, v] of Object.entries(row)) add(m.name, k, v);
      console.log(`${m.name.padEnd(15)} ${Object.entries(row).map(([k, v]) => `${k}=${Number.isInteger(v) ? v : v.toFixed(3)}`).join(" ")}`);
    }

    // simulated drafts
    const players = new Map<number, DP>(proj.map((p) => [p.id, { id: p.id, pos: p.positions[0]!, isG: p.isGoalie }]));
    const orderOf = (sc: Map<number, number>) => [...players.keys()].filter((id) => sc.has(id)).sort((a, b) => sc.get(b)! - sc.get(a)!);
    const orders = Object.fromEntries(METHODS.map((m) => [m.name, orderOf(scores[m.name]!)]));
    for (const field of fields) {
      for (const m of METHODS) {
        const per: number[] = [];
        for (let slot = 0; slot < T; slot++) {
          const rosters = runDraft(Array.from({ length: T }, (_, t) => (t === slot ? orders[m.name]! : orders[field]!)), players, T);
          const ids = new Set(rosters.flat().map((p) => p.id));
          let a = 0, n = 0;
          for (const w of sim.weeks) {
            const st = streaming ? streamerLine(w, ids) : null;
            const tots = rosters.map((r) => withStreamer(weekTotals(r, w), st, streaming ? profile.minGoalieAppearancesPerWeek : 0));
            for (let o = 0; o < T; o++) {
              if (o === slot) continue;
              const x = catPoints(tots[slot]!, tots[o]!);
              a += x.sk + x.g;
              n++;
            }
          }
          per.push(a / n);
        }
        ((draftRes[field] ??= {})[m.name] ??= []).push(...per);
      }
    }
  }

  console.log(`\n=== mean over seasons ${seasons.join(",")} (streaming ${streaming ? "on" : "off"})`);
  for (const [m, ks] of Object.entries(table)) console.log(`${m.padEnd(15)} ${Object.entries(ks).map(([k, v]) => `${k}=${mean(v).toFixed(3)}`).join(" ")}`);
  for (const [field, res] of Object.entries(draftRes)) {
    console.log(`\n=== simulated draft in field ${field}: category points / week vs the field (paired, ${seasons.length} seasons x ${T} slots)`);
    const base = res[field]!;
    for (const [m, xs] of Object.entries(res)) {
      const d = xs.map((x, i) => x - base[i]!);
      console.log(`${m.padEnd(15)} ${mean(xs).toFixed(3)}  diff ${mean(d) >= 0 ? "+" : ""}${mean(d).toFixed(3)} ± ${(sdev(d) / Math.sqrt(d.length)).toFixed(3)}`);
    }
  }
  if (args.includes("--fixture")) {
    const out = join(ROOT, "scripts/fixtures/category-weekly-totals.json");
    writeFileSync(
      out,
      `${JSON.stringify({
        about: "Weekly (Mon-Sun) category totals of 12 snake-balanced Light-the-Lamp teams built from each season's realized starters, by scripts/backtest-category-vor.ts --fixture from the NHL stats REST weekly aggregates. series[k][week][team]; goalieGp = goalie appearances, skaterGp = skater games.",
        seasons: fixture,
      })}\n`,
    );
    console.log(`wrote ${out}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
