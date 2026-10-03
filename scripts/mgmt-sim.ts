/**
 * Shared engine of the management backtests (`backtest-mgmt.ts`): past NHL
 * seasons replayed game by game for simulated Captains Dynasty rosters.
 *
 * Data: the public NHL stats REST game lines (`isGame=true`) cached as
 * `nhlstats-<kind>-<report>-<season>-<game|season>.json` (the layout of
 * `scripts/fetch-in-season-history.ts`; `--fetch` here pulls what is missing,
 * >= 1.15 s apart). Per season: skater summary + realtime game lines, goalie
 * summary game lines, and the previous season's aggregates for the priors.
 *
 * Scoring: Captains' table (src/data/fantrax/league.json) on box stats: G 3,
 * A 2.4 / 1.6 by the primary share (`A1_SHARE`), hat trick 2, SOG 0.4, Hit
 * 0.3, OT goal 0.5; D only: Blk 0.3, Tk 0.35, team shutout 2; captain seat
 * x1.5 on the offense (no Blk / Tk / SHO). Goalies: W 3, GA -1.5, SV 0.27,
 * SO 3, OTL 1, A 2. (A1 / A2 and OT assists are not in the game lines, so a
 * game's points are close to, not exactly, Fantrax's; every policy is scored
 * on the same numbers.)
 *
 * Information: each day's decisions use only games before that day —
 * projections are the prior (last season, shrunk) blended with the season
 * to date, P(play) is the share of the club's last 10 games he dressed for,
 * a player who missed the club's last 3 games is known out (what a manager
 * reads off the injury / scratch icons). Truth is the next day's box score.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { A1_SHARE, backToBackShares, skaterPlayProbability } from "../src/lib/fantrax/points-model";
import type { LineupCandidate } from "../src/lib/fantrax/lineup";
import { CAPTAINS_DYNASTY, type SlotId } from "../src/lib/fantrax/config";
import { returnOdds } from "./mgmt-absence";

/** Absent players' later days: worth their odds of being back (on; lost 21 [13, 29] points a team-season in backtest-mgmt-waivers.ts, not shipped), or nothing (off, as shipped). */
export const RETURN_MODEL = { on: false };

export const CAPTAINS_SLOTS = { C: 3, W: 5, F: 1, D: 3, Skt: 1, G: 2 } as const;
export const CAPTAINS_ORDER: readonly SlotId[] = ["C", "W", "F", "D", "Skt", "G"];
export const ELIGIBLE: Record<Pos, SlotId[]> = { C: ["C", "F", "Skt"], W: ["W", "F", "Skt"], D: ["D", "Skt"], G: ["G"] };

export type Pos = "C" | "W" | "D" | "G";

export interface SkGame {
  day: number;
  team: string;
  off: number;
  dx: number;
}
export interface GlGame {
  day: number;
  team: string;
  gs: number;
  fp: number;
}

export interface Prior {
  /** Offense / defense-extra points per game (shrunk), goalie points per appearance. */
  off: number;
  dx: number;
  gp: number;
  team: string | null;
  /** Goalie: share of his club's starts. */
  share: number;
}

export interface Season {
  id: string;
  dates: string[];
  /** Team -> sorted game days. */
  teamDays: Map<string, number[]>;
  teamPlays: Map<string, Set<number>>;
  sk: Map<number, SkGame[]>;
  gl: Map<number, GlGame[]>;
  pos: Map<number, Pos>;
  name: Map<number, string>;
  prior: Map<number, Prior>;
}

const AW = { F: 2.4 * A1_SHARE.F + 1.6 * (1 - A1_SHARE.F), D: 2.4 * A1_SHARE.D + 1.6 * (1 - A1_SHARE.D) };
export const ROOKIE = { off: 1.5, dxD: 0.8, goalie: 2.5 };

/* eslint-disable @typescript-eslint/no-explicit-any */
const UA = "fantasy-hockey-vor management backtest (personal read-only helper)";
let lastFetch = 0;
async function getJson(url: string): Promise<{ data: any[]; total: number }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastFetch + 1150 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastFetch = Date.now();
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { data: any[]; total: number };
    } catch (err) {
      console.warn(`retry ${attempt + 1}: ${url.slice(0, 120)} (${(err as Error).message})`);
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  throw new Error(`failed: ${url}`);
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
async function windowRows(kind: string, report: string, season: string, from: Date, to: Date): Promise<any[]> {
  const exp = encodeURIComponent(`seasonId=${season} and gameTypeId=2 and gameDate>="${iso(from)}" and gameDate<"${iso(to)}"`);
  const j = await getJson(`https://api.nhle.com/stats/rest/en/${kind}/${report}?isAggregate=false&isGame=true&start=0&limit=-1&cayenneExp=${exp}`);
  if ((j.total >= 10000 || j.data.length < j.total) && to.getTime() - from.getTime() > 86400000) {
    const mid = new Date((from.getTime() + to.getTime()) / 2);
    mid.setUTCHours(0, 0, 0, 0);
    return [...(await windowRows(kind, report, season, from, mid)), ...(await windowRows(kind, report, season, mid, to))];
  }
  return j.data;
}

/** Fetches the missing cache files of a season (game lines + last season's aggregates). */
export async function ensureSeason(dir: string, season: string): Promise<void> {
  const prev = `${Number(season.slice(0, 4)) - 1}${season.slice(0, 4)}`;
  for (const [kind, report] of [["skater", "summary"], ["skater", "realtime"], ["goalie", "summary"]] as const) {
    const f = join(dir, `nhlstats-${kind}-${report}-${season}-game.json`);
    if (!existsSync(f)) {
      const y = Number(season.slice(0, 4));
      const rows: any[] = [];
      for (let m = 8; m < 20; m++) rows.push(...(await windowRows(kind, report, season, new Date(Date.UTC(y, m, 1)), new Date(Date.UTC(y, m + 1, 1)))));
      writeFileSync(f, JSON.stringify(rows));
    }
    const fs = join(dir, `nhlstats-${kind}-${report}-${prev}-season.json`);
    if (!existsSync(fs)) {
      const j = await getJson(`https://api.nhle.com/stats/rest/en/${kind}/${report}?isAggregate=false&isGame=false&start=0&limit=-1&cayenneExp=seasonId=${prev}%20and%20gameTypeId=2`);
      writeFileSync(fs, JSON.stringify(j.data));
    }
  }
}

const read = (dir: string, f: string): any[] => JSON.parse(readFileSync(join(dir, f), "utf8"));
const posOf = (code: string): Pos => (code === "D" ? "D" : code === "G" ? "G" : code === "C" ? "C" : "W");

export function skaterOff(g: { goals: number; assists: number; shots: number; hits: number; otGoals: number }, d: boolean, hatTricks: number): number {
  return 3 * g.goals + (d ? AW.D : AW.F) * g.assists + 2 * hatTricks + 0.4 * g.shots + 0.3 * g.hits + 0.5 * g.otGoals;
}
export const goalieFp = (g: { wins: number; goalsAgainst: number; saves: number; shutouts: number; otLosses: number; assists: number }) =>
  3 * g.wins - 1.5 * g.goalsAgainst + 0.27 * g.saves + 3 * g.shutouts + 1 * (g.otLosses ?? 0) + 2 * (g.assists ?? 0);

export function loadSeason(dir: string, season: string): Season {
  const prev = `${Number(season.slice(0, 4)) - 1}${season.slice(0, 4)}`;
  const sum = read(dir, `nhlstats-skater-summary-${season}-game.json`);
  const rt = read(dir, `nhlstats-skater-realtime-${season}-game.json`);
  const gl = read(dir, `nhlstats-goalie-summary-${season}-game.json`);
  const dateSet = new Set<string>();
  for (const r of sum) dateSet.add(r.gameDate);
  for (const r of gl) dateSet.add(r.gameDate);
  const sorted = [...dateSet].sort();
  // Every calendar day from the first game to the last.
  const dates: string[] = [];
  for (let t = Date.parse(sorted[0]! + "T12:00:00Z"); t <= Date.parse(sorted.at(-1)! + "T12:00:00Z"); t += 86400000) dates.push(iso(new Date(t)));
  const dayOf = new Map(dates.map((d, i) => [d, i]));
  // Team goals against per game (goalie lines): a 0 is a team shutout.
  const ga = new Map<string, number>();
  for (const r of gl) ga.set(`${r.gameId}|${r.teamAbbrev}`, (ga.get(`${r.gameId}|${r.teamAbbrev}`) ?? 0) + r.goalsAgainst);
  const rtBy = new Map<string, any>();
  for (const r of rt) rtBy.set(`${r.gameId}|${r.playerId}`, r);
  const teamPlays = new Map<string, Set<number>>();
  const sk = new Map<number, SkGame[]>();
  const pos = new Map<number, Pos>();
  const name = new Map<number, string>();
  for (const r of sum) {
    const day = dayOf.get(r.gameDate)!;
    const team = r.teamAbbrev as string;
    (teamPlays.get(team) ?? teamPlays.set(team, new Set()).get(team)!).add(day);
    const x = rtBy.get(`${r.gameId}|${r.playerId}`) ?? {};
    const isD = r.positionCode === "D";
    const off = skaterOff({ goals: r.goals, assists: r.assists, shots: r.shots, hits: x.hits ?? 0, otGoals: r.otGoals ?? 0 }, isD, r.goals >= 3 ? 1 : 0);
    const dx = isD ? 0.3 * (x.blockedShots ?? 0) + 0.35 * (x.takeaways ?? 0) + (ga.get(`${r.gameId}|${team}`) === 0 ? 2 : 0) : 0;
    const list = sk.get(r.playerId) ?? [];
    list.push({ day, team, off, dx });
    sk.set(r.playerId, list);
    pos.set(r.playerId, posOf(r.positionCode));
    name.set(r.playerId, r.skaterFullName);
  }
  const glMap = new Map<number, GlGame[]>();
  for (const r of gl) {
    const day = dayOf.get(r.gameDate)!;
    const team = r.teamAbbrev as string;
    (teamPlays.get(team) ?? teamPlays.set(team, new Set()).get(team)!).add(day);
    const list = glMap.get(r.playerId) ?? [];
    list.push({ day, team, gs: r.gamesStarted ?? 0, fp: goalieFp(r) });
    glMap.set(r.playerId, list);
    pos.set(r.playerId, "G");
    name.set(r.playerId, r.goalieFullName);
  }
  for (const l of sk.values()) l.sort((a, b) => a.day - b.day);
  for (const l of glMap.values()) l.sort((a, b) => a.day - b.day);
  const teamDays = new Map([...teamPlays].map(([t, s]) => [t, [...s].sort((a, b) => a - b)]));

  // Priors: last season's aggregates (traded players: one row per club, summed).
  const prior = new Map<number, Prior>();
  const pSum = read(dir, `nhlstats-skater-summary-${prev}-season.json`);
  const pRt = new Map<number, any[]>();
  for (const r of read(dir, `nhlstats-skater-realtime-${prev}-season.json`)) pRt.set(r.playerId, [...(pRt.get(r.playerId) ?? []), r]);
  const agg = new Map<number, any>();
  for (const r of pSum) {
    const a = agg.get(r.playerId) ?? { gp: 0, goals: 0, assists: 0, shots: 0, otGoals: 0, d: r.positionCode === "D", team: null as string | null };
    a.gp += r.gamesPlayed;
    a.goals += r.goals;
    a.assists += r.assists;
    a.shots += r.shots ?? 0;
    a.otGoals += r.otGoals ?? 0;
    a.team = String(r.teamAbbrevs ?? "").split(",").at(-1) || a.team;
    agg.set(r.playerId, a);
  }
  const teamGamesPrev = Math.max(...[...agg.values()].map((a) => a.gp), 48);
  for (const [id, a] of agg) {
    const rts = pRt.get(id) ?? [];
    const hits = rts.reduce((s, r) => s + (r.hits ?? 0), 0);
    const blk = rts.reduce((s, r) => s + (r.blockedShots ?? 0), 0);
    const tk = rts.reduce((s, r) => s + (r.takeaways ?? 0), 0);
    if (a.gp <= 0) continue;
    // Expected hat tricks from the goal rate (Poisson tail), so the prior matches the game lines.
    const lam = a.goals / a.gp;
    const ht = a.gp * (1 - Math.exp(-lam) * (1 + lam + (lam * lam) / 2));
    const offPg = skaterOff({ goals: a.goals, assists: a.assists, shots: a.shots, hits, otGoals: a.otGoals }, a.d, ht) / a.gp;
    const dxPg = a.d ? (0.3 * blk + 0.35 * tk) / a.gp + 2 * 0.05 : 0;
    const k = 10;
    prior.set(id, {
      off: (a.gp * offPg + k * ROOKIE.off) / (a.gp + k),
      dx: a.d ? (a.gp * dxPg + k * ROOKIE.dxD) / (a.gp + k) : 0,
      gp: (a.gp * 82) / teamGamesPrev,
      team: a.team,
      share: 0,
    });
  }
  const gAgg = new Map<number, any>();
  for (const r of read(dir, `nhlstats-goalie-summary-${prev}-season.json`)) {
    const a = gAgg.get(r.playerId) ?? { gp: 0, gs: 0, fp: 0, team: null as string | null };
    a.gp += r.gamesPlayed;
    a.gs += r.gamesStarted ?? 0;
    a.fp += goalieFp(r);
    a.team = String(r.teamAbbrevs ?? "").split(",").at(-1) || a.team;
    gAgg.set(r.playerId, a);
  }
  for (const [id, a] of gAgg) {
    if (a.gp <= 0) continue;
    prior.set(id, {
      off: (a.fp + 10 * ROOKIE.goalie) / (a.gp + 10),
      dx: 0,
      gp: (a.gs * 82) / teamGamesPrev,
      team: a.team,
      share: Math.min(0.85, a.gs / teamGamesPrev),
    });
  }
  return { id: season, dates, teamDays, teamPlays, sk, gl: glMap, pos, name, prior };
}

/** Scoring periods: Monday-to-Sunday weeks; a first week under 4 days joins the next (97 GP / 15 GS, as Captains' period 1). */
export function weeks(s: Season): Array<{ from: number; to: number; gpMax: number; gsMax: number }> {
  const out: Array<{ from: number; to: number; gpMax: number; gsMax: number }> = [];
  let from = 0;
  for (let i = 0; i < s.dates.length; i++) {
    const dow = new Date(s.dates[i]! + "T12:00:00Z").getUTCDay();
    const last = i === s.dates.length - 1;
    if (dow === 0 || last) {
      out.push({ from, to: i, gpMax: 52, gsMax: 8 });
      from = i + 1;
    }
  }
  if (out.length > 1 && out[0]!.to - out[0]!.from + 1 < 4) {
    const [a, b] = out;
    out.splice(0, 2, { from: a!.from, to: b!.to, gpMax: 97, gsMax: 15 });
  }
  return out;
}

// ------------------------------------------------------------- knowledge as of a day

export interface View {
  /** Team as of the day (last game before it, else his first game's / last season's). */
  team: string | null;
  /** Projected offense / defense-extra per game (skater) or points per appearance (goalie). */
  off: number;
  dx: number;
  /** Known out (missed the club's last 3 games). */
  out: boolean;
  /** Goalie: his start share were he healthy (p is 0 while out). */
  share?: number;
  /** P(dresses | club plays), or the goalie's start share. */
  p: number;
  gamesSoFar: number;
}

export const K_SKATER = 20;
export const K_GOALIE = 15;

/** Binary search: count of entries with day < d. */
function before<T extends { day: number }>(list: T[], d: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (list[m]!.day < d) lo = m + 1;
    else hi = m;
  }
  return lo;
}
function daysBefore(list: number[], d: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (list[m]! < d) lo = m + 1;
    else hi = m;
  }
  return lo;
}

export class Knowledge {
  private cache = new Map<string, View>();
  constructor(readonly s: Season) {}

  view(id: number, d: number): View {
    const key = `${id}|${d}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const v = this.s.pos.get(id) === "G" ? this.goalie(id, d) : this.skater(id, d);
    this.cache.set(key, v);
    return v;
  }

  private skater(id: number, d: number): View {
    const games = this.s.sk.get(id) ?? [];
    const pr = this.s.prior.get(id);
    const isD = this.s.pos.get(id) === "D";
    const n = before(games, d);
    let off = 0;
    let dx = 0;
    for (let i = 0; i < n; i++) {
      off += games[i]!.off;
      dx += games[i]!.dx;
    }
    const pOff = pr?.off ?? ROOKIE.off;
    const pDx = isD ? (pr?.dx ?? ROOKIE.dxD) : 0;
    const team = n > 0 ? games[n - 1]!.team : (pr?.team && this.s.teamDays.has(pr.team) ? pr.team : (games[0]?.team ?? null));
    const view: View = {
      team,
      off: (K_SKATER * pOff + off) / (K_SKATER + n),
      dx: (K_SKATER * pDx + dx) / (K_SKATER + n),
      out: false,
      p: 0,
      gamesSoFar: n,
    };
    if (!team) return { ...view, out: true };
    const td = this.s.teamDays.get(team) ?? [];
    const tn = daysBefore(td, d);
    const played = new Set(games.slice(0, n).map((g) => g.day));
    if (tn === 0) {
      // Opening night: a regular of last season (or anyone who just joined) dresses.
      const regular = (pr?.gp ?? 0) >= 20;
      return { ...view, out: !regular, p: regular ? 0.95 : 0 };
    }
    const last3 = td.slice(Math.max(0, tn - 3), tn);
    const out = !last3.some((x) => played.has(x));
    const last10 = td.slice(Math.max(0, tn - 10), tn);
    const pl = last10.filter((x) => played.has(x)).length;
    return { ...view, out, p: out ? 0 : (pl + 4 * 0.95) / (last10.length + 4) };
  }

  private goalie(id: number, d: number): View {
    const games = this.s.gl.get(id) ?? [];
    const pr = this.s.prior.get(id);
    const n = before(games, d);
    let fp = 0;
    for (let i = 0; i < n; i++) fp += games[i]!.fp;
    const team = n > 0 ? games[n - 1]!.team : (pr?.team && this.s.teamDays.has(pr.team) ? pr.team : (games[0]?.team ?? null));
    const view: View = { team, off: (K_GOALIE * (pr?.off ?? ROOKIE.goalie) + fp) / (K_GOALIE + n), dx: 0, out: false, p: 0, gamesSoFar: n };
    if (!team) return { ...view, out: true };
    const td = this.s.teamDays.get(team) ?? [];
    const tn = daysBefore(td, d);
    const recent = td.slice(Math.max(0, tn - 20), tn);
    const mine = games.slice(0, n).filter((g) => g.team === team);
    const startDays = new Set(mine.filter((g) => g.gs > 0).map((g) => g.day));
    const appDays = new Set(mine.map((g) => g.day));
    const st = recent.filter((x) => startDays.has(x)).length;
    const priorShare = pr?.share ?? 0.3;
    const share = Math.min(0.85, (st + 5 * priorShare) / (recent.length + 5));
    const last10 = td.slice(Math.max(0, tn - 10), tn);
    const out = tn >= 5 && !last10.some((x) => appDays.has(x));
    return { ...view, out, p: out ? 0 : share, share };
  }
}

// ------------------------------------------------------------- candidates

export interface Roster {
  ids: number[];
}

/**
 * Lineup candidates of a roster for game day `x`, as known on day `d`.
 * `mode`: "engine" (expected values, P(play), back-to-back goalie shares) or
 * "human" (projected points of whoever is not known out, goalies by share).
 */
export function candidates(k: Knowledge, roster: readonly number[], d: number, x: number, mode: "engine" | "human"): LineupCandidate[] {
  const s = k.s;
  const out: LineupCandidate[] = [];
  for (const id of roster) {
    const v = k.view(id, d);
    if (!v.team || !s.teamPlays.get(v.team)?.has(x)) continue;
    // Known out: nothing today; on a later day (engine + return model) his
    // usual odds times the odds he is back by that club game.
    let back = 1;
    if (v.out) {
      // Only a regular who got hurt (10+ games dressed, 5+ for a goalie), as
      // in the absence study; a minor-leaguer is not « coming back ».
      const regular = v.gamesSoFar >= (s.pos.get(id) === "G" ? 5 : 10);
      if (mode !== "engine" || !RETURN_MODEL.on || x <= d || !regular) continue;
      const td = s.teamDays.get(v.team) ?? [];
      const ahead = td.filter((y) => y >= d && y <= x).length;
      back = returnOdds(ahead);
      if (!(back > 0)) continue;
    }
    const pos = s.pos.get(id)!;
    if (pos === "G") {
      let p = (v.out ? (v.share ?? 0) : v.p) * back;
      if (mode === "engine" && s.teamPlays.get(v.team)?.has(x - 1)) {
        // Back-to-back: the club's goalies' shares as of d, the starter's moved to the backup.
        const mates = new Map<string, number>();
        for (const [gid, list] of s.gl) {
          if (gid === id) continue;
          const gv = k.view(gid, d);
          if (gv.team === v.team && !gv.out && gv.p > 0 && list.length) mates.set(String(gid), gv.p);
        }
        mates.set(String(id), p);
        p = backToBackShares(mates).get(String(id)) ?? p;
      }
      out.push({ id: String(id), eligible: ELIGIBLE.G, status: "ACTIVE", values: { G: p * v.off }, games: p });
      continue;
    }
    // The plan's own P(play): regulars 1, fringe players their projected GP
    // over 82 (last season's games here), unprojected players the prior.
    const pr = s.prior.get(id);
    const p =
      mode === "engine"
        ? back * skaterPlayProbability({ gp: pr?.gp ?? 0, fpg: v.off + v.dx, src: pr ? "proj" : "prior", team: v.team, icons: [] }, true, CAPTAINS_DYNASTY.priors)
        : 1;
    const values: Partial<Record<SlotId, number>> = {};
    for (const slot of ELIGIBLE[pos]) values[slot] = p * (slot === "Skt" ? 1.5 * v.off : v.off + v.dx);
    out.push({ id: String(id), eligible: ELIGIBLE[pos], status: "ACTIVE", values, games: p });
  }
  return out;
}

/** What a lineup really scored on day x: points and games of the players who played. */
export function realize(s: Season, assignments: Array<{ slot: SlotId; playerId: string | null }>, x: number) {
  let skPts = 0;
  let glPts = 0;
  let gp = 0;
  let gs = 0;
  for (const a of assignments) {
    if (!a.playerId) continue;
    const id = Number(a.playerId);
    if (a.slot === "G") {
      const g = (s.gl.get(id) ?? []).find((y) => y.day === x);
      if (!g) continue;
      glPts += g.fp;
      gs += g.gs;
    } else {
      const g = (s.sk.get(id) ?? []).find((y) => y.day === x);
      if (!g) continue;
      skPts += a.slot === "Skt" ? 1.5 * g.off : g.off + g.dx;
      gp += 1;
    }
  }
  return { skPts, glPts, gp, gs };
}

// ------------------------------------------------------------- league

/** Seeded RNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Playable depth of a Captains team: its 2026-27 rosters hold about 21
 * skaters projected for 40+ games (Active, Reserve and the Minors / IR
 * players the daily plan can dress) and 2.5 goalies starting a quarter of
 * their club's games or more.
 */
export const ROSTER_NEEDS: Record<Pos, number> = { C: 6, W: 9, D: 6, G: 3 };

/** Pre-season value (points over the season) from last season only. */
export function draftValue(s: Season, id: number): number {
  const pr = s.prior.get(id);
  if (!pr) return 0;
  if (s.pos.get(id) === "G") return pr.off * pr.share * 82;
  return (pr.off + pr.dx) * Math.min(82, pr.gp);
}

/**
 * A 16-team snake draft on last season's value (with a little noise so the
 * teams are not clones): Captains' 20 counted spots, C5 W7 D5 G3.
 */
export function draftLeague(s: Season, teams = 16, seed = 1, needs: Record<Pos, number> = ROSTER_NEEDS): number[][] {
  const ROSTER_NEEDS = needs;
  const r = rng(seed);
  const pool = [...s.prior.keys()]
    .filter((id) => s.pos.has(id))
    .map((id) => ({ id, v: draftValue(s, id) * (0.9 + 0.2 * r()), pos: s.pos.get(id)! }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v);
  const rosters: number[][] = Array.from({ length: teams }, () => []);
  const need = rosters.map(() => ({ ...ROSTER_NEEDS }));
  const taken = new Set<number>();
  const rounds = Object.values(ROSTER_NEEDS).reduce((a, b) => a + b, 0);
  for (let round = 0; round < rounds; round++) {
    const order = round % 2 === 0 ? [...rosters.keys()] : [...rosters.keys()].reverse();
    for (const t of order) {
      const pick = pool.find((x) => !taken.has(x.id) && need[t]![x.pos] > 0);
      if (!pick) continue;
      taken.add(pick.id);
      need[t]![pick.pos]--;
      rosters[t]!.push(pick.id);
    }
  }
  return rosters;
}

export function meanCi(xs: number[]): { mean: number; lo: number; hi: number; n: number } {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  const h = (1.96 * sd) / Math.sqrt(Math.max(1, n));
  return { mean, lo: mean - h, hi: mean + h, n };
}
