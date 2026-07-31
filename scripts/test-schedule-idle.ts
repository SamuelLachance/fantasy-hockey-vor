/**
 * Unit checks for idle scheduler cancelation + ric timeout.
 * Run: npx tsx scripts/test-schedule-idle.ts
 */
import { scheduleIdle } from "../src/lib/schedule-idle";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

async function main() {
  let ran = false;
  const cancel = scheduleIdle(() => {
    ran = true;
  }, 50);
  cancel();
  await new Promise((r) => setTimeout(r, 80));
  assert(ran === false, "cancel before fire skips callback");

  let ran2 = false;
  await new Promise<void>((resolve) => {
    scheduleIdle(() => {
      ran2 = true;
      resolve();
    }, 10);
  });
  assert(ran2, "uncancelled idle runs");

  let seenTimeout: number | undefined;
  const g = globalThis as { window?: unknown };
  const prevWindow = g.window;
  g.window = {
    requestIdleCallback(
      cb: () => void,
      opts?: { timeout?: number },
    ) {
      seenTimeout = opts?.timeout;
      queueMicrotask(() => cb());
      return 1;
    },
    cancelIdleCallback() {},
  };
  await new Promise<void>((resolve) => {
    scheduleIdle(() => resolve(), 123);
  });
  assert(seenTimeout === 123, "ric receives timeout option");
  g.window = prevWindow;

  let ranHidden = false;
  const gDoc = globalThis as { document?: Document };
  const prevDoc = gDoc.document;
  let attached = false;
  gDoc.document = {
    visibilityState: "hidden",
    addEventListener() {
      attached = true;
    },
    removeEventListener() {
      attached = false;
    },
  } as unknown as Document;
  const cancelHidden = scheduleIdle(() => {
    ranHidden = true;
  }, 10);
  await new Promise((r) => setTimeout(r, 30));
  assert(ranHidden === false, "hidden tab defers idle");
  assert(attached, "waits on visibilitychange");
  cancelHidden();
  assert(!attached, "cancel detaches visibility listener");
  await new Promise((r) => setTimeout(r, 30));
  assert(ranHidden === false, "cancel while hidden skips callback");
  gDoc.document = prevDoc;

  if (failed) process.exit(1);
  console.log("OK: schedule-idle");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
