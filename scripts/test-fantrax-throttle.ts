/**
 * The Fantrax client's spacing between calls (src/lib/fantrax/client.ts):
 * reads that overlap — a draft poll and « Actualiser » clicked while it runs —
 * must still leave the minimum gap between any two requests, not wake at the
 * same moment. Global fetch is replaced; nothing leaves the machine.
 *
 * Run: npx tsx scripts/test-fantrax-throttle.ts
 */
import { fxeaGet } from "../src/lib/fantrax/client";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const sent: number[] = [];
globalThis.fetch = (async () => {
  sent.push(performance.now());
  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const GAP = 120;
const opts = { minIntervalMs: GAP, retries: 1 };

(async () => {
  // A poll's two reads, and a refresh's two reads started 30 ms later.
  const poll = (async () => {
    await fxeaGet("getTeamRosters", { leagueId: "x" }, opts);
    await fxeaGet("getDraftResults", { leagueId: "x" }, opts);
  })();
  await new Promise((r) => setTimeout(r, 30));
  const refresh = (async () => {
    await fxeaGet("getTeamRosters", { leagueId: "x" }, opts);
    await fxeaGet("getDraftResults", { leagueId: "x" }, opts);
  })();
  // Three at once.
  await Promise.all([poll, refresh]);
  await Promise.all([1, 2, 3].map((i) => fxeaGet("getLeagueInfo", { leagueId: String(i) }, opts)));

  assert(sent.length === 7, `seven requests (${sent.length})`);
  const gaps = sent.slice(1).map((t, i) => t - sent[i]!);
  const min = Math.min(...gaps);
  // performance.now() and Date.now() tick differently: allow half a millisecond.
  assert(min >= GAP - 0.5, `every gap is at least ${GAP} ms, overlapping reads included (${gaps.map((g) => g.toFixed(1)).join(", ")})`);

  if (failed) process.exit(1);
  console.log(`OK: fantrax throttle (7 requests, smallest gap ${min.toFixed(1)} ms of ${GAP})`);
})();
