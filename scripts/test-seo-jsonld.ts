/**
 * Unit check: rankings JSON-LD graph shape.
 * Run: npx tsx scripts/test-seo-jsonld.ts
 */
import { rankingsJsonLd } from "../src/lib/seo-jsonld";
import type { ProjectionsDataset } from "../src/lib/types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const data = {
  season: "2026-27",
  generatedAt: "2026-07-31T00:00:00.000Z",
  players: [],
} as unknown as ProjectionsDataset;

const ld = rankingsJsonLd(data);
const graph = ld["@graph"] as Array<Record<string, unknown>>;
assert(Array.isArray(graph) && graph.length === 2, "graph has 2 nodes");
assert(graph[0]?.["@type"] === "WebApplication", "WebApplication node");
assert(graph[1]?.["@type"] === "Dataset", "Dataset node");
assert(graph[1]?.dateModified === data.generatedAt, "dateModified wired");
assert(graph[1]?.license === "https://opensource.org/licenses/MIT", "license");
assert(graph[1]?.isAccessibleForFree === true, "free");
assert(Array.isArray(graph[1]?.keywords), "keywords");

if (failed) process.exit(1);
console.log("OK: seo-jsonld");
