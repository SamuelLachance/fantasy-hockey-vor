/**
 * In-season projections, run every day (league-daily.yml / deploy-pages.yml):
 * each player's season projection becomes what he has done so far plus the
 * rest of his season, from
 *
 * - his pre-season projection (src/data/players-preseason.json, written by
 *   `npm run generate`): per-game rates and expected share of his team's
 *   games;
 * - this season's NHL stats to date (api.nhle.com stats REST, public):
 *   each per-game rate is updated by shrinkage — (prior × K + actual) /
 *   (K + games played), K per stat (how many games before a stat speaks for
 *   itself) — so a hot or cold week moves it a little, a season a lot;
 * - his ROLE this season, game by game (ice time and power-play time, stats
 *   REST time-on-ice report, isGame): ice time speaks within 3 games where
 *   goals need 100, so the pre-season rate first moves with his ice time and
 *   PP time against the last two seasons' (a winger promoted to the first
 *   line and the first PP unit gets more of every stat from the next game),
 *   and his goals are his shots × his shooting % regressed toward his
 *   pre-season one (src/lib/inseason/skater.ts, scripts/backtest-in-season.ts);
 * - his share of his team's games: the pre-season share updated by the team
 *   games he dressed for, recent ones weighing more, completed long
 *   absences left out (he came back), × a power of his ice-time ratio (a
 *   role cut foretells scratches), × a decay over the games he has missed in
 *   a row without being on the injury report (sent down, unsigned,
 *   scratched for good), so his share falls toward 0 instead of stalling.
 *   Goalies keep src/lib/in-season.ts (no goalie variant beat it,
 *   scripts/backtest-in-season-goalies.ts);
 * - when the game-by-game ice-time report is unavailable: every role ratio
 *   is 1 and the games share falls back to the season totals
 *   (src/lib/in-season.ts, K 30), but the skater rates still come from
 *   src/lib/inseason/skater.ts (its per-stat K and goals = shots × regressed
 *   shooting %), so the update does NOT match the box-stat one of bd259b2;
 * - the remaining schedule (public/fantrax/schedule-20262027.json): his
 *   team's games beyond those it has played according to the same stats
 *   REST, so a game under way, or not in the stats yet, still counts as left;
 * - current injuries and their estimated return dates (ESPN's public injury
 *   report): the games his team plays before his return are taken out of
 *   his remaining games; a status without a date gets a typical absence
 *   that grows with what the absence has already lasted. A hurt goalie's
 *   starts go to his healthy teammates, the n° 2 first;
 * - a player with NHL games this season but no pre-season projection (a
 *   call-up, a rookie the pre-season pool missed) gets a first-season prior
 *   from the role his club gives him (rates and games share as lines in his
 *   ice time and PP time, src/lib/inseason/newcomer.ts) instead of being
 *   left out.
 *
 * Writes src/data/players.json (same shape; `gamesPlayed` and `projection`
 * are the full-season totals, actual + rest of season; `inSeason` holds the
 * to-date line, the injury, his role and the date). Public unauthenticated
 * GETs only, ≥ 1.1 s apart, descriptive User-Agent.
 *
 * Offline replay (scripts/test-in-season.ts runs it on a frozen sample):
 * IN_SEASON_ROOT=<dir> reads and writes <dir>/src/data/… and
 * <dir>/public/fantrax/…, IN_SEASON_NOW=<ISO date> sets the day, and
 * IN_SEASON_REPLAY=<file> answers each request from
 * `{ responses: [{ match, body }] }` (first `match` contained in the decoded
 * URL; none: the request fails), with no network and no wait.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  defaultGamesOut,
  GOALIE_K,
  GOALIE_SHARE_K,
  NEWCOMER_GOALIE,
  NEWCOMER_PER82,
  NEWCOMER_RATE_K,
  NEWCOMER_SHARE_K,
  NEWCOMER_SHARE_PRIOR,
  redistributeGoalieStarts,
  shrinkRate,
  SKATER_RATE_K,
  SKATER_SHARE_K,
  updatedGameShare,
} from "../src/lib/in-season";
import { NEWCOMER_USAGE_K, newcomerRates, newcomerShare } from "../src/lib/inseason/newcomer";
import { gamesShareNow, restOfSeasonRates, USAGE_STATS, usageNow, type Usage, type UsageStat } from "../src/lib/inseason/skater";
import { gamesFromRows, priorUsageOf, playedFlags, trimCurrentAbsence } from "../src/lib/inseason/live";

const UA = "fantasy-hockey-vor (personal read-only helper; github.com/SamuelLachance/fantasy-hockey-vor)";
const SEASON_ID = "20262027";
const root = process.env.IN_SEASON_ROOT ?? process.cwd();
const PLAYERS = join(root, "src", "data", "players.json");
const BASELINE = join(root, "src", "data", "players-preseason.json");
const SCHEDULE = join(root, "public", "fantrax", "schedule-20262027.json");
/** Pre-season games are on an 82-game basis: gamesPlayed / 82 is a share of the team's games. */
const SEASON_GAMES = 82;
/** Newcomers whose debut date is looked up when the game-by-game report is unavailable (one public game-log request each). */
const MAX_NEWCOMER_LOOKUPS = 40;
/** The two seasons before, for each skater's ice time and PP time before this one. */
const PRIOR_SEASON_IDS = ["20252026", "20242025"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const REPLAY = process.env.IN_SEASON_REPLAY
  ? (JSON.parse(readFileSync(process.env.IN_SEASON_REPLAY, "utf8")) as { responses: Array<{ match: string; body: unknown }> }).responses
  : null;
async function getJson<T>(url: string): Promise<T> {
  if (REPLAY) {
    const u = decodeURIComponent(url);
    const hit = REPLAY.find((r) => u.includes(r.match));
    if (!hit) throw new Error(`${url}: not in the replay`);
    return structuredClone(hit.body) as T;
  }
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const out = (await res.json()) as T;
  await sleep(1100);
  return out;
}
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
const r1 = (x: number) => Math.round(x * 10) / 10;
const POSITION: Record<string, string> = { C: "C", L: "LW", R: "RW", D: "D", G: "G" };

interface Player {
  id: number;
  name: string;
  team: string;
  isGoalie: boolean;
  gamesPlayed: number;
  projection: Record<string, number>;
  inSeason?: InSeason;
  [k: string]: unknown;
}
interface InSeason {
  asOf: string;
  gp: number;
  stats: Record<string, number>;
  /** Games his team has left, and his expected remaining games. */
  teamLeft: number;
  rosGames: number;
  injury: { status: string; returnDate: string | null; gamesOut: number; note: string | null; since: string | null } | null;
  /** No pre-season projection: first-season prior (call-up, rookie). */
  newcomer?: true;
  /** His role: ice time and PP time per game expected from now on (min), against before the season. */
  usage?: { toi: number; pp: number; toiRatio: number; ppRatio: number };
}
interface Live {
  gp: number;
  team: string;
  /** Played for one club only (his GP counts that club's games). */
  oneTeam: boolean;
  name: string;
  position: string;
  stats: Record<string, number>;
}

async function main() {
  const now = process.env.IN_SEASON_NOW ? new Date(process.env.IN_SEASON_NOW) : new Date();
  const nowMs = now.getTime();
  if (!existsSync(BASELINE)) {
    writeFileSync(BASELINE, readFileSync(PLAYERS, "utf8"));
    console.log("players-preseason.json frozen from the current pre-season projections");
  }
  const base = JSON.parse(readFileSync(BASELINE, "utf8")) as { players: Player[]; [k: string]: unknown };
  const current = JSON.parse(readFileSync(PLAYERS, "utf8")) as { players: Player[]; [k: string]: unknown };
  const currentById = new Map(current.players.map((p) => [p.id, p]));

  // ---- this season's stats to date
  const q = `limit=-1&cayenneExp=seasonId=${SEASON_ID}%20and%20gameTypeId=2`;
  type Row = Record<string, number | string | null>;
  const summary = (await getJson<{ data: Row[] }>(`https://api.nhle.com/stats/rest/en/skater/summary?${q}`)).data;
  const realtime = (await getJson<{ data: Row[] }>(`https://api.nhle.com/stats/rest/en/skater/realtime?${q}`)).data;
  const faceoffs = (await getJson<{ data: Row[] }>(`https://api.nhle.com/stats/rest/en/skater/faceoffwins?${q}`).catch(() => ({ data: [] as Row[] }))).data;
  const goalies = (await getJson<{ data: Row[] }>(`https://api.nhle.com/stats/rest/en/goalie/summary?${q}`)).data;
  const rt = new Map(realtime.map((r) => [Number(r.playerId), r]));
  const fo = new Map(faceoffs.map((r) => [Number(r.playerId), r]));
  const sk = new Map<number, Live>();
  for (const r of summary) {
    const id = Number(r.playerId);
    const x = rt.get(id);
    const f = fo.get(id);
    const teams = String(r.teamAbbrevs ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    sk.set(id, {
      gp: Number(r.gamesPlayed) || 0,
      team: teams[teams.length - 1] ?? "",
      oneTeam: teams.length === 1,
      name: String(r.skaterFullName ?? ""),
      position: POSITION[String(r.positionCode ?? "C")] ?? "C",
      stats: {
        goals: Number(r.goals) || 0,
        assists: Number(r.assists) || 0,
        powerplayPoints: Number(r.ppPoints) || 0,
        shots: Number(r.shots) || 0,
        hits: Number(x?.hits) || 0,
        blocks: Number(x?.blockedShots) || 0,
        penaltyMinutes: Number(r.penaltyMinutes) || 0,
        faceoffWins: Number(f?.totalFaceoffWins ?? f?.faceoffWins) || 0,
      },
    });
  }
  const gk = new Map<number, Live>();
  for (const r of goalies) {
    const teams = String(r.teamAbbrevs ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    gk.set(Number(r.playerId), {
      gp: Number(r.gamesPlayed) || 0,
      team: teams[teams.length - 1] ?? "",
      oneTeam: teams.length === 1,
      name: String(r.goalieFullName ?? ""),
      position: "G",
      stats: {
        wins: Number(r.wins) || 0,
        shutouts: Number(r.shutouts) || 0,
        saves: Number(r.saves) || 0,
        shotsAgainst: Number(r.shotsAgainst) || 0,
      },
    });
  }

  // ---- his role, game by game: ice time and PP time of every skater game
  // this season (time-on-ice report, isGame, month windows halved while one
  // holds 10,000 rows), and of the two seasons before (aggregates). Without
  // them (report down) every role ratio is 1 and the games share falls back
  // to the season totals (K 30); the rates keep the per-stat K and the
  // regressed shooting % of src/lib/inseason/skater.ts.
  const schedIso = (JSON.parse(readFileSync(SCHEDULE, "utf8")) as { games: Array<[string, string, string]> }).games.map((g) => g[0]).sort();
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  async function gameRows(from: Date, to: Date): Promise<Row[]> {
    const exp = encodeURIComponent(`seasonId=${SEASON_ID} and gameTypeId=2 and gameDate>="${isoDay(from)}" and gameDate<"${isoDay(to)}"`);
    const j = await getJson<{ data: Row[]; total: number }>(
      `https://api.nhle.com/stats/rest/en/skater/timeonice?isAggregate=false&isGame=true&start=0&limit=-1&cayenneExp=${exp}`,
    );
    if ((j.total >= 10000 || j.data.length < j.total) && to.getTime() - from.getTime() > 86400000) {
      const mid = new Date((from.getTime() + to.getTime()) / 2);
      mid.setUTCHours(0, 0, 0, 0);
      return [...(await gameRows(from, mid)), ...(await gameRows(mid, to))];
    }
    return j.data;
  }
  let usageRows: Row[] | null = null;
  try {
    const first = new Date(`${(schedIso[0] ?? now.toISOString()).slice(0, 10)}T00:00:00Z`);
    first.setUTCDate(first.getUTCDate() - 1);
    const end = new Date(now.getTime() + 2 * 86400000);
    usageRows = [];
    for (let from = first; from < end; ) {
      const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
      usageRows.push(...(await gameRows(from, to < end ? to : end)));
      from = to;
    }
  } catch (err) {
    usageRows = null;
    console.warn(`WARN: game-by-game ice time unavailable (${(err as Error).message}); box stats only today`);
  }
  const { byPlayer: usageByPlayer, teamGames: statsTeamGames } = gamesFromRows(usageRows ?? []);
  const priorAgg = new Map<number, Array<{ gp: number; toi: number; pp: number } | undefined>>();
  for (const [i, season] of PRIOR_SEASON_IDS.entries()) {
    try {
      const rows = (await getJson<{ data: Row[] }>(`https://api.nhle.com/stats/rest/en/skater/timeonice?limit=-1&cayenneExp=seasonId=${season}%20and%20gameTypeId=2`)).data;
      for (const r of rows) {
        const id = Number(r.playerId);
        if (!priorAgg.has(id)) priorAgg.set(id, []);
        priorAgg.get(id)![i] = { gp: Number(r.gamesPlayed) || 0, toi: (Number(r.timeOnIce) || 0) / 60, pp: (Number(r.ppTimeOnIce) || 0) / 60 };
      }
    } catch (err) {
      console.warn(`WARN: ${season} ice time unavailable (${(err as Error).message})`);
    }
  }
  const hasUsage = usageRows != null && usageRows.length > 0;
  /** His role now against before the season (ratios 1 without the report). */
  const usageOf = (id: number, withPrior: boolean): Usage => {
    const mine = usageByPlayer.get(id) ?? [];
    const prior = withPrior ? priorUsageOf(priorAgg.get(id) ?? []) : { toi: null, pp: null };
    return usageNow({ toiPrior: prior.toi, ppPrior: prior.pp, toi: mine.map((g) => g.toi), pp: mine.map((g) => g.pp) });
  };

  // ---- the schedule, and the games each team has played per the same REST
  // stats (the most games any one-club player of the team has): a game
  // started, or over but not in the stats yet, is still left, so nobody
  // loses it until the stats count it.
  const games = (JSON.parse(readFileSync(SCHEDULE, "utf8")) as { games: Array<[string, string, string]> }).games;
  const teamSchedule = new Map<string, number[]>();
  for (const [iso, a, b] of games) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) continue;
    for (const team of [a, b]) {
      if (!teamSchedule.has(team)) teamSchedule.set(team, []);
      teamSchedule.get(team)!.push(t);
    }
  }
  for (const list of teamSchedule.values()) list.sort((x, y) => x - y);
  const teamPlayed = new Map<string, number>();
  for (const live of [...sk.values(), ...gk.values()]) {
    if (!live.oneTeam || !live.team) continue;
    teamPlayed.set(live.team, Math.max(teamPlayed.get(live.team) ?? 0, live.gp));
  }
  const played = (team: string) => {
    const dates = teamSchedule.get(team) ?? [];
    // Never more than the games already started.
    const started = dates.filter((t) => t <= nowMs).length;
    return Math.min(started, teamPlayed.get(team) ?? 0);
  };
  /** Dates of the team's games still to play. */
  const upcomingOf = (team: string) => (teamSchedule.get(team) ?? []).slice(played(team));
  /** Team games played since a date (inclusive), among those counted played. */
  const playedSince = (team: string, sinceMs: number) =>
    (teamSchedule.get(team) ?? []).slice(0, played(team)).filter((t) => t >= sinceMs).length;

  // ---- injuries (ESPN public report), matched by name (+ team)
  type Inj = { status: string; returnDate: string | null; note: string | null; team: string; since: string | null };
  const injByName = new Map<string, Inj[]>();
  try {
    const espn = await getJson<{
      injuries: Array<{ injuries: Array<{ status: string; date?: string; shortComment?: string; details?: { returnDate?: string; type?: string }; athlete: { displayName: string; team?: { abbreviation?: string } } }> }>;
    }>("https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries");
    const ESPN_TEAM: Record<string, string> = { TB: "TBL", NJ: "NJD", SJ: "SJS", LA: "LAK", UTAH: "UTA", NAS: "NSH", MON: "MTL", WAS: "WSH" };
    for (const t of espn.injuries) {
      for (const i of t.injuries) {
        const key = fold(i.athlete.displayName);
        const abbr = i.athlete.team?.abbreviation ?? "";
        const list = injByName.get(key) ?? [];
        list.push({
          status: i.status,
          returnDate: i.details?.returnDate ?? null,
          note: i.details?.type ?? null,
          team: ESPN_TEAM[abbr] ?? abbr,
          since: i.date ? i.date.slice(0, 10) : null,
        });
        injByName.set(key, list);
      }
    }
  } catch (err) {
    console.warn(`WARN: injury report unavailable (${(err as Error).message}); no injury adjustment today`);
  }
  const injuryOf = (name: string, team: string): Inj | null => {
    const list = injByName.get(fold(name));
    if (!list?.length) return null;
    return list.find((i) => i.team === team) ?? (list.length === 1 ? list[0]! : null);
  };

  // ---- newcomers: NHL games this season, no pre-season projection
  const baseIds = new Set(base.players.map((p) => p.id));
  const newcomerIds = [...sk.keys(), ...gk.keys()].filter((id) => !baseIds.has(id) && ((sk.get(id) ?? gk.get(id))!.gp > 0));
  const debutOf = new Map<number, number>();
  for (const id of newcomerIds) {
    const first = usageByPlayer.get(id)?.[0];
    if (first) debutOf.set(id, Date.parse(`${first.date}T00:00:00Z`));
  }
  for (const id of newcomerIds.filter((x) => !debutOf.has(x)).slice(0, MAX_NEWCOMER_LOOKUPS)) {
    try {
      const log = await getJson<{ gameLog?: Array<{ gameDate: string }> }>(
        `https://api-web.nhle.com/v1/player/${id}/game-log/${SEASON_ID}/2`,
      );
      const first = (log.gameLog ?? []).map((g) => Date.parse(`${g.gameDate}T00:00:00Z`)).filter(Number.isFinite).sort((a, b) => a - b)[0];
      if (first != null) debutOf.set(id, first);
    } catch {
      /* debut unknown: his team's games so far are used */
    }
  }
  const newcomers: Player[] = newcomerIds.map((id) => {
    const live = (sk.get(id) ?? gk.get(id))!;
    const isGoalie = gk.has(id) && !sk.has(id);
    const projection: Record<string, number> = {};
    let gamesPlayed: number;
    if (isGoalie) {
      gamesPlayed = NEWCOMER_GOALIE.share * SEASON_GAMES;
      projection.wins = NEWCOMER_GOALIE.wins * gamesPlayed;
      projection.shutouts = NEWCOMER_GOALIE.shutouts * gamesPlayed;
      projection.saves = NEWCOMER_GOALIE.shotsAgainstPerGame * NEWCOMER_GOALIE.savePct * gamesPlayed;
      projection.savePct = NEWCOMER_GOALIE.savePct;
    } else if (usageByPlayer.has(id)) {
      // The role his club gives him: rates and share from his ice time.
      const pos = live.position === "D" ? "D" : "F";
      const u = usageOf(id, false);
      gamesPlayed = newcomerShare(pos, u.toi ?? 0) * SEASON_GAMES;
      const rates = newcomerRates(pos, u.toi ?? 0, u.pp ?? 0);
      for (const stat of USAGE_STATS) projection[stat] = rates[stat] * gamesPlayed;
    } else {
      gamesPlayed = NEWCOMER_SHARE_PRIOR * SEASON_GAMES;
      const per82 = NEWCOMER_PER82[live.position === "D" ? "D" : "F"];
      for (const [stat, v] of Object.entries(per82)) projection[stat] = (v * gamesPlayed) / SEASON_GAMES;
    }
    return {
      id,
      name: live.name,
      team: live.team,
      position: live.position,
      positions: [live.position],
      primaryPosition: live.position,
      isGoalie,
      gamesPlayed,
      projection,
      projectionMethod: "contextual",
      confidence: 0.4,
      newcomer: true,
    };
  });
  const players = [...base.players, ...newcomers];

  // ---- pass 1: each player's remaining games. His share of his team's
  // games is the pre-season one updated by the games he has played; an
  // injury takes out the games his team plays before his return (the games
  // of the current absence are left out of the share update: the injury
  // already accounts for them).
  let updated = 0;
  let injured = 0;
  const plan = new Map<number, { team: string; left: number; inj: Inj | null; gamesOut: number; share: number; ros: number }>();
  for (const b of players) {
    const live = b.isGoalie ? gk.get(b.id) : sk.get(b.id);
    const team = live?.team || currentById.get(b.id)?.team || b.team;
    const upcoming = upcomingOf(team);
    const left = upcoming.length;
    const inj = injuryOf(b.name, team);
    const sinceMs = inj?.since ? Date.parse(`${inj.since}T00:00:00Z`) : NaN;
    const missedSoFar = inj && Number.isFinite(sinceMs) ? playedSince(team, sinceMs) : null;
    let gamesOut = 0;
    if (inj) {
      const ret = inj.returnDate ? Date.parse(`${inj.returnDate}T12:00:00Z`) : NaN;
      gamesOut = Number.isFinite(ret)
        ? upcoming.filter((t) => t < ret).length
        : Math.min(left, defaultGamesOut(inj.status, missedSoFar));
      injured++;
    }
    const gp = live?.gp ?? 0;
    const isNew = b.newcomer === true;
    const teamGames = isNew
      ? (() => {
          const debut = debutOf.get(b.id);
          return debut != null ? Math.max(gp, playedSince(team, debut)) : Math.max(gp, played(team));
        })()
      : Math.max(gp, played(team) - (gamesOut > 0 ? (missedSoFar ?? 0) : 0));
    // A skater's share: the team games he dressed for (recent ones weigh
    // more, completed long absences left out, the current reported one
    // too), × his ice-time ratio^η, × a decay over the games he has missed
    // in a row since (not reported hurt: sent down, scratched). Goalies, and
    // everyone when the game-by-game report is missing: the season totals.
    const teamIds = statsTeamGames.get(team);
    const share = isNew
      ? b.isGoalie
        ? updatedGameShare(NEWCOMER_GOALIE.share, gp, teamGames, NEWCOMER_SHARE_K)
        : updatedGameShare(usageByPlayer.has(b.id) ? b.gamesPlayed / SEASON_GAMES : NEWCOMER_SHARE_PRIOR, gp, teamGames, NEWCOMER_SHARE_K)
      : !b.isGoalie && hasUsage && teamIds?.length
        ? gamesShareNow(
            b.gamesPlayed / SEASON_GAMES,
            trimCurrentAbsence(playedFlags(teamIds, usageByPlayer.get(b.id) ?? [], team), gamesOut > 0 ? (missedSoFar ?? 0) : 0),
            usageOf(b.id, true),
          )
        : updatedGameShare(b.gamesPlayed / SEASON_GAMES, gp, teamGames, b.isGoalie ? GOALIE_SHARE_K : SKATER_SHARE_K);
    plan.set(b.id, { team, left, inj, gamesOut, share, ros: Math.max(0, left - gamesOut) * share });
  }
  // A team still dresses a goalie every game: the starts a hurt goalie
  // misses go to his healthy teammates, the n° 2 first (a day-to-day
  // listing that costs no game is healthy).
  const goaliesByTeam = new Map<string, Player[]>();
  for (const b of players) {
    if (!b.isGoalie) continue;
    const t = plan.get(b.id)!.team;
    if (!goaliesByTeam.has(t)) goaliesByTeam.set(t, []);
    goaliesByTeam.get(t)!.push(b);
  }
  for (const [team, list] of goaliesByTeam) {
    const left = upcomingOf(team).length;
    const extra = redistributeGoalieStarts(
      list.map((g) => ({ id: g.id, share: plan.get(g.id)!.share, gamesOut: plan.get(g.id)!.gamesOut })),
      left,
    );
    for (const [id, n] of extra) plan.get(id)!.ros += n;
  }

  // ---- pass 2: to date + rest of season
  const out: Player[] = players.map((b) => {
    const live = b.isGoalie ? gk.get(b.id) : sk.get(b.id);
    const { team, left, inj, gamesOut, ros: rosGames } = plan.get(b.id)!;
    const gp = live?.gp ?? 0;
    const isNew = b.newcomer === true;
    const proj: Record<string, number> = { ...b.projection };
    const gp0 = Math.max(1, b.gamesPlayed);
    let usage: Usage | null = null;
    if (!b.isGoalie && isNew) {
      // Newcomer: his role-based prior (or the flat one), his own games K 10.
      const k = usageByPlayer.has(b.id) ? NEWCOMER_USAGE_K : NEWCOMER_RATE_K;
      for (const stat of Object.keys(SKATER_RATE_K)) {
        const actual = live?.stats[stat] ?? 0;
        proj[stat] = r1(actual + shrinkRate((b.projection[stat] ?? 0) / gp0, k, actual, gp) * rosGames);
      }
      if (usageByPlayer.has(b.id)) usage = usageOf(b.id, false);
    } else if (!b.isGoalie) {
      // Role-adjusted prior, shrunk toward his season; goals = shots × regressed shooting %.
      usage = usageOf(b.id, true);
      const prior = {} as Record<UsageStat, number>;
      const totals = {} as Record<UsageStat, number>;
      for (const stat of USAGE_STATS) {
        prior[stat] = (b.projection[stat] ?? 0) / gp0;
        totals[stat] = live?.stats[stat] ?? 0;
      }
      const rates = restOfSeasonRates({ prior, totals, gp, usage });
      for (const stat of USAGE_STATS) proj[stat] = r1(totals[stat] + rates[stat] * rosGames);
    } else {
      const s = live?.stats ?? { wins: 0, shutouts: 0, saves: 0, shotsAgainst: 0 };
      const sv0 = b.projection.savePct ?? 0.9;
      const sa0 = sv0 < 1 ? (b.projection.saves ?? 0) / sv0 / gp0 : 0;
      const sv = shrinkRate(sv0, GOALIE_K.savePctShots, s.saves, s.shotsAgainst);
      const saPerGame = shrinkRate(sa0, GOALIE_K.shotsAgainstPerGame, s.shotsAgainst, gp);
      const wPerGame = shrinkRate((b.projection.wins ?? 0) / gp0, GOALIE_K.wins, s.wins, gp);
      const soPerGame = shrinkRate((b.projection.shutouts ?? 0) / gp0, GOALIE_K.shutouts, s.shutouts, gp);
      proj.wins = r1(s.wins + wPerGame * rosGames);
      proj.shutouts = r1(s.shutouts + soPerGame * rosGames);
      proj.saves = Math.round(s.saves + sv * saPerGame * rosGames);
      proj.savePct = Math.round(sv * 10000) / 10000;
    }
    if (live) updated++;
    const totalGp = Math.round(gp + rosGames);
    const prev = isNew ? undefined : currentById.get(b.id);
    const { newcomer: _n, ...rest } = b;
    return {
      ...(prev ?? rest),
      team,
      gamesPlayed: totalGp,
      projection: proj,
      inSeason: {
        asOf: now.toISOString(),
        gp,
        stats: live?.stats ?? {},
        teamLeft: left,
        rosGames: r1(rosGames),
        injury: inj ? { status: inj.status, returnDate: inj.returnDate, gamesOut, note: inj.note, since: inj.since } : null,
        ...(isNew ? { newcomer: true as const } : {}),
        ...(usage && usage.toi != null && usageByPlayer.has(b.id)
          ? { usage: { toi: r1(usage.toi), pp: r1(usage.pp ?? 0), toiRatio: Math.round(usage.toiRatio * 100) / 100, ppRatio: Math.round(usage.ppRatio * 100) / 100 } }
          : {}),
      },
    };
  });

  const file = { ...current, players: out, inSeasonAt: now.toISOString() };
  writeFileSync(PLAYERS, `${JSON.stringify(file)}\n`);
  console.log(
    `OK: in-season projections for ${out.length} players (${updated} with ${SEASON_ID} stats, ${newcomers.length} newcomers${newcomers.length ? `: ${newcomers.slice(0, 8).map((p) => p.name).join(", ")}${newcomers.length > 8 ? "…" : ""}` : ""}, ${injured} injured, ${games.length} scheduled games, ${teamSchedule.size} teams, ${usageByPlayer.size} skaters with game-by-game ice time) → src/data/players.json`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
