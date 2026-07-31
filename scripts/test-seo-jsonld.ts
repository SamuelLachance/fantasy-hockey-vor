/**
 * Unit check: rankings JSON-LD graph shape.
 * Run: npx tsx scripts/test-seo-jsonld.ts
 */
import { rankingsJsonLd, serializeJsonLd } from "../src/lib/seo-jsonld";
import {
  siteDatasetDescription,
  siteDefaultDescription,
} from "../src/lib/site-meta";
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
assert(Array.isArray(graph) && graph.length === 5, "graph has 5 nodes");
assert(graph[0]?.["@type"] === "WebApplication", "WebApplication node");
assert(
  graph[0]?.description === siteDefaultDescription(data.season),
  "WebApplication description matches site-meta",
);
assert(
  String(graph[0]?.description).includes(data.season),
  "WebApplication description includes season",
);
assert(graph[1]?.["@type"] === "Dataset", "Dataset node");
assert(
  graph[1]?.description === siteDatasetDescription(data.season),
  "Dataset description matches site-meta",
);
assert(
  String(graph[1]?.description).includes(data.season),
  "Dataset description includes season",
);
assert(graph[2]?.["@type"] === "FAQPage", "FAQPage node");
assert(graph[3]?.["@type"] === "BreadcrumbList", "BreadcrumbList node");
assert(graph[4]?.["@type"] === "HowTo", "HowTo node");
const howToSteps = graph[4]?.step as Array<Record<string, unknown>>;
assert(Array.isArray(howToSteps) && howToSteps.length >= 5, "HowTo steps");
assert(
  JSON.stringify(howToSteps).includes("Load more"),
  "HowTo covers load more",
);
assert(
  JSON.stringify(howToSteps).includes("press p"),
  "HowTo covers player link hotkey",
);
const crumbs = graph[3]?.itemListElement as Array<Record<string, unknown>>;
assert(Array.isArray(crumbs) && crumbs.length === 2, "breadcrumb items");
assert(crumbs[1]?.name === "2026-27 Rankings", "season crumb");
const faq = graph[2]?.mainEntity as Array<Record<string, unknown>>;
assert(Array.isArray(faq) && faq.length >= 5, "FAQ entries");
assert(faq[0]?.["@type"] === "Question", "FAQ question type");
assert(
  JSON.stringify(faq).includes("Starters"),
  "FAQ covers goalie starters filter",
);
assert(
  JSON.stringify(faq).includes("keyboard"),
  "FAQ covers keyboard shortcuts",
);
assert(
  JSON.stringify(faq).includes("Esc clears search"),
  "FAQ keyboard mentions Esc",
);
assert(
  JSON.stringify(faq).includes("p copy expanded player link"),
  "FAQ keyboard mentions player link",
);
assert(graph[1]?.dateModified === data.generatedAt, "dateModified wired");
assert(graph[1]?.license === "https://opensource.org/licenses/MIT", "license");
assert(graph[1]?.isAccessibleForFree === true, "free");
assert(Array.isArray(graph[1]?.keywords), "keywords");
assert(
  (graph[1]?.about as { name?: string } | undefined)?.name ===
    "National Hockey League",
  "about NHL",
);
const hostile = serializeJsonLd({ x: "</script><img onerror=1>" });
assert(hostile.includes("\\u003c"), "escapes angle brackets");
assert(!hostile.includes("<"), "no raw < in script payload");

if (failed) process.exit(1);
console.log("OK: seo-jsonld");
