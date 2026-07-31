/**
 * Unit checks for player-details.json client cache + retry.
 * Run: npx tsx scripts/test-player-details-client.ts
 */
import {
  fetchPlayerDetails,
  normalizePlayerDetailsPayload,
  resetPlayerDetailsCache,
} from "../src/lib/player-details-client";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const realFetch = globalThis.fetch;
const realTimeout = globalThis.setTimeout;

function installFastTimeout() {
  (globalThis as { setTimeout: typeof setTimeout }).setTimeout = ((
    fn: () => void,
    ms?: number,
  ) => {
    // Keep long abort timers inert so retry sleeps still flush instantly.
    if (typeof ms === "number" && ms >= 1_000) {
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }
    fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
}

async function main() {
  installFastTimeout();
  resetPlayerDetailsCache();

  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) {
      return { ok: false, status: 503 } as Response;
    }
    return {
      ok: true,
      json: async () => ({
        "42": { reasoning: "ok", profileSummary: "sum" },
      }),
    } as Response;
  }) as typeof fetch;

  const data = await fetchPlayerDetails();
  assert(calls === 2, "retries once after HTTP error");
  assert(data["42"]?.reasoning === "ok", "payload returned");

  await fetchPlayerDetails();
  assert(calls === 2, "session cache avoids refetch");

  resetPlayerDetailsCache();
  calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("network down");
  }) as typeof fetch;

  let threw = false;
  try {
    await fetchPlayerDetails();
  } catch {
    threw = true;
  }
  assert(threw, "exhausted retries throw");
  assert(calls === 2, "two attempts on network error");

  // Cache cleared after failure — next call retries from scratch.
  calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({
        "7": { reasoning: "recovered", profileSummary: "" },
      }),
    } as Response;
  }) as typeof fetch;
  const recovered = await fetchPlayerDetails();
  assert(calls === 1, "fresh fetch after failed cache clear");
  assert(recovered["7"]?.reasoning === "recovered", "recovery payload");

  const normalized = normalizePlayerDetailsPayload({
    "1": { reasoning: "a", profileSummary: "b", junk: true },
    bad: null,
    also: "nope",
    "2": { reasoning: 9, profileSummary: "ok" },
  });
  assert(normalized["1"]?.reasoning === "a", "keeps valid record");
  assert(normalized["1"]?.profileSummary === "b", "keeps summary");
  assert(normalized.bad === undefined, "drops null");
  assert(normalized.also === undefined, "drops non-object");
  assert(normalized["2"]?.reasoning === "", "coerces bad reasoning");
  assert(normalized["2"]?.profileSummary === "ok", "keeps string summary");
  assert(
    Object.keys(normalizePlayerDetailsPayload([])).length === 0,
    "arrays → empty",
  );

  globalThis.fetch = realFetch;
  globalThis.setTimeout = realTimeout;
  resetPlayerDetailsCache();

  if (failed) process.exit(1);
  console.log("OK: player-details-client");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
