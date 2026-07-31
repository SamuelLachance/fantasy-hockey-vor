/**
 * Unit check: copy flash status helper.
 * Run: npx tsx scripts/test-copy-flash.ts
 */
import {
  boardLinkButtonLabel,
  copyTextWithFlash,
  playerLinkAriaLabel,
  playerLinkButtonLabel,
} from "../src/lib/copy-flash";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

function withFlashTimeout(run: () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    const realTimeout = globalThis.setTimeout;
    (globalThis as { setTimeout: typeof setTimeout }).setTimeout = ((
      fn: () => void,
    ) => {
      fn();
      (globalThis as { setTimeout: typeof setTimeout }).setTimeout =
        realTimeout;
      resolve();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    run();
  });
}

async function main() {
  assert(boardLinkButtonLabel(false) === "Link", "board idle");
  assert(boardLinkButtonLabel(true) === "Copied", "board ok");
  assert(boardLinkButtonLabel(false, true) === "Failed", "board err");
  assert(playerLinkButtonLabel(false) === "Copy player link", "player idle");
  assert(playerLinkButtonLabel(true) === "Link copied", "player ok");
  assert(playerLinkButtonLabel(false, true) === "Copy failed", "player err");
  assert(
    playerLinkAriaLabel("McDavid", true) === "Link copied for McDavid",
    "player aria ok",
  );

  Object.defineProperty(globalThis, "document", {
    value: undefined,
    configurable: true,
  });

  const errStatuses: string[] = [];
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
  await withFlashTimeout(() =>
    copyTextWithFlash("x", (s) => errStatuses.push(s), 1),
  );
  assert(errStatuses[0] === "err", `expected err first, got ${errStatuses[0]}`);
  assert(errStatuses[1] === "idle", `expected idle second, got ${errStatuses[1]}`);

  const okStatuses: string[] = [];
  Object.defineProperty(globalThis, "navigator", {
    value: {
      clipboard: {
        writeText: async () => undefined,
      },
    },
    configurable: true,
  });
  await withFlashTimeout(() =>
    copyTextWithFlash("ok", (s) => okStatuses.push(s), 1),
  );
  assert(okStatuses[0] === "ok", `expected ok first, got ${okStatuses[0]}`);
  assert(okStatuses[1] === "idle", `expected idle after ok, got ${okStatuses[1]}`);

  if (failed) process.exit(1);
  console.log("OK: copy-flash");
}

void main();
