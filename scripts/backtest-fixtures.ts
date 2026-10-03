/**
 * Small committed samples of the two tool backtests (inputs plus the real
 * outcome), so the CI re-scores them with the CURRENT engine in seconds:
 *
 * - scripts/fixtures/matchup-backtest-sample.json: one matchup in eight of
 *   scripts/backtest-matchup.ts (both rosters as the Monday-before rates,
 *   the week's schedule, the real categories won, the « force sans
 *   calendrier » odds), re-simulated by `simulateWeek`;
 * - scripts/fixtures/trade-backtest-sample.json: every trade of the first
 *   league of each test season of scripts/backtest-trade.ts (rosters,
 *   projected points, the real season gain), re-predicted by `lineupPoints`.
 *
 * Each backtest writes its sample and the sample's score with the engine it
 * ran; scripts/test-matchup.ts and scripts/test-trade.ts re-score it and fail
 * when the score drifts (the engine changed without a re-run of the
 * backtest) or no longer beats the baseline. Shared by the backtests and the
 * tests so both score the sample the same way.
 */
import { lineupPoints, type LineupRules, type TeamPlayer } from "../src/lib/trade/team-value";
import type { SlotSpec } from "../src/lib/leagues/slot-fill";
import { MATCHUP_PARAMS, type MatchupParams } from "../src/lib/matchup/params";
import { simulateWeek, type SimDay, type SimGoalie, type SimSkater, type SimTeam } from "../src/lib/matchup/simulate";

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** Spearman rank correlation (ties ranked in order of appearance). */
export function spearman(x: readonly number[], y: readonly number[]): number {
  const rank = (a: readonly number[]) => {
    const idx = a.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(a.length);
    idx.forEach(([, i], k) => (r[i] = k));
    return r;
  };
  const rx = rank(x);
  const ry = rank(y);
  const n = x.length;
  const m = (n - 1) / 2;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i]! - m) * (ry[i]! - m);
    dx += (rx[i]! - m) ** 2;
    dy += (ry[i]! - m) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

// =============================================================== trades
/** The Slapshot-shaped league of the trade backtest: C4 LW4 RW4 D6 G2 + 3 reserves. */
export const TRADE_SEATS: SlotSpec<string>[] = [
  { slot: "C", capacity: 4, accepts: ["C"] },
  { slot: "LW", capacity: 4, accepts: ["LW"] },
  { slot: "RW", capacity: 4, accepts: ["RW"] },
  { slot: "D", capacity: 6, accepts: ["D"] },
  { slot: "G", capacity: 2, accepts: ["G"] },
];
export const TRADE_ROSTER = 23;
export const tradeRules = (bench: number, goalieBench: number): LineupRules => ({
  seats: TRADE_SEATS,
  benchShare: bench,
  goalieBenchShare: goalieBench,
  rosterSize: TRADE_ROSTER,
  captainBonus: 0,
});
export interface TradeProj {
  id: number;
  pos: string;
  goalie: boolean;
  /** Projected season points. */
  fp: number;
}
const toTP = (p: TradeProj): TeamPlayer => ({
  id: String(p.id),
  name: String(p.id),
  pos: [p.pos],
  goalie: p.goalie,
  dv: { winNow: p.fp, balanced: p.fp, longTerm: p.fp },
  fp: p.fp,
  minorsOk: false,
});
/** The tool's season for a roster: its best projected lineup (`lineupPoints`, roster limit inside). */
export function toolSeason(ids: readonly number[], proj: ReadonlyMap<number, TradeProj>, bench: number, goalieBench: number): number {
  return lineupPoints(ids.map((id) => toTP(proj.get(id)!)), tradeRules(bench, goalieBench)).points;
}
/** The roster a team keeps after a trade: over the limit, its lowest projected go (in the truth as in the baselines). */
export function keptAfter(team: readonly number[], give: readonly number[], get: readonly number[], proj: ReadonlyMap<number, TradeProj>): { after: number[]; kept: number[] } {
  const after = [...team.filter((id) => !give.includes(id)), ...get];
  const kept = [...after].sort((x, y) => proj.get(y)!.fp - proj.get(x)!.fp).slice(0, TRADE_ROSTER);
  return { after, kept };
}
/**
 * What a human adds up: points received − points sent (`plain`), and the same
 * minus the points of the player(s) the team must let go to stay at the
 * roster limit (`naive`, the baseline the tool is held to).
 */
export function tradeBaselines(team: readonly number[], give: readonly number[], get: readonly number[], proj: ReadonlyMap<number, TradeProj>): { plain: number; naive: number } {
  const fp = (ids: readonly number[]) => sum(ids.map((id) => proj.get(id)!.fp));
  const plain = fp(get) - fp(give);
  const { after, kept } = keptAfter(team, give, get, proj);
  return { plain, naive: plain - fp(after.filter((id) => !kept.includes(id))) };
}

/** Players as [pos, goalie 0/1, projected points]; teams and trades by player index. */
export interface TradeFixtureSeason {
  season: number;
  players: Array<[string, number, number]>;
  teams: number[][];
  /** [receiving team, indices sent, indices received, real season gain]. */
  trades: Array<[number, number[], number[], number]>;
}
export interface TradeFixtureScore {
  n: number;
  spearman: { tool: number; naive: number; plain: number };
}
export interface TradeFixture {
  builtAt: string;
  benchShare: number;
  goalieBenchShare: number;
  seasons: TradeFixtureSeason[];
  score: TradeFixtureScore;
}

export function packTradeSeason(
  season: number,
  teams: readonly number[][],
  proj: ReadonlyMap<number, TradeProj>,
  trades: ReadonlyArray<{ ai: number; give: number[]; get: number[]; truth: number }>,
): TradeFixtureSeason {
  const index = new Map<number, number>();
  const players: Array<[string, number, number]> = [];
  const ix = (id: number) => {
    let i = index.get(id);
    if (i == null) {
      const p = proj.get(id)!;
      i = players.length;
      players.push([p.pos, p.goalie ? 1 : 0, round(p.fp, 1)]);
      index.set(id, i);
    }
    return i;
  };
  return {
    season,
    teams: teams.map((t) => t.map(ix)),
    players,
    trades: trades.map((t) => [t.ai, t.give.map(ix), t.get.map(ix), round(t.truth, 1)]),
  };
}

/** The sample re-scored with the current `lineupPoints` and the given bench shares. */
export function scoreTradeFixture(seasons: readonly TradeFixtureSeason[], bench: number, goalieBench: number): TradeFixtureScore {
  const tool: number[] = [];
  const naive: number[] = [];
  const plain: number[] = [];
  const truth: number[] = [];
  for (const s of seasons) {
    const proj = new Map<number, TradeProj>(s.players.map(([pos, g, fp], i) => [i, { id: i, pos, goalie: g === 1, fp }]));
    const base = s.teams.map((t) => toolSeason(t, proj, bench, goalieBench));
    for (const [ai, give, get, t] of s.trades) {
      const team = s.teams[ai]!;
      const { after } = keptAfter(team, give, get, proj);
      tool.push(toolSeason(after, proj, bench, goalieBench) - base[ai]!);
      const b = tradeBaselines(team, give, get, proj);
      naive.push(b.naive);
      plain.push(b.plain);
      truth.push(t);
    }
  }
  const r8 = (x: number) => round(x, 8);
  return { n: truth.length, spearman: { tool: r8(spearman(tool, truth)), naive: r8(spearman(naive, truth)), plain: r8(spearman(plain, truth)) } };
}

// =============================================================== matchups
/** [id, club, positions "C/LW", G A PPP SOG HIT BLK per game, priority]. */
type FxSkater = [number, string, string, number, number, number, number, number, number, number];
/** [id, club, start share, W GA SA per start, priority]. */
type FxGoalie = [number, string, number, number, number, number, number];
export interface FxMatchup {
  seed: string;
  /** [date, clubs playing, clubs on the second night of a back-to-back]. */
  days: Array<[string, string[], string[]]>;
  a: { sk: FxSkater[]; gk: FxGoalie[] };
  b: { sk: FxSkater[]; gk: FxGoalie[] };
  /** Real categories (1 won, 0.5 tie, 0 lost), side a. */
  out: number[];
  /** « Force sans calendrier » odds (the baseline), side a. */
  naive: number[];
}
export interface MatchupFixtureScore {
  n: number;
  sims: number;
  brier: { simulateur: number; forceSansCalendrier: number; pileOuFace: number };
}
export interface MatchupFixture {
  builtAt: string;
  matchups: FxMatchup[];
  score: MatchupFixtureScore;
}
export const MATCHUP_FIXTURE_SIMS = 400;

export function packMatchup(seed: string, A: SimTeam, B: SimTeam, days: readonly SimDay[], out: readonly number[], naive: readonly number[]): FxMatchup {
  const team = (t: SimTeam) => ({
    sk: t.skaters.map((p): FxSkater => [p.id, p.team, p.pos.join("/"), ...(p.rate.map((x) => round(x, 4)) as [number, number, number, number, number, number]), round(p.prio, 4)]),
    gk: t.goalies.map((g): FxGoalie => [g.id, g.team, round(g.start, 4), round(g.w, 4), round(g.ga, 4), round(g.sa, 3), round(g.prio, 4)]),
  });
  return {
    seed,
    days: days.map((d) => [d.date, [...d.teams].sort(), [...(d.b2b ?? [])].sort()]),
    a: team(A),
    b: team(B),
    out: [...out],
    naive: naive.map((x) => round(x, 4)),
  };
}

export function unpackMatchup(m: FxMatchup): { A: SimTeam; B: SimTeam; days: SimDay[] } {
  const team = (t: FxMatchup["a"]): SimTeam => ({
    skaters: t.sk.map(
      ([id, team, pos, g, a, ppp, sog, hit, blk, prio]): SimSkater => ({ id, name: String(id), team, pos: pos.split("/"), rate: [g, a, ppp, sog, hit, blk], prio }),
    ),
    goalies: t.gk.map(([id, team, start, w, ga, sa, prio]): SimGoalie => ({ id, name: String(id), team, start, w, ga, sa, prio })),
  });
  return { A: team(m.a), B: team(m.b), days: m.days.map(([date, teams, b2b]) => ({ date, teams: new Set(teams), b2b: new Set(b2b) })) };
}

/** The sample re-simulated with the current `simulateWeek`: category Brier of the simulator and of the baselines. */
export function scoreMatchupFixture(matchups: readonly FxMatchup[], params: MatchupParams = MATCHUP_PARAMS, sims = MATCHUP_FIXTURE_SIMS): MatchupFixtureScore {
  let se = 0, seN = 0, seC = 0, n = 0;
  for (const m of matchups) {
    const { A, B, days } = unpackMatchup(m);
    const sim = simulateWeek(A, B, days, { sims, seed: m.seed, params });
    sim.cats.forEach((c, i) => {
      const y = m.out[i]!;
      se += (c.win + 0.5 * c.tie - y) ** 2;
      seN += (m.naive[i]! - y) ** 2;
      seC += (0.5 - y) ** 2;
      n++;
    });
  }
  const r8 = (x: number) => round(x, 8);
  return { n: matchups.length, sims, brier: { simulateur: r8(se / n), forceSansCalendrier: r8(seN / n), pileOuFace: r8(seC / n) } };
}
