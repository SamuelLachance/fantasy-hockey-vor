/**
 * Market consensus for the projection backtest: ESPN's public pre-season
 * fantasy-hockey projections (and draft ADP) for every season ESPN still
 * serves (2017-18 onward), mapped onto NHL player ids.
 *
 * Source: the public, unauthenticated ESPN fantasy JSON
 *   lm-api-reads.fantasy.espn.com/apis/v3/games/fhl/seasons/{Y}/segments/0/
 *   leaguedefaults/1?view=kona_player_info
 * one request per season, >= 1.2 s apart, descriptive User-Agent, cached
 * on disk (--cache=<dir>, re-used when present). No login, no cookies.
 *
 * Stat ids (checked against each season's actual totals): 13 G, 14 A,
 * 29 SOG, 31 HIT, 32 BLK, 38 PPP, 17 PIM, 34 GP; goalies 30 GP, 0 GS, 1 W,
 * 3 SA, 4 GA, 6 SV, 7 SO. Projections are the stored season projection
 * (statSourceId 1, split 0): pre-season numbers (Connor McDavid 2024-25: 80
 * GP projected, 67 played), so a fair market benchmark.
 *
 * Players are matched to the ML dataset by folded name and F / D / G group
 * among the players of the season or the one before (the current season:
 * src/data/player-profiles.json). Ambiguous names are left out.
 *
 * Usage: npx tsx scripts/build-espn-market.ts --cache=<dir> [--fetch]
 *   writes src/data/ml/market-espn.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { foldSearchText } from "../src/lib/search-fold";
import type { MlDataset } from "../src/lib/ml/types";

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const UA =
  "fantasy-hockey-vor-backtest/1.0 (personal projection backtest; public JSON only)";
/** ESPN season year Y = NHL season (Y-1)-Y. 2017 and earlier: 404. */
const ESPN_SEASONS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027];

export interface MarketSkater {
  id: number;
  gp: number;
  goals: number;
  assists: number;
  shots: number;
  hits: number;
  blocks: number;
  powerplayPoints: number;
  penaltyMinutes: number;
  adp: number | null;
}
export interface MarketGoalie {
  id: number;
  gp: number;
  gs: number;
  wins: number;
  shotsAgainst: number;
  goalsAgainst: number;
  saves: number;
  shutouts: number;
  adp: number | null;
}
export interface MarketFile {
  builtAt: string;
  source: string;
  /** NHL season id -> ESPN's pre-season projections. */
  seasons: Record<string, { skaters: MarketSkater[]; goalies: MarketGoalie[]; unmatched: number }>;
}

interface EspnPlayer {
  player: {
    fullName: string;
    defaultPositionId: number;
    ownership?: { averageDraftPosition?: number };
    stats?: Array<{ statSourceId: number; statSplitTypeId: number; seasonId: number; stats?: Record<string, number> }>;
  };
}

async function fetchSeason(cache: string, year: number, allowFetch: boolean): Promise<{ players: EspnPlayer[] } | null> {
  const f = join(cache, `kona-player-info-${year}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  if (!allowFetch) return null;
  await new Promise((r) => setTimeout(r, 1200));
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fhl/seasons/${year}/segments/0/leaguedefaults/1?view=kona_player_info`;
  const filter = { players: { limit: 1500, sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "STANDARD" } } };
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA, "X-Fantasy-Filter": JSON.stringify(filter) },
  });
  if (!res.ok) {
    console.warn(`ESPN ${year}: HTTP ${res.status}`);
    return null;
  }
  const body = await res.text();
  writeFileSync(f, body);
  return JSON.parse(body);
}

const fold = (s: string) => foldSearchText(s).replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
const groupOfEspn = (pos: number): "F" | "D" | "G" => (pos === 5 ? "G" : pos === 4 ? "D" : "F");
const groupOfNhl = (pos: string, isGoalie: boolean): "F" | "D" | "G" => (isGoalie ? "G" : pos === "D" ? "D" : "F");

async function main() {
  const cache = arg("cache");
  if (!cache) throw new Error("--cache=<dir> required (raw ESPN responses)");
  mkdirSync(cache, { recursive: true });
  const ds = JSON.parse(readFileSync(join(process.cwd(), "src", "data", "ml", "dataset.json"), "utf8")) as MlDataset;
  const profiles = JSON.parse(readFileSync(join(process.cwd(), "src", "data", "player-profiles.json"), "utf8")) as {
    profiles: Array<{ id: number; name: string; position: string; isGoalie: boolean }>;
  };
  // Candidates per NHL season: (folded name, group) -> ids of players in season T-1 or T.
  const out: MarketFile = {
    builtAt: new Date().toISOString(),
    source: "ESPN public fantasy hockey JSON (kona_player_info), pre-season projections statSourceId 1",
    seasons: {},
  };
  for (const year of ESPN_SEASONS) {
    const raw = await fetchSeason(cache, year, process.argv.includes("--fetch"));
    if (!raw) continue;
    const seasonId = (year - 1) * 10000 + year;
    const prev = seasonId - 10001;
    const cand = new Map<string, Set<number>>();
    const add = (name: string, g: string, id: number) => {
      const k = `${fold(name)}|${g}`;
      const s = cand.get(k) ?? new Set<number>();
      s.add(id);
      cand.set(k, s);
    };
    for (const r of ds.rows) {
      if (r.seasonId === seasonId || r.seasonId === prev) add(r.name, groupOfNhl(r.position, r.isGoalie), r.playerId);
    }
    if (!ds.seasonIds.includes(seasonId)) {
      for (const p of profiles.profiles) add(p.name, groupOfNhl(p.position, p.isGoalie), p.id);
    }
    const skaters: MarketSkater[] = [];
    const goalies: MarketGoalie[] = [];
    let unmatched = 0;
    for (const p of raw.players) {
      const proj = p.player.stats?.find((s) => s.statSourceId === 1 && s.statSplitTypeId === 0 && s.seasonId === year)?.stats;
      if (!proj) continue;
      const g = groupOfEspn(p.player.defaultPositionId);
      const ids = cand.get(`${fold(p.player.fullName)}|${g}`);
      if (!ids || ids.size !== 1) {
        unmatched++;
        continue;
      }
      const id = [...ids][0];
      const adpRaw = p.player.ownership?.averageDraftPosition;
      const adp = adpRaw != null && adpRaw > 0 && adpRaw < 250 ? Math.round(adpRaw * 10) / 10 : null;
      const v = (k: number) => Number(proj[String(k)] ?? 0);
      if (g === "G") {
        if (!(v(30) > 0)) continue;
        goalies.push({ id, gp: v(30), gs: v(0), wins: v(1), shotsAgainst: v(3), goalsAgainst: v(4), saves: v(6), shutouts: v(7), adp });
      } else {
        if (!(v(34) > 0)) continue;
        skaters.push({
          id,
          gp: v(34),
          goals: v(13),
          assists: v(14),
          shots: v(29),
          hits: v(31),
          blocks: v(32),
          powerplayPoints: v(38),
          penaltyMinutes: v(17),
          adp,
        });
      }
    }
    out.seasons[String(seasonId)] = { skaters, goalies, unmatched };
    console.log(`${seasonId}: ${skaters.length} skaters, ${goalies.length} goalies projected, ${unmatched} unmatched`);
  }
  const path = join(process.cwd(), "src", "data", "ml", "market-espn.json");
  writeFileSync(path, JSON.stringify(out));
  console.log(`wrote ${path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
