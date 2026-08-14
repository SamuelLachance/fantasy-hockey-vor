/**
 * Unit check: copy flash status helper.
 * Run: npx tsx scripts/test-copy-flash.ts
 */
import {
  boardLinkAriaLabel,
  boardLinkButtonLabel,
  boardLinkLiveCopy,
  boardLinkTitle,
  copyTextWithFlash,
  playerLinkAriaLabel,
  playerLinkButtonLabel,
  playerLinkLiveCopy,
  playerLinkTitle,
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
  assert(boardLinkTitle() === "Copy link to this board view (l)", "board title");
  assert(
    boardLinkAriaLabel() === "Copy link to this board view",
    "board aria idle",
  );
  assert(boardLinkLiveCopy(false) === "", "board live idle silent");
  assert(
    boardLinkLiveCopy(true) === "Copy link to this board view (copied)",
    "board live ok",
  );
  assert(
    boardLinkLiveCopy(false, true) === "Copy link to this board view (failed)",
    "board live err",
  );
  assert(playerLinkButtonLabel(false) === "Copy player link", "player idle");
  assert(playerLinkButtonLabel(true) === "Link copied", "player ok");
  assert(playerLinkButtonLabel(false, true) === "Copy failed", "player err");
  assert(
    playerLinkAriaLabel("McDavid") === "Copy link for McDavid",
    "player aria stable",
  );
  assert(
    playerLinkLiveCopy("McDavid", true) === "Copy link for McDavid (copied)",
    "player live ok",
  );
  assert(
    playerLinkLiveCopy("McDavid", false, true) ===
      "Copy link for McDavid (failed)",
    "player live err",
  );
  assert(
    boardLinkLiveCopy(true).startsWith(boardLinkAriaLabel()),
    "board live prefixes idle aria",
  );
  assert(
    playerLinkLiveCopy("X", true).startsWith(playerLinkAriaLabel("X")),
    "player live prefixes idle aria",
  );
  assert(playerLinkTitle() === "Copy player link (p)", "player title");

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

  const cancelled: string[] = [];
  let pendingIdle: (() => void) | undefined;
  const realTimeout = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  (globalThis as { setTimeout: typeof setTimeout }).setTimeout = ((
    fn: () => void,
  ) => {
    pendingIdle = fn;
    return 1 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  (globalThis as { clearTimeout: typeof clearTimeout }).clearTimeout = ((
    id: ReturnType<typeof setTimeout>,
  ) => {
    if (id === (1 as unknown as ReturnType<typeof setTimeout>)) {
      pendingIdle = undefined;
    }
  }) as typeof clearTimeout;

  const cancel = copyTextWithFlash("cancel-me", (s) => cancelled.push(s), 50);
  await new Promise((r) => realTimeout(r, 0));
  assert(cancelled[0] === "ok", "cancel case starts ok");
  cancel();
  pendingIdle?.();
  assert(cancelled.length === 1, "cancelled flash never returns idle");
  (globalThis as { setTimeout: typeof setTimeout }).setTimeout = realTimeout;
  (globalThis as { clearTimeout: typeof clearTimeout }).clearTimeout =
    realClear;

  if (failed) process.exit(1);
  console.log("OK: copy-flash");
}

void main();
