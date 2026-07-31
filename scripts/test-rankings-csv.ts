/**
 * Unit checks for rankings CSV export.
 * Run: npx tsx scripts/test-rankings-csv.ts
 */
import { downloadTextFile, rankingsCsvMetaLine, rankingsToCsv } from "../src/lib/rankings-csv";
import type { PlayerProjection } from "../src/lib/types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const sample = {
  id: 1,
  rank: 3,
  positionRank: 1,
  name: 'A, "Test"',
  team: "EDM",
  positions: ["C", "LW"],
  isGoalie: false,
  gamesPlayed: 80,
  vor: 5.5,
  vorByPosition: { C: 2.25, LW: 1.1 },
  draftValue: 12,
  projection: {
    goals: 40,
    assists: 70,
    shots: 300,
    blocks: 20,
    hits: 40,
    powerplayPoints: 25,
    penaltyMinutes: 30,
    faceoffWins: 500,
  },
  zScores: {},
  categoryScores: {},
} as unknown as PlayerProjection;

const csv = rankingsToCsv([sample], "C", ["goals", "assists"]);
assert(csv.startsWith("\uFEFF"), "UTF-8 BOM for Excel");
const lines = csv.replace(/^\uFEFF/, "").split("\n");
assert(
  lines[0]!.startsWith("# fantasy-hockey-vor;filter=C;vorScope=position"),
  "meta comment",
);
assert(
  rankingsCsvMetaLine("C", 1, {
    sortKey: "vor",
    sortDir: "desc",
    query: "mcd",
    hideDepthGoalies: false,
    statRanges: { vor: { min: "2", max: "" } },
  }) ===
    "# fantasy-hockey-vor;filter=C;vorScope=position;count=1;sort=vor;dir=desc;g=all;q=mcd;rf=vor:2-",
  "meta includes filter provenance",
);
assert(
  rankingsToCsv([sample], "C", ["goals"], {
    sortKey: "goals",
    sortDir: "asc",
  })
    .replace(/^\uFEFF/, "")
    .split("\n")[0]!
    .includes("sort=goals;dir=asc"),
  "CSV meta wires sort",
);
assert(
  lines[1] === "rank,id,name,team,positions,vor,edge,sigma,gp,G,A",
  "header",
);
const dataLine = lines[2] ?? "";
assert(dataLine.includes('"A, ""Test"""'), "escaped name");
assert(dataLine.startsWith("1,1,"), "positionRank + id when pos=C");
assert(dataLine.includes(",2.250,"), "CSV uses position VOR");
assert(
  rankingsToCsv([sample], "ALL", ["goals"])
    .replace(/^\uFEFF/, "")
    .split("\n")[0]!
    .includes("vorScope=overall"),
  "ALL meta overall scope",
);
assert(
  rankingsToCsv([sample], "ALL", ["goals"])
    .replace(/^\uFEFF/, "")
    .split("\n")[2]!
    .includes(",5.500,"),
  "ALL CSV uses overall VOR",
);
assert(lines.length === 3, "meta + header + one data row");

{
  const calls: string[] = [];
  const fakeA = {
    href: "",
    download: "",
    rel: "",
    style: { display: "" },
    click() {
      calls.push("click");
    },
    remove() {
      calls.push("remove");
    },
  };
  const g = globalThis as {
    document?: unknown;
    Blob?: unknown;
    URL?: {
      createObjectURL?: (b: unknown) => string;
      revokeObjectURL?: (u: string) => void;
    };
    setTimeout: typeof setTimeout;
  };
  const prevDoc = g.document;
  const prevBlob = g.Blob;
  const prevURL = g.URL;
  const prevTimeout = g.setTimeout;
  let revoked = false;
  let revokeDelay: number | undefined;
  g.document = {
    body: {
      appendChild(node: unknown) {
        calls.push("append");
        return node;
      },
    },
    createElement(tag: string) {
      assert(tag === "a", "creates anchor");
      return fakeA;
    },
  };
  g.Blob = class {
    constructor(_parts: unknown[]) {}
  };
  g.URL = {
    createObjectURL() {
      return "blob:test";
    },
    revokeObjectURL() {
      revoked = true;
    },
  };
  g.setTimeout = ((fn: () => void, ms?: number) => {
    revokeDelay = ms;
    fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  downloadTextFile("t.csv", "x", "text/csv");
  assert(calls.join(",") === "append,click,remove", "mount-click-remove");
  assert(revokeDelay === 1000, "deferred revoke");
  assert(revoked, "revokes blob URL");
  assert(fakeA.download === "t.csv", "download filename");

  g.document = prevDoc;
  g.Blob = prevBlob;
  g.URL = prevURL;
  g.setTimeout = prevTimeout;
}

if (failed) process.exit(1);
console.log("OK: rankings-csv");
