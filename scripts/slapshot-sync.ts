/**
 * Slapshot Fantasy League snapshot for the dynasty build: Fantrax positions
 * (eligiblePos per Fantrax id), rosters and draft picks, from the public fxea
 * endpoints (no login): src/data/dynasty/slapshot/pool.json.
 *
 * Run: npx tsx scripts/slapshot-sync.ts            (fetch, ≥ 1 s between calls)
 *      npx tsx scripts/slapshot-sync.ts --from DIR  (DIR/n_getLeagueInfo.json,
 *        n_getTeamRosters.json, n_draft.json already fetched)
 */
import { readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";

export const SLAPSHOT_LEAGUE_ID = "glxjunc7mtxdqi8x";
const OUT = join(process.cwd(), "src", "data", "dynasty", "slapshot", "pool.json");
const UA = "fantasy-hockey-vor/0.1 (personal dynasty research; public fxea endpoints; 1 req/s)";

export interface SlapshotPool {
  fetchedAt: string;
  leagueId: string;
  /** Fantrax id → Slapshot eligible positions ("C,LW"), NHL-relevant ids only (status not "FA" or listed in the universe). */
  pos: Record<string, string>;
  /** team id → Fantrax ids on its roster now. */
  rosters: Record<string, string[]>;
  teamNames: Record<string, string>;
  /** Draft picks made so far: [pick, team id, player id]. */
  picks: Array<[number, string, string]>;
  /** Fantrax id → the league's salary this season (M$, ELC bonuses included), rostered players. */
  salaries?: Record<string, number>;
}

interface LeagueInfo {
  playerInfo: Record<string, { eligiblePos?: string; status?: string }>;
  teamInfo?: Record<string, { name?: string; id?: string }>;
}
interface Rosters {
  rosters: Record<string, { teamName?: string; rosterItems?: Array<{ id: string; salary?: number }> }>;
}
interface Draft {
  draftPicks?: Array<{ pick: number; teamId: string; playerId?: string }>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`https://www.fantrax.com/fxea/general/${path}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const out = (await res.json()) as T;
  await new Promise((r) => setTimeout(r, 1100));
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const fi = args.indexOf("--from");
  const from = fi >= 0 ? args[fi + 1] : null;
  const read = <T>(f: string) => JSON.parse(readFileSync(join(from!, f), "utf8")) as T;
  const info = from ? read<LeagueInfo>("n_getLeagueInfo.json") : await get<LeagueInfo>(`getLeagueInfo?leagueId=${SLAPSHOT_LEAGUE_ID}`);
  const rosters = from ? read<Rosters>("n_getTeamRosters.json") : await get<Rosters>(`getTeamRosters?leagueId=${SLAPSHOT_LEAGUE_ID}`);
  const draft = from ? read<Draft>("n_draft.json") : await get<Draft>(`getDraftResults?leagueId=${SLAPSHOT_LEAGUE_ID}`);
  const snap = slapshotPoolFrom(info, rosters, draft, new Date().toISOString());
  writeSlapshotPool(snap);
}

/**
 * The dynasty build's league snapshot from the three fxea payloads; shared
 * with `npm run league:sync -- --league slapshot`, which already fetched
 * them (so the daily sync makes no extra request).
 */
export function slapshotPoolFrom(info: LeagueInfo, rosters: Rosters, draft: Draft | null, fetchedAt: string): SlapshotPool {
  const pos: Record<string, string> = {};
  for (const [id, p] of Object.entries(info.playerInfo)) if (p.eligiblePos) pos[id] = p.eligiblePos;
  return {
    fetchedAt,
    leagueId: SLAPSHOT_LEAGUE_ID,
    pos: Object.fromEntries(Object.entries(pos).sort((a, b) => a[0].localeCompare(b[0]))),
    rosters: Object.fromEntries(
      Object.entries(rosters.rosters).map(([t, r]) => [t, (r.rosterItems ?? []).map((x) => x.id).sort()]),
    ),
    teamNames: Object.fromEntries(Object.entries(rosters.rosters).map(([t, r]) => [t, r.teamName ?? t])),
    picks: (draft?.draftPicks ?? [])
      .filter((p) => p.playerId)
      .sort((a, b) => a.pick - b.pick)
      .map((p) => [p.pick, p.teamId, p.playerId!]),
    salaries: Object.fromEntries(
      Object.values(rosters.rosters)
        .flatMap((r) => r.rosterItems ?? [])
        .filter((x) => (x.salary ?? 0) > 0)
        .map((x) => [x.id, Math.round(x.salary! / 1e4) / 100] as [string, number])
        .sort((a, b) => a[0].localeCompare(b[0])),
    ),
  };
}

export function writeSlapshotPool(snap: SlapshotPool, out: string = OUT): void {
  writeFileAtomic(out, `${JSON.stringify(snap)}\n`);
  console.log(
    `OK: slapshot pool ${Object.keys(snap.pos).length} positions, ${Object.values(snap.rosters).flat().length} rostered, ${snap.picks.length} picks → ${out}`,
  );
}

// Run only as a script (the sync imports the builder above).
if (/slapshot-sync\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
