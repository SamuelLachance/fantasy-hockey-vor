/**
 * Loader of the game-by-game history cached by scripts/fetch-in-season-history.ts,
 * for the in-season backtest (scripts/backtest-in-season.ts).
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

export const SKATER_STATS = ["goals", "assists", "powerplayPoints", "shots", "hits", "blocks", "penaltyMinutes", "faceoffWins"] as const;
export type SkaterStat = (typeof SKATER_STATS)[number];

export interface SkaterLine {
  gid: number;
  date: string;
  team: string;
  /** Minutes on ice: all situations, power play, short-handed. */
  toi: number;
  pp: number;
  sh: number;
  s: Record<SkaterStat, number>;
}
export interface GoalieLine {
  gid: number;
  date: string;
  team: string;
  started: boolean;
  w: number;
  so: number;
  sv: number;
  sa: number;
  ga: number;
}
export interface SeasonHistory {
  id: string;
  skaters: Map<number, { pos: "F" | "D"; name: string; lines: SkaterLine[] }>;
  goalies: Map<number, { name: string; lines: GoalieLine[] }>;
  /** Team → its games in order (game id, date). */
  teamGames: Map<string, Array<{ gid: number; date: string }>>;
  /** Team → game id → total power-play minutes of its skaters (≈ 5 × the team's PP time). */
  teamPpSkaterMinutes: Map<string, Map<number, number>>;
  /** Team → game id → shots against, goals against, win (from its goalies). */
  teamGoalieGame: Map<string, Map<number, { sa: number; ga: number; w: number }>>;
}
export interface SeasonAggregate {
  gp: number;
  pos: "F" | "D";
  toi: number;
  pp: number;
  s: Record<SkaterStat, number>;
}
export interface GoalieAggregate {
  gp: number;
  gs: number;
  w: number;
  so: number;
  sv: number;
  sa: number;
  ga: number;
}

type Row = Record<string, number | string | null>;
function read(dir: string, name: string): Row[] {
  const f = join(dir, `nhlstats-${name}.json`);
  if (!existsSync(f)) throw new Error(`${f} missing: npx tsx scripts/fetch-in-season-history.ts --cache=${dir}`);
  const d = JSON.parse(readFileSync(f, "utf8")) as Row[] | { data: Row[] };
  return Array.isArray(d) ? d : d.data;
}
export function hasSeason(dir: string, season: string, kind: "game" | "season"): boolean {
  return existsSync(join(dir, `nhlstats-skater-summary-${season}-${kind}.json`));
}
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : Number(x) || 0);
const posGroup = (p: unknown): "F" | "D" => (p === "D" ? "D" : "F");

export function loadSeasonGames(dir: string, season: string): SeasonHistory {
  const key = (r: Row) => `${r.playerId}:${r.gameId}`;
  const rt = new Map(read(dir, `skater-realtime-${season}-game`).map((r) => [key(r), r]));
  const fo = new Map(read(dir, `skater-faceoffwins-${season}-game`).map((r) => [key(r), r]));
  const ti = new Map(read(dir, `skater-timeonice-${season}-game`).map((r) => [key(r), r]));
  const skaters: SeasonHistory["skaters"] = new Map();
  const teamGamesM = new Map<string, Map<number, string>>();
  const teamPp = new Map<string, Map<number, number>>();
  const seen = new Set<string>();
  for (const r of read(dir, `skater-summary-${season}-game`)) {
    const k = key(r);
    if (seen.has(k)) continue;
    seen.add(k);
    const x = rt.get(k);
    const f = fo.get(k);
    const t = ti.get(k);
    const team = String(r.teamAbbrev);
    const gid = num(r.gameId);
    const date = String(r.gameDate);
    const line: SkaterLine = {
      gid,
      date,
      team,
      toi: num(t?.timeOnIce ?? r.timeOnIcePerGame) / 60,
      pp: num(t?.ppTimeOnIce) / 60,
      sh: num(t?.shTimeOnIce) / 60,
      s: {
        goals: num(r.goals),
        assists: num(r.assists),
        powerplayPoints: num(r.ppPoints),
        shots: num(r.shots),
        hits: num(x?.hits),
        blocks: num(x?.blockedShots),
        penaltyMinutes: num(r.penaltyMinutes),
        faceoffWins: num(f?.totalFaceoffWins ?? f?.faceoffWins),
      },
    };
    const id = num(r.playerId);
    if (!skaters.has(id)) skaters.set(id, { pos: posGroup(r.positionCode), name: String(r.skaterFullName ?? ""), lines: [] });
    skaters.get(id)!.lines.push(line);
    if (!teamGamesM.has(team)) teamGamesM.set(team, new Map());
    teamGamesM.get(team)!.set(gid, date);
    if (!teamPp.has(team)) teamPp.set(team, new Map());
    teamPp.get(team)!.set(gid, (teamPp.get(team)!.get(gid) ?? 0) + line.pp);
  }
  const byDate = <T extends { date: string; gid: number }>(a: T, b: T) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.gid - b.gid);
  for (const p of skaters.values()) p.lines.sort(byDate);
  const teamGames = new Map([...teamGamesM].map(([t, m]) => [t, [...m].map(([gid, date]) => ({ gid, date })).sort(byDate)]));
  const goalies: SeasonHistory["goalies"] = new Map();
  const teamGoalieGame = new Map<string, Map<number, { sa: number; ga: number; w: number }>>();
  const gseen = new Set<string>();
  for (const r of read(dir, `goalie-summary-${season}-game`)) {
    const k = key(r);
    if (gseen.has(k)) continue;
    gseen.add(k);
    const id = num(r.playerId);
    const line: GoalieLine = {
      gid: num(r.gameId),
      date: String(r.gameDate),
      team: String(r.teamAbbrev),
      started: num(r.gamesStarted) > 0,
      w: num(r.wins),
      so: num(r.shutouts),
      sv: num(r.saves),
      sa: num(r.shotsAgainst),
      ga: num(r.goalsAgainst),
    };
    if (!goalies.has(id)) goalies.set(id, { name: String(r.goalieFullName ?? ""), lines: [] });
    goalies.get(id)!.lines.push(line);
    if (!teamGoalieGame.has(line.team)) teamGoalieGame.set(line.team, new Map());
    const tg = teamGoalieGame.get(line.team)!;
    const cur = tg.get(line.gid) ?? { sa: 0, ga: 0, w: 0 };
    tg.set(line.gid, { sa: cur.sa + line.sa, ga: cur.ga + line.ga, w: Math.max(cur.w, line.w) });
  }
  for (const g of goalies.values()) g.lines.sort(byDate);
  return { id: season, skaters, goalies, teamGames, teamPpSkaterMinutes: teamPp, teamGoalieGame };
}

export function loadSeasonAggregates(dir: string, season: string): Map<number, SeasonAggregate> {
  const out = new Map<number, SeasonAggregate>();
  if (!hasSeason(dir, season, "season")) return out;
  const rt = new Map(read(dir, `skater-realtime-${season}-season`).map((r) => [num(r.playerId), r]));
  const fo = new Map(read(dir, `skater-faceoffwins-${season}-season`).map((r) => [num(r.playerId), r]));
  const tiFile = join(dir, `nhlstats-skater-timeonice-${season}-season.json`);
  const ti = existsSync(tiFile) ? new Map(read(dir, `skater-timeonice-${season}-season`).map((r) => [num(r.playerId), r])) : new Map<number, Row>();
  for (const r of read(dir, `skater-summary-${season}-season`)) {
    const id = num(r.playerId);
    const x = rt.get(id);
    const f = fo.get(id);
    const t = ti.get(id);
    const gp = num(r.gamesPlayed);
    out.set(id, {
      gp,
      pos: posGroup(r.positionCode),
      toi: num(t?.timeOnIce ?? num(r.timeOnIcePerGame) * gp) / 60,
      pp: num(t?.ppTimeOnIce) / 60,
      s: {
        goals: num(r.goals),
        assists: num(r.assists),
        powerplayPoints: num(r.ppPoints),
        shots: num(r.shots),
        hits: num(x?.hits),
        blocks: num(x?.blockedShots),
        penaltyMinutes: num(r.penaltyMinutes),
        faceoffWins: num(f?.totalFaceoffWins),
      },
    });
  }
  return out;
}

export function loadGoalieAggregates(dir: string, season: string): Map<number, GoalieAggregate> {
  const out = new Map<number, GoalieAggregate>();
  if (!existsSync(join(dir, `nhlstats-goalie-summary-${season}-season.json`))) return out;
  for (const r of read(dir, `goalie-summary-${season}-season`))
    out.set(num(r.playerId), { gp: num(r.gamesPlayed), gs: num(r.gamesStarted), w: num(r.wins), so: num(r.shutouts), sv: num(r.saves), sa: num(r.shotsAgainst), ga: num(r.goalsAgainst) });
  return out;
}

export const prevSeason = (s: string, k = 1): string => {
  const y = Number(s.slice(0, 4)) - k;
  return `${y}${y + 1}`;
};
/** Games each team was scheduled to play (2019-20 paused at ~70, 2020-21 56). */
export const seasonTeamGames = (s: string): number => (s === "20192020" ? 70 : s === "20202021" ? 56 : 82);
