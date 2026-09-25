/**
 * Unit checks for Snake's verdicts in the player tables: the compact
 * readers (Fantrax- and NHL-keyed files), the build-time seeds, and the
 * eager stores (fetch at the first subscriber, no idle wait; a complete
 * seed never fetches; the full index only on demand).
 * Run: npx tsx scripts/test-snake-verdicts.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import type { DraftBoard } from "../src/lib/draft/board-types";
import type { DailyPlan } from "../src/lib/fantrax/daily-plan";
import { lookupExtra, parseSnakeIndex } from "../src/lib/fantrax/extras";
import { resetSnakeClientCache } from "../src/lib/snake/client";
import { decodeIdSet, encodeIdSet, snakeFantraxSeed, snakeNhlSeed } from "../src/lib/snake/league-seed";
import type { SnakeFantraxFile, SnakeNhlFile, SnakeSummaryFile } from "../src/lib/snake/types";
import {
  ensureFullSnakeIndex,
  getFullSnakeIndex,
  getFullSnakeStatus,
  getVerdictRows,
  getVerdictStatus,
  resetVerdictStores,
  subscribeFullSnakeIndex,
  subscribeVerdicts,
} from "../src/lib/snake/verdicts";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const eq = (a: unknown, b: unknown, msg: string) =>
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const load = <T>(...parts: string[]) => JSON.parse(readFileSync(join(process.cwd(), ...parts), "utf8")) as T;

// ------------------------------------------------------------ readers (fixtures)

{
  const fx = parseSnakeIndex({ v: 1, rows: { "05wwg": ["fx:05wwg", "très positif", "en hausse", "Une ligne.", 0] } });
  eq(lookupExtra(fx, "05wwg", undefined), { key: "fx:05wwg", verdict: "très positif", trend: "en hausse", summary: "Une ligne." }, "Fantrax-keyed compact row");
  const nhl = parseSnakeIndex({
    v: 1,
    rows: { "8478402": ["nhl:8478402", "positif", "stable", 1], "8470613": ["fx:003tz", "mitigé", "en baisse", 0] },
  });
  eq(lookupExtra(nhl, "zzzzz", 8478402), { key: "nhl:8478402", verdict: "positif", trend: "stable", probable: true }, "NHL-keyed compact row");
  eq(lookupExtra(nhl, "003tz", undefined)?.verdict, "mitigé", "an fx: key also joins by Fantrax id");
  eq(nhl!.verdicts, ["positif", "mitigé"], "verdicts in scale order");
  assert(!nhl!.hasOpinions && !nhl!.hasProjection, "compact files carry no counts or projection");
  eq(parseSnakeIndex({ v: 1, rows: {} }), null, "empty → null");
}

// ------------------------------------------------------------ committed files (invariants only)

const summary = load<SnakeSummaryFile>("src", "data", "snake-summary.json");
const fxFile = load<SnakeFantraxFile>("public", "snake", "fantrax.json");
const nhlFile = load<SnakeNhlFile>("public", "snake", "nhl.json");
{
  const fx = parseSnakeIndex(fxFile);
  const nhl = parseSnakeIndex(nhlFile);
  const full = parseSnakeIndex(load("public", "snake", "index.json"));
  assert(!!fx && fx.byFantrax.size === Object.keys(fxFile.rows).length, "fantrax.json: one record per row");
  assert(!!nhl && nhl.byNhl.size === Object.keys(nhlFile.rows).length, "nhl.json: one record per row");
  assert(!!full && full.hasOpinions, "index.json: opinion counts");
  for (const [id, e] of Object.entries(fxFile.rows).slice(0, 50)) {
    assert(typeof e[0] === "string" && e[0].length > 0 && typeof e[3] === "string", `fantrax.json row ${id} well-formed`);
  }
}

// ------------------------------------------------------------ seeds

{
  const board = load<DraftBoard>("public", "leagues", "light-the-lamp", "board.json");
  const seed = snakeNhlSeed(board.players.map((p) => p.id), summary);
  const expected = board.players.map((p) => String(p.id)).filter((id) => nhlFile.rows[id]).sort();
  eq(Object.keys(seed).sort(), expected, "NHL seed = the board's players Snake discussed (nothing left to fetch)");
  const mismatch = Object.entries(seed).filter(([id, e]) => JSON.stringify(e) !== JSON.stringify(nhlFile.rows[id]));
  eq(mismatch.length, 0, "seed entries = nhl.json's");
  assert(Object.keys(seed).length > 50, `the seed covers many board players (${Object.keys(seed).length})`);
  // The Snake page carries these ids compactly (its « Dans vos ligues » link to the league).
  const packed = encodeIdSet(Object.keys(seed));
  eq([...decodeIdSet(packed)].sort(), Object.keys(seed).sort(), "id set round trip");
  assert(packed.length < Object.keys(seed).join(",").length / 2, `id set is compact (${packed.length} chars)`);
  eq(encodeIdSet([8471214, "8470613", 8471214]), "51jyt.gp", "sorted gaps in base 36, duplicates dropped");
  eq([...decodeIdSet("")], [], "empty set");
  const today = load<DailyPlan>("src", "data", "fantrax", "today.json");
  const fxSeed = snakeFantraxSeed(today, summary);
  assert(Object.entries(fxSeed).every(([id, e]) => JSON.stringify(e) === JSON.stringify(fxFile.rows[id])), "Fantrax seed entries = fantrax.json's");
}

// ------------------------------------------------------------ stores

{
  const src = readFileSync(join(process.cwd(), "src", "lib", "snake", "verdicts.ts"), "utf8");
  assert(!src.includes("scheduleIdle") && !src.includes("prefersSaveData"), "no idle wait, no Save-Data skip");
  assert((src.match(/ensureFullSnakeIndex\(/g) ?? []).length === 1, "the full index is only fetched on demand (never at init)");
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function stores() {
  const calls: string[] = [];
  const payload: Record<string, unknown> = {
    "fantrax.json": { v: 1, rows: { "05wwg": ["fx:05wwg", "très positif", "en hausse", "x", 0] } },
    "nhl.json": { v: 1, rows: { "8478402": ["nhl:8478402", "positif", "stable", 0] } },
    "index.json": { v: 1, rows: [{ k: "fx:05wwg", fx: "05wwg", v: "positif", td: "stable", s: "s", oc: 7 }] },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const file = Object.keys(payload).find((f) => url.includes(`/snake/${f}`));
    return { ok: !!file, status: file ? 200 : 404, json: async () => payload[file ?? ""] } as Response;
  }) as typeof fetch;
  try {
    resetSnakeClientCache();
    resetVerdictStores();
    eq(calls, [], "nothing fetched before a page subscribes");
    const offNhl = subscribeVerdicts("nhl", () => {}, { complete: true });
    await tick();
    eq(calls, [], "a complete seed never fetches");
    let pings = 0;
    const offFx = subscribeVerdicts("fx", () => pings++);
    eq(getVerdictStatus("fx"), "loading", "the first subscriber starts the fetch at once");
    await tick();
    await tick();
    eq(getVerdictStatus("fx"), "ready", "verdicts in");
    assert(pings >= 2, "subscribers are told (loading, ready)");
    eq(Object.keys(getVerdictRows("fx") ?? {}), ["05wwg"], "rows");
    assert(calls.length === 1 && calls[0]!.includes("/snake/fantrax.json"), `one GET of fantrax.json (${calls.join(", ")})`);
    const offFx2 = subscribeVerdicts("fx", () => {});
    await tick();
    eq(calls.length, 1, "a later subscriber reuses the rows");
    assert(!calls.some((c) => c.includes("index.json")), "the full index waits until asked for");
    let fullPings = 0;
    const offFull = subscribeFullSnakeIndex(() => fullPings++);
    ensureFullSnakeIndex();
    await tick();
    await tick();
    eq(getFullSnakeStatus(), "ready", "full index in");
    eq(getFullSnakeIndex()?.hasOpinions, true, "with its opinion counts");
    assert(fullPings >= 2 && calls.some((c) => c.includes("/snake/index.json")), "fetched on demand");
    ensureFullSnakeIndex();
    await tick();
    eq(calls.filter((c) => c.includes("index.json")).length, 1, "once");
    offNhl();
    offFx();
    offFx2();
    offFull();
  } finally {
    globalThis.fetch = realFetch;
    resetVerdictStores();
    resetSnakeClientCache();
  }
}

stores().then(
  () => {
    if (failed) {
      console.error(`\n${failed} snake verdict check(s) failed`);
      process.exit(1);
    }
    console.log("OK: snake verdicts (readers, seeds, eager stores, full index on demand)");
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
