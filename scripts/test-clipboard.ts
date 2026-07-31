/**
 * Unit checks for clipboard helper + DOM fallback.
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

  const calls: string[] = [];
  const fakeTa = {
    value: "",
    style: {} as Record<string, string>,
    setAttribute() {},
    focus() {
      calls.push("focus");
    },
    select() {
      calls.push("select");
    },
    setSelectionRange(start: number, end: number) {
      calls.push(`range:${start}-${end}`);
    },
    remove() {
      calls.push("remove");
    },
  };
  Object.defineProperty(globalThis, "document", {
    value: {
      body: {
        appendChild(node: unknown) {
          calls.push("append");
          return node;
        },
      },
      createElement(tag: string) {
        assert(tag === "textarea", "creates textarea");
        return fakeTa;
      },
      execCommand(cmd: string) {
        assert(cmd === "copy", "execCommand copy");
        calls.push("copy");
        return true;
      },
    },
    configurable: true,
  });
  assert((await copyText("link")) === true, "DOM fallback ok");
  assert(
    calls.join(",") === "append,focus,select,range:0-4,copy,remove",
    `DOM fallback sequence got ${calls.join(",")}`,
  );

  calls.length = 0;
  Object.defineProperty(globalThis, "document", {
    value: {
      body: {
        appendChild(node: unknown) {
          calls.push("append");
          return node;
        },
      },
      createElement() {
        return fakeTa;
      },
      execCommand() {
        throw new Error("copy blocked");
      },
    },
    configurable: true,
  });
  assert((await copyText("x")) === false, "DOM fallback failure");
  assert(calls.includes("remove"), "textarea removed after failure");

  if (failed) process.exit(1);
  console.log("OK: clipboard");
}

void main();
