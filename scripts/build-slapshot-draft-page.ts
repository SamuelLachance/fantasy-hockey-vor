/**
 * The stand-alone live draft page of the Slapshot league
 * (`public/slapshot-draft.html`, no Next chunks: it polls fxea itself every
 * 20 s) from its template (`scripts/slapshot-draft/template.html`) and the
 * SAME numbers the site's Repêchage tab shows: season points and points
 * over replacement from the league's values.json (`seasonFp`, `leagueVor`),
 * the dynasty value per horizon, rank, phase and contract seasons from its
 * dynasty.json. `npm run build:pages` runs it before `next build` (so the
 * deployed page always matches the deployed dynasty.json), and so does the
 * Slapshot sync; by hand:
 *
 *   npx tsx scripts/build-slapshot-draft-page.ts
 *
 * Deterministic: the same committed inputs give the same bytes (check-export
 * compares the embedded build time with the published dynasty.json).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { fantraxLeague, parseGroups } from "../src/lib/fantrax/config";
import { seasonFp } from "../src/lib/fantrax/draft-inputs";
import { leagueVor } from "../src/lib/fantrax/points-vor";
import type { PoolSnapshot } from "../src/lib/fantrax/pool";
import type { LeagueSnapshot, ValuesSnapshot } from "../src/lib/fantrax/snapshot-types";
import type { SlapshotRecord } from "../src/lib/dynasty/slapshot";
import type { NhlListedPlayer, NhlRostersFile } from "../src/lib/nhl-rosters";
import { normalizeTeamAbbrev } from "../src/lib/team-abbreviations";
import type { SlapZeroContract } from "./dynasty-slapshot";
import { fantraxPaths } from "./fantrax-paths";

const ROOT = process.cwd();
const CFG = fantraxLeague("slapshot");
const P = fantraxPaths(CFG, ROOT);
const TEMPLATE = join(ROOT, "scripts", "slapshot-draft", "template.html");
const OUT = join(ROOT, "public", "slapshot-draft.html");

const read = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const r1 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 10) / 10);
/** Cap hits keep their two decimals (the page prints 2 below 10 M$, like the tab). */
const r2 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 100) / 100);

interface PageRow {
  i: string;
  n: string;
  t: string;
  e: string;
  p: number | null;
  v: number | null;
  /** Cap hit 2026-27 and 2027-28 (M$, 2 dp: what the page shows; the page reads `c` = the first). */
  c2?: Array<number | null> | null;
  /** Signed seasons from 2026-27, first unsigned season (null: signed through the horizon), status then (U / R). */
  y?: number | null;
  x?: number | null;
  st?: "U" | "R" | null;
  dB?: number | null;
  dL?: number | null;
  dW?: number | null;
  rB?: number | null;
  rL?: number | null;
  rW?: number | null;
  ph?: string;
}

type Contract = Pick<SlapshotRecord["contract"], "cap" | "signed" | "expiry" | "status">;

/**
 * The NHL club shown for a player: Fantrax's, unless it has none ((N/A):
 * unsigned rights, AHL, junior) or a club's own roster or prospect list
 * (nhl-rosters.json, fetched daily) puts him elsewhere; then the NHL's
 * (verifier 2026-09-28: 24 organisation players read a blank club, so a
 * search by club missed them, and four read a club they had left). The
 * search index's club alone (« org ») never overrides Fantrax's.
 */
export function pageTeam(fantraxTeam: string, listed: Pick<NhlListedPlayer, "team" | "list"> | undefined): string {
  const fx = fantraxTeam && !fantraxTeam.startsWith("(") ? fantraxTeam : "";
  if (!listed?.team) return fx;
  const nhl = normalizeTeamAbbrev(listed.team);
  if (!fx) return nhl;
  return listed.list !== "org" && nhl !== normalizeTeamAbbrev(fx) ? nhl : fx;
}

function setContract(row: PageRow, c: Contract): void {
  row.c2 = c.cap.slice(0, 2).map((x) => r2(x));
  row.y = c.signed;
  row.x = c.expiry;
  row.st = c.status === "UFA" ? "U" : c.status === "RFA" ? "R" : null;
}

export function buildSlapshotDraftPage(): { rows: number; withDynasty: number; bytes: number } {
  const league = read<LeagueSnapshot>(P.league);
  const values = read<ValuesSnapshot>(P.values);
  const pool = read<PoolSnapshot>(P.pool);
  const dyn = read<{
    builtAt: string;
    season: string;
    params: { cap: { league: number[] }; repl: { season: Record<string, number> } };
    players: Record<string, SlapshotRecord>;
    zero?: string[];
    zeroContracts?: Record<string, SlapZeroContract>;
  }>(P.dynasty);
  const vor = leagueVor(CFG, values.players, (id) => seasonFp(values.players[id]!, CFG), league.slotCounts);
  const listed = new Map(read<NhlRostersFile>(P.nhlRosters).players.map((x) => [x.id, x] as const));

  const rows = new Map<string, PageRow>();
  for (const r of pool.players) {
    const groups = parseGroups(r.pos, CFG);
    if (!groups.length) continue;
    const v = values.players[r.id];
    const projected = v?.src === "proj";
    rows.set(r.id, {
      i: r.id,
      n: r.n,
      t: pageTeam(r.t, r.nhl != null ? listed.get(r.nhl) : undefined),
      e: groups.join("/"),
      p: projected ? Math.round(seasonFp(v!, CFG)) : null,
      v: projected && vor?.has(r.id) ? Math.round(vor.get(r.id)!) : null,
    });
  }
  for (const [id, d] of Object.entries(dyn.players)) {
    let row = rows.get(id);
    if (!row) {
      const e = d.pos.join("/");
      if (!e) continue;
      row = { i: id, n: d.n, t: pageTeam("", d.nhlId ? listed.get(d.nhlId) : undefined), e, p: null, v: null };
      rows.set(id, row);
    }
    setContract(row, d.contract);
    row.dB = r1(d.dv.balanced);
    row.dL = r1(d.dv.longTerm);
    row.dW = r1(d.dv.winNow);
    row.rB = d.rank.balanced;
    row.rL = d.rank.longTerm;
    row.rW = d.rank.winNow;
    row.ph = d.phase;
  }
  // Zero-value players (modeled, below the published threshold): value 0,
  // no rank, and their real cap hit (a late pick still counts it).
  for (const id of dyn.zero ?? []) {
    const row = rows.get(id);
    if (!row) continue;
    row.dB = 0;
    row.dL = 0;
    row.dW = 0;
    const c = dyn.zeroContracts?.[id];
    if (c) setContract(row, c);
  }
  // Null fields are left out (the page reads a missing one as « — »): with
  // every NHL-organisation player listed, most rows have no season projection.
  const board = [...rows.values()]
    .sort((a, b) => (b.dB ?? -1e9) - (a.dB ?? -1e9) || (b.v ?? -1e9) - (a.v ?? -1e9))
    .map((r) => Object.fromEntries(Object.entries(r).filter(([, x]) => x != null)) as PageRow);
  const cap = dyn.params.cap.league[0]!;
  const data = {
    builtAt: dyn.builtAt,
    dynastyBuiltAt: dyn.builtAt,
    firstSeason: Number(dyn.season.slice(0, 4)),
    cap,
    repl: dyn.params.repl.season,
    teams: Object.fromEntries(league.teams.map((t) => [t.id, t.name])),
    board,
  };
  // `<` inside a JSON script would let a name close the element: escape it.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const built = new Date(dyn.builtAt);
  const builtFr = `valeurs du ${built.toISOString().slice(0, 10)}`;
  const html = readFileSync(TEMPLATE, "utf8")
    .replace(/\r\n/g, "\n")
    .replace("__DATA__", json)
    .replace("__CAP__", String(cap))
    .replace("__BUILT__", builtFr);
  writeFileAtomic(OUT, html);
  return { rows: board.length, withDynasty: board.filter((r) => r.dB != null).length, bytes: Buffer.byteLength(html) };
}

if (/build-slapshot-draft-page\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  const r = buildSlapshotDraftPage();
  console.log(`OK: public/slapshot-draft.html — ${r.rows} players (${r.withDynasty} with dynasty values), ${Math.round(r.bytes / 1024)} KB`);
}
