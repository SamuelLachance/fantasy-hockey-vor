/**
 * The stand-alone live draft page of the Slapshot league
 * (`public/slapshot-draft.html`, no Next chunks: it polls fxea itself every
 * 20 s) from its template (`scripts/slapshot-draft/template.html`) and the
 * SAME numbers the site's Repêchage tab shows: season points and points
 * over replacement from the league's values.json (`seasonFp`, `leagueVor`),
 * the dynasty value per horizon, rank, phase and contract seasons from its
 * dynasty.json. Run after a Slapshot sync / dynasty build:
 *
 *   npx tsx scripts/build-slapshot-draft-page.ts
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
import { fantraxPaths } from "./fantrax-paths";

const ROOT = process.cwd();
const CFG = fantraxLeague("slapshot");
const P = fantraxPaths(CFG, ROOT);
const TEMPLATE = join(ROOT, "scripts", "slapshot-draft", "template.html");
const OUT = join(ROOT, "public", "slapshot-draft.html");

const read = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const r1 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 10) / 10);

interface PageRow {
  i: string;
  n: string;
  t: string;
  e: string;
  p: number | null;
  v: number | null;
  c?: number | null;
  c4?: Array<number | null> | null;
  y?: number | null;
  x?: number | null;
  dB?: number | null;
  dL?: number | null;
  dW?: number | null;
  rB?: number | null;
  rL?: number | null;
  ph?: string;
}

export function buildSlapshotDraftPage(): { rows: number; withDynasty: number; bytes: number } {
  const league = read<LeagueSnapshot>(P.league);
  const values = read<ValuesSnapshot>(P.values);
  const pool = read<PoolSnapshot>(P.pool);
  const dyn = read<{ builtAt: string; params: { cap: { league: number[] }; repl: { season: Record<string, number> } }; players: Record<string, SlapshotRecord> }>(
    P.dynasty,
  );
  const vor = leagueVor(CFG, values.players, (id) => seasonFp(values.players[id]!, CFG), league.slotCounts);

  const rows = new Map<string, PageRow>();
  for (const r of pool.players) {
    const groups = parseGroups(r.pos, CFG);
    if (!groups.length) continue;
    const v = values.players[r.id];
    const projected = v?.src === "proj";
    rows.set(r.id, {
      i: r.id,
      n: r.n,
      t: r.t,
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
      row = { i: id, n: d.n, t: "", e, p: null, v: null };
      rows.set(id, row);
    }
    const c = d.contract;
    row.c = c.cap[0] ?? null;
    row.c4 = c.cap.slice(0, 4).map((x) => r1(x));
    row.y = c.signed;
    row.x = c.expiry;
    row.dB = r1(d.dv.balanced);
    row.dL = r1(d.dv.longTerm);
    row.dW = r1(d.dv.winNow);
    row.rB = d.rank.balanced;
    row.rL = d.rank.longTerm;
    row.ph = d.phase;
  }
  const board = [...rows.values()].sort((a, b) => (b.dB ?? -1e9) - (a.dB ?? -1e9) || (b.v ?? -1e9) - (a.v ?? -1e9));
  const cap = dyn.params.cap.league[0]!;
  const data = {
    builtAt: dyn.builtAt,
    dynastyBuiltAt: dyn.builtAt,
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
