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
 * A stat ESPN did not publish for a season is stored as null, never 0: ESPN
 * omits a zero stat from a player's line, so an absent key means 0 only when
 * the season publishes that stat (at least half the projected players carry
 * a non-zero value). Unpublished: hits and blocks in 2017-18 and 2018-19,
 * blocks in 2019-20, goalie games in 2021-22 and 2022-23 (those goalies are
 * left out: no per-game rates without games).
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

/** A projected stat; null when ESPN did not publish it that season. */
export type MarketStat = number | null;
export interface MarketSkater {
  id: number;
  gp: number;
  goals: MarketStat;
  assists: MarketStat;
  shots: MarketStat;
  hits: MarketStat;
  blocks: MarketStat;
  powerplayPoints: MarketStat;
  penaltyMinutes: MarketStat;
  adp: number | null;
}
export interface MarketGoalie {
  id: number;
  gp: number;
  gs: MarketStat;
  wins: MarketStat;
  shotsAgainst: MarketStat;
  goalsAgainst: MarketStat;
  saves: MarketStat;
  shutouts: MarketStat;
  adp: number | null;
}
export interface MarketFile {
  builtAt: string;
  source: string;
  /** NHL season id -> ESPN's pre-season projections. */
  seasons: Record<
    string,
    {
      skaters: MarketSkater[];
      goalies: MarketGoalie[];
      unmatched: number;
      /** Stat ids ESPN did not publish that season (stored as null). */
      unpublished?: { skaters: number[]; goalies: number[] };
    }
  >;
}

const SKATER_STAT_IDS = [34, 13, 14, 29, 31, 32, 38, 17];
const GOALIE_STAT_IDS = [30, 0, 1, 3, 4, 6, 7];

/**
 * Stat ids a season does not publish: fewer than half of the projected
 * players carry a non-zero value (ESPN drops zero stats from a line, so a
 * published stat is non-zero for nearly everyone; an unpublished one is
 * absent or 0 for all but stray lines, 1 of 277 in 2018-19).
 */
export function unpublishedStats(lines: Array<Record<string, number>>, ids: number[]): number[] {
  if (lines.length === 0) return [];
  return ids.filter((k) => lines.filter((l) => Number(l[String(k)] ?? 0) > 0).length < 0.5 * lines.length);
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
    const projOf = (p: EspnPlayer) =>
      p.player.stats?.find((s) => s.statSourceId === 1 && s.statSplitTypeId === 0 && s.seasonId === year)?.stats;
    const linesOf = (goalie: boolean) =>
      raw.players
        .filter((p) => (p.player.defaultPositionId === 5) === goalie)
        .map(projOf)
        .filter((x): x is Record<string, number> => Boolean(x));
    const missing = {
      skaters: unpublishedStats(linesOf(false), SKATER_STAT_IDS),
      goalies: unpublishedStats(linesOf(true), GOALIE_STAT_IDS),
    };
    for (const p of raw.players) {
      const proj = projOf(p);
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
      const gone = g === "G" ? missing.goalies : missing.skaters;
      const v = (k: number): MarketStat => (gone.includes(k) ? null : Number(proj[String(k)] ?? 0));
      if (g === "G") {
        if (!((v(30) ?? 0) > 0)) continue;
        goalies.push({ id, gp: v(30)!, gs: v(0), wins: v(1), shotsAgainst: v(3), goalsAgainst: v(4), saves: v(6), shutouts: v(7), adp });
      } else {
        if (!((v(34) ?? 0) > 0)) continue;
        skaters.push({
          id,
          gp: v(34)!,
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
    out.seasons[String(seasonId)] = { skaters, goalies, unmatched, unpublished: missing };
    console.log(
      `${seasonId}: ${skaters.length} skaters, ${goalies.length} goalies projected, ${unmatched} unmatched; ` +
        `unpublished skater stats [${missing.skaters.join(",")}] goalie stats [${missing.goalies.join(",")}]`,
    );
  }
  const path = join(process.cwd(), "src", "data", "ml", "market-espn.json");
  writeFileSync(path, JSON.stringify(out));
  console.log(`wrote ${path}`);
}

if (process.argv[1]?.endsWith("build-espn-market.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
