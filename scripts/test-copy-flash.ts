/**
 * Unit check: copy flash status helper.
 * Run: npx tsx scripts/test-copy-flash.ts
 */
import { copyTextWithFlash } from "../src/lib/copy-flash";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const statuses: string[] = [];

Object.defineProperty(globalThis, "navigator", {
  value: {
    clipboard: {
      writeText: async () => {
        throw new Error("denied");
      },
    },
  },
  configurable: true,
});
Object.defineProperty(globalThis, "document", {
  value: undefined,
  configurable: true,
});

await new Promise<void>((resolve) => {
  const realTimeout = globalThis.setTimeout;
  (globalThis as { setTimeout: typeof setTimeout }).setTimeout = ((
    fn: () => void,
  ) => {
    fn();
    resolve();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  copyTextWithFlash("x", (s) => statuses.push(s), 1);
  (globalThis as { setTimeout: typeof setTimeout }).setTimeout = realTimeout;
});

assert(statuses[0] === "err", `expected err first, got ${statuses[0]}`);
assert(statuses[1] === "idle", `expected idle second, got ${statuses[1]}`);

if (failed) process.exit(1);
console.log("OK: copy-flash");
