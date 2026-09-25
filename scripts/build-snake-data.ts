/**
 * Bakes the public Snake files from the local source DB
 * (`src/data/scouting/snake-boisvert.json`, built from the automatic
 * captions of Simon « Snake » Boisvert's public podcasts):
 *
 * - public/snake/index.json      one slim row per published player (list page)
 * - public/snake/o/<nn>.json     opinion shards, loaded one player at a time
 * - public/snake/rankings.json   his rankings, newest first
 * - public/snake/nhl.json        NHL id → verdict (board chips)
 * - public/snake/fantrax.json    Fantrax id → verdict + one line (/league)
 * - src/data/snake-summary.json  build-time summary (stats, ids → verdict)
 * - src/data/snake-version.json  content hash of public/snake (cache buster)
 *
 * Public-safety rules (see src/lib/snake/sanitize.ts and corrections.ts):
 * opinions with an uncertain attribution or a doubtful player are never
 * written; players left with nothing are dropped; a synthesis is published
 * only when all its source opinions are; no transcript, caption text,
 * spelling list or extraction note leaves the source DB. The source DB
 * itself stays local (gitignored): it still holds the unpublishable material.
 *
 * With SNAKE_TRANSCRIPTS_DIR set (local transcripts, never committed), it
 * also lists every published text sharing a long run of words with its
 * episode's captions (`npm run check:snake` fails on those).
 *
 * Deterministic: the same source gives byte-identical files.
 * Run: npm run snake:build [-- path/to/snake-boisvert.json]
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { buildSnakePublicData, type SourceDb } from "../src/lib/snake/build";
import { findVerbatimRuns, VERBATIM_MAX_RUN } from "../src/lib/snake/verbatim";
import {
  SNAKE_SOURCE_REL,
  loadSnakeContext,
  publicSnakeBodies,
  snakeContentVersion,
  transcriptGrams,
} from "./snake-io";

const root = process.cwd();
const sourcePath = process.argv[2] ?? join(root, SNAKE_SOURCE_REL);
if (!existsSync(sourcePath)) {
  console.error(`FAIL: source DB not found: ${sourcePath}`);
  process.exit(1);
}

const db = JSON.parse(readFileSync(sourcePath, "utf8")) as SourceDb;
if (!Array.isArray(db.players) || !db.videos || !Array.isArray(db.rankings)) {
  console.error("FAIL: source DB is malformed (players / videos / rankings)");
  process.exit(1);
}

const out = buildSnakePublicData(db, loadSnakeContext(root));
const bodies = publicSnakeBodies(out);
const version = snakeContentVersion(bodies);

const publicDir = join(root, "public", "snake");
const shardDir = join(publicDir, "o");
// Stale shards (e.g. a changed shard count) must not linger.
if (existsSync(shardDir)) {
  for (const f of readdirSync(shardDir)) rmSync(join(shardDir, f), { force: true });
}

const sizes: Record<string, number> = {};
for (const [rel, body] of bodies) {
  writeFileAtomic(join(publicDir, rel), body);
  sizes[rel] = statSync(join(publicDir, rel)).size;
}
const summaryPath = join(root, "src", "data", "snake-summary.json");
writeFileAtomic(summaryPath, `${JSON.stringify(out.summary)}\n`);
sizes["snake-summary.json"] = statSync(summaryPath).size;
writeFileAtomic(join(root, "src", "data", "snake-version.json"), `${JSON.stringify({ v: version })}\n`);

const shardSizes = out.shards.map((_, i) => sizes[`o/${String(i).padStart(2, "0")}.json`]!);
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const s = out.index.stats;
const f = s.filtered;
console.log(
  [
    `OK: snake data from ${sourcePath.replace(root, ".")} (built ${db.builtAt}; version ${version})`,
    `  players  ${s.players} published / ${db.players.length} in source (${f.playersWithoutPublishableOpinion} without a publishable opinion)`,
    `  opinions ${s.opinions} published (${s.probableOpinions} "probable") — dropped: ${f.opinionsUncertainAttribution} uncertain attribution, ${f.opinionsLowNameConfidence} doubtful player, ${f.opinionsInvalid} invalid`,
    `  syntheses withheld ${f.synthesesWithheld}, trimmed to what published opinions support ${f.synthesesTrimmed}; sentences scrubbed ${f.sentencesScrubbed}`,
    `  NHL ids  direct ${out.report.idVia.direct}, via Fantrax ${out.report.idVia.fantrax}, by name ${out.report.idVia.name}, none ${out.report.idVia.none}; duplicate NHL ids ${out.report.duplicateNhl.length}; Fantrax ids fixed ${out.report.identityFixed.length}`,
    `  rankings ${s.rankings} (${out.report.rankingsTimed} timed; ${out.report.rankingEntriesLinked}/${out.report.rankingEntries} entries linked to a player; ${f.rankingsWithheld} withheld: deduced / relayed / unclear)`,
    `  index.json ${kb(sizes["index.json"]!)}, shards ${out.shards.length} × ${kb(Math.min(...shardSizes))}–${kb(Math.max(...shardSizes))} (total ${kb(shardSizes.reduce((a, b) => a + b, 0))})`,
    `  rankings.json ${kb(sizes["rankings.json"]!)}, nhl.json ${kb(sizes["nhl.json"]!)}, fantrax.json ${kb(sizes["fantrax.json"]!)}, snake-summary.json ${kb(sizes["snake-summary.json"]!)}`,
  ].join("\n"),
);
for (const d of out.report.duplicateNhl) {
  console.log(`  merged records of NHL id ${d.nhl}: ${d.keys.join(" + ")} (first key kept, others aliased)`);
}
for (const m of out.report.identityFixed) console.log(`  identity: ${m}`);
for (const c of out.report.unusedCorrections) console.warn(`WARN: correction ${c} matches no source opinion`);

const grams = transcriptGrams(process.env.SNAKE_TRANSCRIPTS_DIR);
if (grams) {
  const hits = findVerbatimRuns(out, grams);
  console.log(`  verbatim guard: ${hits.length} text(s) share ${VERBATIM_MAX_RUN}+ words with their captions`);
  for (const h of hits) console.log(`    ${h.where} [${h.length}]: ${h.run}`);
} else {
  console.log("  verbatim guard: skipped (set SNAKE_TRANSCRIPTS_DIR to the local transcripts)");
}
