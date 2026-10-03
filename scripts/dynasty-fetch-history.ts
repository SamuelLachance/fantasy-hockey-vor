/* eslint-disable @typescript-eslint/no-explicit-any -- raw public NHL API JSON, trimmed on read */
/**
 * Fetch (or complete) the prospect history the dynasty backtests and the
 * prospect model need: every NHL draft class's picks (api-web draft picks)
 * and, for every drafted skater, his NHL player landing (seasonTotals:
 * junior, NCAA, European and AHL seasons, height, weight, draft details).
 *
 * The NHL id of a pick is not in the draft feed. It comes from (1) a landing
 * already cached whose draftDetails name the same draft year and overall
 * pick, (2) the dynasty history file's draftees (players with NHL games), or
 * (3) the public player search (search.d3.nhle.com), each candidate's
 * landing checked against the draft year and pick (no name-only match).
 * Never-NHL picks are found too, so the prospect fit is not trained on the
 * survivors alone.
 *
 * Polite: public unauthenticated endpoints only, one request at a time,
 * >= 1.15 s apart, descriptive User-Agent, exponential back-off on 429/5xx.
 * Resumable: every response is cached (landing/<id>.json in the trimmed
 * format below, draft/draft_<year>.json, search/<hash>.json), so a rerun only
 * fetches what is missing.
 *
 * Run: npx tsx scripts/dynasty-fetch-history.ts --cache <dir> [--hist <hist.json>]
 *        [--from 2008] [--to 2026] [--goalies]
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";

const args = process.argv.slice(2);
const arg = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const CACHE = (arg("--cache") ?? process.env.DYNASTY_CACHE ?? "") as string;
if (!CACHE) {
  console.error("dynasty-fetch-history: --cache <dir> is required");
  process.exit(2);
}
const FROM = Number(arg("--from") ?? 2008);
const TO = Number(arg("--to") ?? 2026);
const GOALIES = args.includes("--goalies");
const HIST = arg("--hist");
const UA = "fantasy-hockey-vor dynasty backtest (personal read-only helper; github.com/SamuelLachance/fantasy-hockey-vor)";
const GAP_MS = 1150;

for (const d of ["landing", "draft", "search"]) mkdirSync(join(CACHE, d), { recursive: true });

let last = 0;
let requests = 0;
async function get(url: string): Promise<unknown | null> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    requests++;
    let res: Response | null = null;
    try {
      res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA } });
    } catch {
      res = null;
    }
    if (res && res.status === 404) return null;
    if (!res || res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, Math.min(120_000, 5_000 * 2 ** attempt)));
      continue;
    }
    if (!res.ok) return null;
    return res.json();
  }
  return null;
}

export interface LandingLite {
  playerId: number;
  firstName?: string;
  lastName?: string;
  position?: string;
  birthDate?: string;
  heightInInches?: number;
  weightInPounds?: number;
  shootsCatches?: string;
  draftDetails?: { year: number; overallPick: number; round?: number; pickInRound?: number; teamAbbrev?: string } | null;
  isActive?: boolean;
  currentTeamAbbrev?: string | null;
  seasonTotals: { season: number; league: string; gt: number; gp: number; g?: number; a?: number; p?: number; team?: string }[];
  error?: number;
}

function trim(j: Record<string, any>): LandingLite {
  return {
    playerId: j.playerId,
    firstName: j.firstName?.default,
    lastName: j.lastName?.default,
    position: j.position,
    birthDate: j.birthDate,
    heightInInches: j.heightInInches,
    weightInPounds: j.weightInPounds,
    shootsCatches: j.shootsCatches,
    draftDetails: j.draftDetails ?? null,
    isActive: j.isActive,
    currentTeamAbbrev: j.currentTeamAbbrev ?? null,
    seasonTotals: (j.seasonTotals ?? []).map((s: Record<string, any>) => ({
      season: s.season,
      league: s.leagueAbbrev,
      gt: s.gameTypeId,
      gp: s.gamesPlayed,
      g: s.goals,
      a: s.assists,
      p: s.points,
      team: s.teamName?.default,
    })),
  };
}

const landingPath = (id: number) => join(CACHE, "landing", `${id}.json`);
async function landing(id: number): Promise<LandingLite | null> {
  const f = landingPath(id);
  if (existsSync(f)) {
    const j = JSON.parse(readFileSync(f, "utf8")) as LandingLite;
    return j.error ? null : j;
  }
  const j = (await get(`https://api-web.nhle.com/v1/player/${id}/landing`)) as Record<string, any> | null;
  if (!j) {
    writeFileSync(f, JSON.stringify({ playerId: id, error: 404, seasonTotals: [] }));
    return null;
  }
  const t = trim(j);
  writeFileSync(f, JSON.stringify(t));
  return t;
}

async function draftClass(y: number): Promise<any[]> {
  const f = join(CACHE, "draft", `draft_${y}.json`);
  if (!existsSync(f)) {
    const j = await get(`https://api-web.nhle.com/v1/draft/picks/${y}/all`);
    if (!j) return [];
    writeFileSync(f, JSON.stringify(j));
  }
  return (JSON.parse(readFileSync(f, "utf8")) as { picks: any[] }).picks;
}

async function search(q: string): Promise<{ playerId: string; name: string; positionCode: string; heightInInches?: number }[]> {
  const h = createHash("sha1").update(q).digest("hex").slice(0, 16);
  const f = join(CACHE, "search", `${h}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8")).r;
  const url = `https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=20&q=${encodeURIComponent(q)}&active=false`;
  const r = ((await get(url)) as any[] | null) ?? [];
  const lite = r.map((x) => ({ playerId: String(x.playerId), name: x.name, positionCode: x.positionCode, heightInInches: x.heightInInches }));
  writeFileSync(f, JSON.stringify({ q, r: lite }));
  return lite;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .trim();

async function main() {
  // (1) known ids: cached landings by (draft year, pick), the history's draftees
  const byPick = new Map<string, number>();
  for (const f of readdirSync(join(CACHE, "landing"))) {
    const j = JSON.parse(readFileSync(join(CACHE, "landing", f), "utf8")) as LandingLite;
    if (j.error || !j.draftDetails) continue;
    byPick.set(`${j.draftDetails.year}-${j.draftDetails.overallPick}`, j.playerId);
  }
  if (HIST) {
    const h = JSON.parse(readFileSync(HIST, "utf8")) as { draftees: { year: number; pick: number; id: number | null }[] };
    for (const d of h.draftees) if (d.id != null && !byPick.has(`${d.year}-${d.pick}`)) byPick.set(`${d.year}-${d.pick}`, d.id);
  }
  const index: { year: number; pick: number; pos: string; name: string; height: number | null; weight: number | null; league: string | null; id: number | null }[] = [];
  let found = 0;
  let missing = 0;
  for (let y = FROM; y <= TO; y++) {
    const picks = await draftClass(y);
    for (const pk of picks) {
      const pos: string = pk.positionCode ?? "";
      if (pos === "G" && !GOALIES) continue;
      const name = `${pk.firstName?.default ?? ""} ${pk.lastName?.default ?? ""}`.trim();
      const key = `${y}-${pk.overallPick}`;
      let id = byPick.get(key) ?? null;
      if (id != null) {
        const l = await landing(id);
        if (!l || (l.draftDetails && (l.draftDetails.year !== y || l.draftDetails.overallPick !== pk.overallPick))) id = null;
      }
      if (id == null && name) {
        const tries = [name, pk.lastName?.default ?? ""].filter(Boolean);
        outer: for (const q of tries) {
          const cands = (await search(q)).filter((c) => (pos === "G") === (c.positionCode === "G"));
          // likeliest first: same folded name, then same height
          cands.sort(
            (a, b) =>
              Number(fold(b.name) === fold(name)) - Number(fold(a.name) === fold(name)) ||
              Math.abs((a.heightInInches ?? 0) - (pk.height ?? 0)) - Math.abs((b.heightInInches ?? 0) - (pk.height ?? 0)),
          );
          for (const c of cands.slice(0, 4)) {
            const l = await landing(Number(c.playerId));
            if (l?.draftDetails && l.draftDetails.year === y && l.draftDetails.overallPick === pk.overallPick) {
              id = l.playerId;
              break outer;
            }
          }
        }
      }
      if (id != null) {
        found++;
        byPick.set(key, id);
      } else missing++;
      index.push({ year: y, pick: pk.overallPick, pos, name, height: pk.height ?? null, weight: pk.weight ?? null, league: pk.amateurLeague ?? null, id });
      if ((found + missing) % 100 === 0) console.log(`${new Date().toISOString()} ${y}: ${found} matched, ${missing} missing, ${requests} requests`);
    }
  }
  writeFileSync(join(CACHE, "draft-index.json"), JSON.stringify({ builtAt: new Date().toISOString(), from: FROM, to: TO, goalies: GOALIES, picks: index }));
  console.log(`done: ${found} matched, ${missing} missing, ${requests} requests → ${join(CACHE, "draft-index.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
