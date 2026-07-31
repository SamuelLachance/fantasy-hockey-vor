/**
 * Unit checks for clipboard helper (no DOM fallback path).
 * Run: npx tsx scripts/test-clipboard.ts
 */
import { copyText } from "../src/lib/clipboard";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

async function main() {
  Object.defineProperty(globalThis, "document", {
    value: undefined,
    configurable: true,
  });

  Object.defineProperty(globalThis, "navigator", {
    value: {
      clipboard: {
        writeText: async () => undefined,
      },
    },
    configurable: true,
  });
  assert((await copyText("hello")) === true, "clipboard write ok");

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
  assert(
    (await copyText("nope")) === false,
    "clipboard fail without DOM fallback",
  );

  Object.defineProperty(globalThis, "navigator", {
    value: {},
    configurable: true,
  });
  assert(
    (await copyText("missing")) === false,
    "no clipboard API without DOM → false",
  );

  if (failed) process.exit(1);
  console.log("OK: clipboard");
}

void main();
