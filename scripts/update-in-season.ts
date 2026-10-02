/**
 * In-season projections, run every day (league-daily.yml / deploy-pages.yml):
 * each player's season projection becomes what he has done so far plus the
 * rest of his season, from
 *
 * - his pre-season projection (src/data/players-preseason.json, frozen the
 *   first time this runs): per-game rates and expected share of his team's
 *   games;
 * - this season's NHL stats to date (api.nhle.com stats REST, public):
 *   each per-game rate is updated by shrinkage — (prior × K + actual) /
 *   (K + games played), K per stat (how many games before a stat speaks for
 *   itself) — so a hot or cold week moves it a little, a season a lot;
 * - the remaining schedule (public/fantrax/schedule-20262027.json): his
 *   team's games left;
 * - current injuries and their estimated return dates (ESPN's public injury
 *   report): the games his team plays before his return are taken out of
 *   his remaining games; a status without a date gets a typical absence.
 *
 * Writes src/data/players.json (same shape; `gamesPlayed` and `projection`
 * are the full-season totals, actual + rest of season; `inSeason` holds the
 * to-date line, the injury and the date). Public unauthenticated GETs only,
 * ≥ 1.1 s apart, descriptive User-Agent.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const UA = "fantasy-hockey-vor (personal read-only helper; github.com/SamuelLachance/fantasy-hockey-vor)";
const SEASON_ID = "20262027";
const root = process.cwd();
const PLAYERS = join(root, "src", "data", "players.json");
const BASELINE = join(root, "src", "data", "players-preseason.json");
const SCHEDULE = join(root, "public", "fantrax", "schedule-20262027.json");
const SEASON_GAMES = 82;

/** Games before a stat's season rate weighs as much as the pre-season one. */
// Close to the games it takes each per-game rate to stabilise in the NHL
// (shots, hits and blocks are skills that show early; goals ride on
// shooting luck and need well over a season).
const K: Record<string, number> = {
  goals: 120,
  assists: 100,
  powerplayPoints: 120,
  shots: 40,
  hits: 40,
  blocks: 50,
  penaltyMinutes: 80,
  faceoffWins: 30,
};
/** Goalies: games for wins / shutouts, shots against for the save percentage. */
const K_GOALIE_GAMES = 30;
const K_GOALIE_SHOTS = 1500;
/** Most of his team's remaining games a goalie can start when a teammate is hurt. */
const GOALIE_MAX_SHARE = 0.8;
/** Typical absence (team games) when the report gives no return date. */
const DEFAULT_OUT: Record<string, number> = { "Day-To-Day": 1, Out: 6, "Injured Reserve": 12, Suspension: 3 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function getJson<T>(url: string): Promise<T> {
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
}

async function main() {
  const now = new Date();
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
  const sk = new Map<number, { gp: number; team: string; stats: Record<string, number> }>();
  for (const r of summary) {
    const id = Number(r.playerId);
    const x = rt.get(id);
    const f = fo.get(id);
    const teams = String(r.teamAbbrevs ?? "").split(",");
    sk.set(id, {
      gp: Number(r.gamesPlayed) || 0,
      team: teams[teams.length - 1]!.trim(),
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
  const gk = new Map<number, { gp: number; team: string; stats: Record<string, number> }>();
  for (const r of goalies) {
    const teams = String(r.teamAbbrevs ?? "").split(",");
    gk.set(Number(r.playerId), {
      gp: Number(r.gamesPlayed) || 0,
      team: teams[teams.length - 1]!.trim(),
      stats: {
        wins: Number(r.wins) || 0,
        shutouts: Number(r.shutouts) || 0,
        saves: Number(r.saves) || 0,
        shotsAgainst: Number(r.shotsAgainst) || 0,
      },
    });
  }

  // ---- the schedule: games each team has left, and their dates
  const games = (JSON.parse(readFileSync(SCHEDULE, "utf8")) as { games: Array<[string, string, string]> }).games;
  const upcoming = new Map<string, number[]>();
  for (const [iso, a, b] of games) {
    const t = Date.parse(iso);
    if (!(t > nowMs)) continue;
    for (const team of [a, b]) {
      if (!upcoming.has(team)) upcoming.set(team, []);
      upcoming.get(team)!.push(t);
    }
  }
  for (const list of upcoming.values()) list.sort((x, y) => x - y);

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
  const injuryOf = (p: Player, team: string): Inj | null => {
    const list = injByName.get(fold(p.name));
    if (!list?.length) return null;
    return list.find((i) => i.team === team) ?? (list.length === 1 ? list[0]! : null);
  };

  // ---- pass 1: each player's remaining games (an injury takes out the
  // games his team plays before his return)
  let updated = 0;
  let injured = 0;
  const plan = new Map<number, { team: string; left: number; inj: Inj | null; gamesOut: number; ros: number }>();
  for (const b of base.players) {
    const live = b.isGoalie ? gk.get(b.id) : sk.get(b.id);
    const team = live?.team || currentById.get(b.id)?.team || b.team;
    const left = upcoming.get(team)?.length ?? 0;
    const share = Math.max(0, Math.min(1, b.gamesPlayed / SEASON_GAMES));
    const inj = injuryOf(b, team);
    let gamesOut = 0;
    if (inj) {
      const ret = inj.returnDate ? Date.parse(`${inj.returnDate}T12:00:00Z`) : NaN;
      gamesOut = Number.isFinite(ret)
        ? (upcoming.get(team) ?? []).filter((t) => t < ret).length
        : Math.min(left, DEFAULT_OUT[inj.status] ?? 3);
      injured++;
    }
    plan.set(b.id, { team, left, inj, gamesOut, ros: Math.max(0, left - gamesOut) * share });
  }
  // A team still dresses a goalie every game: the starts an injured goalie
  // misses go to his healthy teammates (each up to GOALIE_MAX_SHARE of the
  // games left).
  const goaliesByTeam = new Map<string, Player[]>();
  for (const b of base.players) {
    if (!b.isGoalie) continue;
    const t = plan.get(b.id)!.team;
    if (!goaliesByTeam.has(t)) goaliesByTeam.set(t, []);
    goaliesByTeam.get(t)!.push(b);
  }
  for (const [team, list] of goaliesByTeam) {
    const left = upcoming.get(team)?.length ?? 0;
    if (!left) continue;
    const missing = list.reduce((s, g) => s + Math.min(plan.get(g.id)!.gamesOut, left) * Math.min(1, g.gamesPlayed / SEASON_GAMES), 0);
    const healthy = list.filter((g) => !plan.get(g.id)!.inj);
    const room = healthy.reduce((s, g) => s + Math.max(0, GOALIE_MAX_SHARE * left - plan.get(g.id)!.ros), 0);
    if (!(missing > 0) || !(room > 0)) continue;
    const k = Math.min(1, missing / room);
    for (const g of healthy) {
      const p = plan.get(g.id)!;
      p.ros += k * Math.max(0, GOALIE_MAX_SHARE * left - p.ros);
    }
  }

  // ---- pass 2: to date + rest of season
  const out: Player[] = base.players.map((b) => {
    const live = b.isGoalie ? gk.get(b.id) : sk.get(b.id);
    const { team, left, inj, gamesOut, ros: rosGames } = plan.get(b.id)!;
    const gp = live?.gp ?? 0;
    const proj: Record<string, number> = { ...b.projection };
    const gp0 = Math.max(1, b.gamesPlayed);
    if (!b.isGoalie) {
      for (const [stat, k] of Object.entries(K)) {
        const prior = (b.projection[stat] ?? 0) / gp0;
        const actual = live?.stats[stat] ?? 0;
        const rate = (prior * k + actual) / (k + gp);
        proj[stat] = r1(actual + rate * rosGames);
      }
    } else {
      const s = live?.stats ?? { wins: 0, shutouts: 0, saves: 0, shotsAgainst: 0 };
      const sv0 = b.projection.savePct ?? 0.9;
      const sa0 = sv0 < 1 ? (b.projection.saves ?? 0) / sv0 / gp0 : 0;
      const sv = (sv0 * K_GOALIE_SHOTS + s.saves) / (K_GOALIE_SHOTS + s.shotsAgainst);
      const saPerGame = (sa0 * K_GOALIE_GAMES + s.shotsAgainst) / (K_GOALIE_GAMES + gp);
      const wPerGame = (((b.projection.wins ?? 0) / gp0) * K_GOALIE_GAMES + s.wins) / (K_GOALIE_GAMES + gp);
      const soPerGame = (((b.projection.shutouts ?? 0) / gp0) * K_GOALIE_GAMES + s.shutouts) / (K_GOALIE_GAMES + gp);
      proj.wins = r1(s.wins + wPerGame * rosGames);
      proj.shutouts = r1(s.shutouts + soPerGame * rosGames);
      proj.saves = Math.round(s.saves + sv * saPerGame * rosGames);
      proj.savePct = Math.round(sv * 10000) / 10000;
    }
    if (live) updated++;
    const totalGp = Math.round(gp + rosGames);
    const prev = currentById.get(b.id);
    return {
      ...(prev ?? b),
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
      },
    };
  });

  const file = { ...current, players: out, inSeasonAt: now.toISOString() };
  writeFileSync(PLAYERS, `${JSON.stringify(file)}\n`);
  console.log(
    `OK: in-season projections for ${out.length} players (${updated} with ${SEASON_ID} stats, ${injured} injured, ${games.length} scheduled games, ${upcoming.size} teams) → src/data/players.json`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
