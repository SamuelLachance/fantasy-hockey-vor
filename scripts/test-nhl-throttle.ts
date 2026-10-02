/**
 * Public NHL API etiquette: one request at a time, ≥ 1.1 s apart, with a
 * descriptive User-Agent, whatever the caller's concurrency (the dataset
 * collector used to fire 4 requests at once, 700 ms apart, as a browser).
 * Run: npx tsx scripts/test-nhl-throttle.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { NHL_MIN_INTERVAL_MS, NHL_USER_AGENT, nhlThrottled } from "../src/lib/nhl-api";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failed++;
    console.error(`FAIL: ${name}${detail ? ` (${detail})` : ""}`);
  }
}

async function main() {
  check("min interval ≥ 1.1 s", NHL_MIN_INTERVAL_MS >= 1100, String(NHL_MIN_INTERVAL_MS));
  check("descriptive User-Agent", !/mozilla|chrome|safari/i.test(NHL_USER_AGENT) && /fantasy-hockey-vor/.test(NHL_USER_AGENT));

  // Concurrent callers are serialized and spaced (short interval for the test).
  const starts: number[] = [];
  let running = 0;
  let overlap = false;
  const job = () =>
    nhlThrottled(async () => {
      starts.push(Date.now());
      running++;
      if (running > 1) overlap = true;
      await new Promise((r) => setTimeout(r, 5));
      running--;
    }, 60);
  await Promise.all([job(), job(), job(), job()]);
  const gaps = starts.slice(1).map((t, i) => t - starts[i]);
  check("one request at a time", !overlap);
  check("spaced by the interval", gaps.every((g) => g >= 55), gaps.join(","));
  // A failing request does not block the queue.
  await nhlThrottled(async () => {
    throw new Error("boom");
  }, 1).catch(() => undefined);
  let after = false;
  await nhlThrottled(async () => {
    after = true;
  }, 1);
  check("queue survives a failure", after);

  // The dataset collector must not burst requests in parallel again.
  const collector = readFileSync(join(process.cwd(), "src", "lib", "ml", "season-collector.ts"), "utf8");
  check("season collector has no Promise.all burst", !/Promise\.all\(/.test(collector));

  if (failed > 0) {
    console.error(`${failed} NHL throttle check(s) failed`);
    process.exit(1);
  }
  console.log("OK: NHL requests serialized ≥ 1.1 s apart with a descriptive User-Agent");
}

main();
