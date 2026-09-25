/**
 * CI guard for the public Snake files (public/snake/*, src/data/snake-summary.json,
 * src/data/snake-version.json): structure, cross-file consistency, size
 * budgets and the public-safety rules (no uncertain attribution, no
 * extraction notes, no quotes, no transcript-derived fields, every opinion
 * deep-links to its video), plus the /snake page contract.
 *
 * Local extras:
 * - with the source DB present: no opinion with an uncertain attribution was
 *   published, and a warning when any committed file differs from a fresh
 *   `npm run snake:build`;
 * - with SNAKE_TRANSCRIPTS_DIR set (local transcripts, never committed):
 *   the verbatim guard fails on any published text sharing 10+ consecutive
 *   words with its episode's captions.
 * Run: npx tsx scripts/check-snake-data.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { buildSnakePublicData, type SourceDb } from "../src/lib/snake/build";
import {
  EXTRACTION_NOTE_RE,
  NAME_INFERRED_RE,
  UNCERTAIN_ATTRIBUTION_RE,
  isStance,
  isTrend,
} from "../src/lib/snake/sanitize";
import { snakeShardFile, snakeShardOf } from "../src/lib/snake/shard";
import type {
  SnakeFantraxFile,
  SnakeIndexFile,
  SnakeListRow,
  SnakeNhlFile,
  SnakeRankingsFile,
  SnakeRow,
  SnakeShardFile,
  SnakeSummaryFile,
  SnakeVersionFile,
} from "../src/lib/snake/types";
import { findVerbatimRuns, VERBATIM_MAX_RUN } from "../src/lib/snake/verbatim";
import {
  SNAKE_SOURCE_REL,
  loadSnakeContext,
  publicSnakeBodies,
  readPublicSnakeBodies,
  snakeContentVersion,
  transcriptGrams,
} from "./snake-io";

const root = process.cwd();
const pub = join(root, "public", "snake");
const errors: string[] = [];
const warnings: string[] = [];
const fail = (m: string) => errors.push(m);

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) {
    fail(`missing ${path.replace(root, ".")}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (e) {
    fail(`${path.replace(root, ".")} is not JSON: ${(e as Error).message}`);
    return null;
  }
}

const BUDGET = {
  "index.json": 900_000,
  shard: 400_000,
  "rankings.json": 300_000,
  "nhl.json": 80_000,
  "fantrax.json": 250_000,
  "snake-summary.json": 350_000,
};
function budget(path: string, max: number) {
  if (existsSync(path) && statSync(path).size > max) {
    fail(`${path.replace(root, ".")} is ${statSync(path).size} B (budget ${max} B)`);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VID_RE = /^[\w-]{11}$/;
const QUOTES_RE = /[«»“”"]/;
const FORBIDDEN_FIELDS = ["spellings", "snakeRole", "notes", "transcript", "attribution", "nameConfidence", "opinionFr", "url"];
/** Fields of the slim index row (the full row lives in the shard). */
const LIST_FIELDS = ["k", "n", "pos", "tm", "fx", "v", "td", "s", "oc", "ls", "pr", "dv", "m"] as const;

/** Every string value in `v` (deep). */
function* strings(v: unknown): Generator<string> {
  if (typeof v === "string") yield v;
  else if (Array.isArray(v)) for (const x of v) yield* strings(x);
  else if (v && typeof v === "object") for (const x of Object.values(v)) yield* strings(x);
}
function* keysDeep(v: unknown): Generator<string> {
  if (Array.isArray(v)) for (const x of v) yield* keysDeep(x);
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      yield k;
      yield* keysDeep(x);
    }
  }
}
function paraphraseFields(label: string, texts: Array<string | null | undefined>) {
  for (const t of texts) {
    if (!t) continue;
    if (QUOTES_RE.test(t)) fail(`${label}: quotation marks in a paraphrase: ${t.slice(0, 80)}`);
    if (UNCERTAIN_ATTRIBUTION_RE.test(t)) fail(`${label}: mentions uncertain-attribution material: ${t.slice(0, 80)}`);
    if (EXTRACTION_NOTE_RE.test(t) || NAME_INFERRED_RE.test(t)) fail(`${label}: extraction note in public text: ${t.slice(0, 80)}`);
  }
}

// ---- index (slim rows)
const index = readJson<SnakeIndexFile>(join(pub, "index.json"));
budget(join(pub, "index.json"), BUDGET["index.json"]);
const listRows = new Map<string, SnakeListRow>();
if (index) {
  if (index.v !== 1 || !Array.isArray(index.rows) || !Array.isArray(index.shows)) fail("index.json: bad header");
  if (!Number.isInteger(index.shardCount) || index.shardCount < 1) fail("index.json: bad shardCount");
  for (const r of index.rows) {
    const label = `index ${r.k}`;
    if (listRows.has(r.k)) fail(`${label}: duplicate key`);
    listRows.set(r.k, r);
    for (const k of Object.keys(r)) if (!(LIST_FIELDS as readonly string[]).includes(k)) fail(`${label}: unexpected field "${k}" in the slim index`);
    if (!r.n?.trim()) fail(`${label}: no name`);
    if (!isStance(r.v)) fail(`${label}: bad verdict`);
    if (!isTrend(r.td)) fail(`${label}: bad trend`);
    if (!r.s?.trim() || r.s.length > 300) fail(`${label}: summary empty or over 300 characters`);
    if (!(r.oc > 0)) fail(`${label}: bad count`);
    if (!DATE_RE.test(r.ls)) fail(`${label}: bad last seen`);
    if (!Array.isArray(r.m) || r.m.length !== r.oc * 2) fail(`${label}: mention list length`);
    else for (let i = 0; i < r.m.length; i += 2) if (!index.shows[r.m[i]!]) fail(`${label}: unknown show index`);
    paraphraseFields(label, [r.s]);
  }
  for (const [from, to] of Object.entries(index.aliases ?? {})) {
    if (listRows.has(from)) fail(`alias ${from} is also a row`);
    if (!listRows.has(to)) fail(`alias ${from} → unknown ${to}`);
  }
  const s = index.stats;
  if (s.players !== index.rows.length) fail("stats.players != rows");
  if (s.opinions !== index.rows.reduce((n, r) => n + r.oc, 0)) fail("stats.opinions != sum of rows");
  if (s.byShow.some((b) => b.show === "Invité")) fail("stats.byShow: guest spots must name their host program");
}

// ---- shards (full rows + timelines)
const rows = new Map<string, SnakeRow>();
if (index) {
  const files = existsSync(join(pub, "o")) ? readdirSync(join(pub, "o")).sort() : [];
  const expected = Array.from({ length: index.shardCount }, (_, i) => snakeShardFile(i).slice(2));
  if (JSON.stringify(files) !== JSON.stringify(expected)) fail(`public/snake/o: expected ${expected.length} shard files, found ${files.length}`);
  const shardAliases = new Map<string, string>();
  let probableTotal = 0;
  for (let i = 0; i < index.shardCount; i++) {
    const path = join(pub, snakeShardFile(i));
    const shard = readJson<SnakeShardFile>(path);
    budget(path, BUDGET.shard);
    if (!shard) continue;
    for (const k of keysDeep(shard)) if (FORBIDDEN_FIELDS.includes(k)) fail(`${snakeShardFile(i)}: forbidden field "${k}"`);
    for (const [vid, v] of Object.entries(shard.videos)) {
      if (!VID_RE.test(vid) || !DATE_RE.test(v[0]) || !v[1] || !v[2]) fail(`${snakeShardFile(i)}: bad video ${vid}`);
      if (v[1] === "Invité") fail(`${snakeShardFile(i)}: video ${vid} shows "Invité" instead of its program`);
    }
    for (const [from, to] of Object.entries(shard.aliases ?? {})) {
      if (snakeShardOf(from, index.shardCount) !== i) fail(`alias ${from} in the wrong shard`);
      shardAliases.set(from, to);
    }
    for (const [k, entry] of Object.entries(shard.players)) {
      const label = `shard ${k}`;
      if (snakeShardOf(k, index.shardCount) !== i) fail(`${label}: in shard ${i}, belongs to ${snakeShardOf(k, index.shardCount)}`);
      const lr = listRows.get(k);
      if (!lr) {
        fail(`${label}: not in the index`);
        continue;
      }
      const r = entry.r;
      rows.set(k, r);
      for (const f of LIST_FIELDS) {
        if (f === "m" || f === "s") continue;
        if (JSON.stringify(r[f]) !== JSON.stringify(lr[f])) fail(`${label}: "${f}" differs from the index`);
      }
      if (!r.s.replace(/\s+/g, " ").startsWith(lr.s.replace(/…$/, ""))) fail(`${label}: index summary is not a prefix of the row's`);
      if (!isStance(r.l)) fail(`${label}: bad latest stance`);
      if (r.vc < 1 || r.vc > r.oc || r.pc < 0 || r.pc > r.oc) fail(`${label}: bad counts`);
      if (!!r.pr !== (r.pc === r.oc)) fail(`${label}: probable flag disagrees with counts`);
      if (!DATE_RE.test(r.fs) || r.fs > r.ls) fail(`${label}: bad first/last seen`);
      if (r.nhl !== null && !(Number.isInteger(r.nhl) && r.nhl >= 8_000_000)) fail(`${label}: bad NHL id`);
      if (r.dv && (!r.sd || !DATE_RE.test(r.sd))) fail(`${label}: stand-in row without its opinion date`);
      if (r.dv && r.tr) fail(`${label}: both withheld and trimmed`);
      if (r.dv && r.x) fail(`${label}: stand-in row with nuances`);
      paraphraseFields(label, [r.s, r.x, r.pj, ...r.f, ...r.w, ...r.c]);
      if (entry.o.length !== r.oc) fail(`${label}: ${entry.o.length} opinions, row says ${r.oc}`);
      if (entry.o.filter((o) => o.p === 1).length !== r.pc) fail(`${label}: probable count differs`);
      probableTotal += r.pc;
      // A stand-in row reads as certain unless every opinion is probable.
      if (r.dv && !r.pr && !entry.o.some((o) => !o.p && o.d === r.sd && o.o === r.s)) {
        fail(`${label}: stand-in summary is not a certain opinion`);
      }
      let prev = "9999-99-99";
      for (const o of entry.o) {
        if (!VID_RE.test(o.vid) || !shard.videos[o.vid]) fail(`${label}: opinion without its video (${o.vid})`);
        if (!DATE_RE.test(o.d) || o.d > prev) fail(`${label}: timeline not newest first`);
        prev = o.d;
        if (!Number.isInteger(o.t) || o.t < 0) fail(`${label}: bad deep-link second`);
        if (o.ts?.some((t) => !(t > 0) || t === o.t)) fail(`${label}: bad extra passages`);
        if (!isStance(o.st) || !o.o?.trim()) fail(`${label}: bad opinion`);
        if (o.p !== undefined && o.p !== 1) fail(`${label}: bad probable flag`);
        paraphraseFields(label, [o.o, o.cx, o.pj, ...o.f, ...o.w, ...o.c, ...o.rk.map((x) => x[1])]);
      }
    }
  }
  if (rows.size !== listRows.size) fail(`shards hold ${rows.size} players, index has ${listRows.size}`);
  if (JSON.stringify([...shardAliases].sort()) !== JSON.stringify(Object.entries(index.aliases ?? {}).sort())) {
    fail("shard aliases differ from index.aliases");
  }
  if (index.stats.probableOpinions !== probableTotal) fail("stats.probableOpinions != sum of rows");
}

// ---- identity: a row's Fantrax id is that NHL player's (committed id map)
{
  const ids = (JSON.parse(readFileSync(join(root, "src", "data", "fantrax", "nhl-ids.json"), "utf8")) as { ids: Record<string, number> }).ids ?? {};
  const fxOfNhl = new Map(Object.entries(ids).map(([fx, id]) => [id, fx]));
  for (const r of rows.values()) {
    if (r.fx && ids[r.fx] !== undefined && r.nhl !== null && ids[r.fx] !== r.nhl) {
      fail(`row ${r.k}: Fantrax ${r.fx} is NHL ${ids[r.fx]}, row says ${r.nhl}`);
    }
    // The id map grows with each league sync: a new mapping is a rebuild away.
    if (r.nhl !== null && fxOfNhl.has(r.nhl) && fxOfNhl.get(r.nhl) !== r.fx) {
      warnings.push(`row ${r.k}: NHL ${r.nhl} is Fantrax ${fxOfNhl.get(r.nhl)} in the id map, row says ${r.fx} (npm run snake:build)`);
    }
  }
}

// ---- rankings
const rankings = readJson<SnakeRankingsFile>(join(pub, "rankings.json"));
budget(join(pub, "rankings.json"), BUDGET["rankings.json"]);
if (rankings && index) {
  if (rankings.rankings.length !== index.stats.rankings) fail("rankings count != stats.rankings");
  const seen = new Set<string>();
  for (const r of rankings.rankings) {
    const id = `${r.vid}-${r.ti}`;
    if (seen.has(id)) fail(`ranking ${id} duplicated`);
    seen.add(id);
    if (!VID_RE.test(r.vid) || !DATE_RE.test(r.d) || !r.sh || !r.ti || !r.vt || !(r.t >= 0)) fail(`ranking ${id}: bad fields`);
    if (r.sh === "Invité") fail(`ranking ${id}: shows "Invité" instead of its program`);
    if (r.u !== undefined && r.u !== 1) fail(`ranking ${id}: bad unordered flag`);
    if (!r.e.length) fail(`ranking ${id}: empty`);
    for (const [rank, name, key] of r.e) {
      if (!(Number.isInteger(rank) && rank > 0) || !name) fail(`ranking ${id}: bad entry`);
      if (key !== null && !rows.has(key)) fail(`ranking ${id}: entry links unknown ${key}`);
    }
    paraphraseFields(`ranking ${id}`, [r.ti]);
  }
}

// ---- lookups + summary
const nhl = readJson<SnakeNhlFile>(join(pub, "nhl.json"));
budget(join(pub, "nhl.json"), BUDGET["nhl.json"]);
if (nhl && index) {
  for (const [id, [key, v, td, p]] of Object.entries(nhl.rows)) {
    const r = rows.get(key);
    if (!r || String(r.nhl) !== id || r.v !== v || r.td !== td || p !== (r.pr ? 1 : 0)) fail(`nhl.json ${id}: disagrees with the rows`);
  }
  const withNhl = new Set([...rows.values()].filter((r) => r.nhl).map((r) => r.nhl));
  if (withNhl.size !== Object.keys(nhl.rows).length) fail("nhl.json: not one entry per NHL id");
}
const fx = readJson<SnakeFantraxFile>(join(pub, "fantrax.json"));
budget(join(pub, "fantrax.json"), BUDGET["fantrax.json"]);
if (fx && index) {
  for (const [id, [key, v, td, line, p]] of Object.entries(fx.rows)) {
    const r = rows.get(key);
    if (!r || r.fx !== id || r.v !== v || r.td !== td || typeof line !== "string" || p !== (r.pr ? 1 : 0)) {
      fail(`fantrax.json ${id}: disagrees with the rows`);
    }
    paraphraseFields(`fantrax.json ${id}`, [line]);
  }
}
const summaryPath = join(root, "src", "data", "snake-summary.json");
const summary = readJson<SnakeSummaryFile>(summaryPath);
budget(summaryPath, BUDGET["snake-summary.json"]);
if (summary && index) {
  if (JSON.stringify(summary.stats) !== JSON.stringify(index.stats)) fail("snake-summary.json: stats differ from index.json");
  if (summary.builtAt !== index.builtAt) fail("snake-summary.json: builtAt differs from index.json");
  if (Object.keys(summary.rows).length !== rows.size) fail("snake-summary.json: row count differs");
  for (const [id, key] of Object.entries(summary.fx)) if (rows.get(key)?.fx !== id) fail(`summary fx ${id} → ${key} wrong`);
  for (const [id, key] of Object.entries(summary.nhl)) if (String(rows.get(key)?.nhl) !== id) fail(`summary nhl ${id} → ${key} wrong`);
}

// ---- cache buster = content hash of the files actually committed
const version = readJson<SnakeVersionFile>(join(root, "src", "data", "snake-version.json"));
const onDisk = readPublicSnakeBodies(root);
if (version && version.v !== snakeContentVersion(onDisk)) {
  fail("src/data/snake-version.json does not match public/snake (run npm run snake:build)");
}

// ---- public-safety scan of every public file
for (const [label, data] of [
  ["index.json", index],
  ["rankings.json", rankings],
  ["fantrax.json", fx],
  ["snake-summary.json", summary],
] as const) {
  if (!data) continue;
  for (const k of keysDeep(data)) if (FORBIDDEN_FIELDS.includes(k)) fail(`${label}: forbidden field "${k}"`);
  for (const s of strings(data)) {
    if (UNCERTAIN_ATTRIBUTION_RE.test(s)) fail(`${label}: uncertain-attribution material: ${s.slice(0, 80)}`);
  }
}

// ---- the raw source DB stays local
const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
if (!gitignore.split(/\r?\n/).includes("/src/data/scouting/snake-boisvert.json")) {
  fail(".gitignore must keep the raw source DB (/src/data/scouting/snake-boisvert.json) out of the repo");
}

// ---- page contract
const page = readFileSync(join(root, "src", "app", "snake", "page.tsx"), "utf8");
for (const needle of ["robots: { index: false", 'canonical: "/snake"', "SnakeDisclaimerShort", "SnakeMethodology", 'lang="fr-CA"']) {
  if (!page.includes(needle)) fail(`src/app/snake/page.tsx missing ${JSON.stringify(needle)}`);
}
const item = readFileSync(join(root, "src", "components", "snake", "SnakeOpinionItem.tsx"), "utf8");
for (const needle of ["youtubeHref(o.vid, o.t)", 'rel="noopener noreferrer"', "SnakeProbableMark", "formatSnakeDate(o.d)", "{show}"]) {
  if (!item.includes(needle)) fail(`SnakeOpinionItem.tsx missing ${JSON.stringify(needle)}`);
}
for (const rel of [
  "src/components/snake/ExpandedPlayerSnake.tsx",
  "src/components/league/LeagueDaily.tsx",
  "src/components/snake/SnakePlayerDetail.tsx",
  "src/components/snake/SnakeBoardLegend.tsx",
]) {
  if (!existsSync(join(root, rel)) || !readFileSync(join(root, rel), "utf8").includes("SnakeDisclaimerShort")) {
    fail(`${rel} must show the Snake disclaimer`);
  }
}

// ---- up to date with the local source DB (skipped when absent, e.g. in CI)
const sourcePath = join(root, SNAKE_SOURCE_REL);
let freshness = "source DB absent: freshness not checked";
if (existsSync(sourcePath) && index) {
  const db = JSON.parse(readFileSync(sourcePath, "utf8")) as SourceDb;
  const out = buildSnakePublicData(db, { ...loadSnakeContext(root), shardCount: index.shardCount });
  // Stale is a warning, not a failure: a local league:sync (new Fantrax ids)
  // or projections run also shifts it, and the safety checks above still hold.
  const fresh = publicSnakeBodies(out);
  const staleFiles = [...new Set([...fresh.keys(), ...onDisk.keys()])].filter((k) => fresh.get(k) !== onDisk.get(k));
  const summaryStale = `${JSON.stringify(out.summary)}\n` !== readFileSync(summaryPath, "utf8");
  if (summaryStale) staleFiles.push("snake-summary.json");
  if (staleFiles.length) {
    warnings.push(`public Snake files differ from the local source DB (${staleFiles.slice(0, 5).join(", ")}${staleFiles.length > 5 ? "…" : ""}): run npm run snake:build`);
  }
  for (const c of out.report.unusedCorrections) warnings.push(`correction ${c} matches no source opinion`);
  // Belt and braces: no uncertain opinion text made it into a shard.
  const uncertain = new Set<string>();
  for (const p of db.players) for (const o of p.opinions) if (o.attribution !== "certain" && o.attribution !== "probable") uncertain.add(`${o.videoId}|${o.opinionFr.trim()}`);
  for (let i = 0; i < index.shardCount; i++) {
    const shard = JSON.parse(onDisk.get(snakeShardFile(i)) ?? "{}") as Partial<SnakeShardFile>;
    for (const e of Object.values(shard.players ?? {})) {
      for (const o of e.o) if (uncertain.has(`${o.vid}|${o.o.trim()}`)) fail(`shard ${i}: an uncertain opinion was published (${o.vid})`);
    }
  }
  freshness = staleFiles.length ? "STALE vs the local source DB" : "up to date with the local source DB";
}

// ---- verbatim guard (local transcripts only)
let verbatim = "verbatim guard skipped (no SNAKE_TRANSCRIPTS_DIR)";
const grams = transcriptGrams(process.env.SNAKE_TRANSCRIPTS_DIR);
if (grams && index) {
  const shards = Array.from({ length: index.shardCount }, (_, i) => JSON.parse(onDisk.get(snakeShardFile(i)) ?? '{"players":{}}') as SnakeShardFile);
  const hits = findVerbatimRuns({ shards, rankings: rankings ?? { v: 1, builtAt: "", rankings: [] } }, grams);
  for (const h of hits) fail(`verbatim: ${h.where} shares ${h.length} words with the captions: ${h.run}`);
  verbatim = `verbatim guard: no text shares ${VERBATIM_MAX_RUN}+ words with its captions`;
}

for (const w of warnings.slice(0, 20)) console.warn(`WARN: ${w}`);
if (errors.length) {
  for (const e of errors.slice(0, 50)) console.error(`FAIL: ${e}`);
  if (errors.length > 50) console.error(`… and ${errors.length - 50} more`);
  process.exit(1);
}
console.log(
  `OK: snake data (${rows.size} players, ${index?.stats.opinions} opinions, ${index?.shardCount} shards, ${rankings?.rankings.length} rankings; ${freshness}; ${verbatim})`,
);
