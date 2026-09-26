/**
 * Post-build checks of the static export (`out/`), run by `build:pages`:
 * the pages GitHub Pages must serve, one French document per page (lang,
 * noindex, one <main>, one <h1>), links that work under the basePath and
 * never end with a slash, the old-address stubs and the 404 recovery, no
 * English left in the visible text, and a JavaScript / HTML size budget.
 *
 * Links are read from HTML attributes only (the RSC payload inside the
 * scripts carries paths without the basePath by design); text checks read
 * the visible text only. Budget overruns and English text fail locally and
 * on pull requests, and only warn on the push / scheduled / manual deploys,
 * so growth or wording in the synced data never blocks the twice-daily deploy.
 * Run: npx tsx scripts/check-export.ts (after `next build`)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { gzipSync } from "zlib";
import { LEGACY_RULES, legacyTarget } from "../src/lib/leagues/legacy";
import { LEAGUES } from "../src/lib/leagues/registry";
import { SITE_ORIGIN } from "../src/lib/site";

const OUT = join(process.cwd(), "out");
const BASE = process.env.GITHUB_PAGES === "true" ? "/fantasy-hockey-vor" : "";
/** Deploy runs (push, cron, manual): budgets and English text only warn there. */
const BUDGET_WARN_ONLY = ["push", "schedule", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME ?? "");

const errors: string[] = [];
const warnings: string[] = [];
const fail = (m: string) => errors.push(m);

if (!existsSync(OUT)) {
  console.error("FAIL: out/ is missing (run next build first)");
  process.exit(1);
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}
const rel = (abs: string) => relative(OUT, abs).split(sep).join("/");
const read = (r: string) => readFileSync(join(OUT, r), "utf8");

// ---- expected files
const tabPages = LEAGUES.flatMap((l) => l.tabs.map((t) => `ligues/${l.slug}/${t}`));
const expected = [
  "index.html",
  "404.html",
  "snake.html",
  "league.html",
  "draft/light-the-lamp.html",
  "robots.txt",
  "manifest.webmanifest",
  ...tabPages.flatMap((p) => [`${p}.html`, `${p}.txt`]),
];
for (const f of expected) if (!existsSync(join(OUT, f))) fail(`missing ${f}`);
for (const p of tabPages) {
  // Per-segment payloads of client navigation (names encode the dynamic segments).
  const dir = join(OUT, p);
  const segs = existsSync(dir) ? walk(dir).map(rel) : [];
  if (!segs.some((s) => s.endsWith("__next._tree.txt"))) fail(`${p}/: segment payloads missing`);
}
if (existsSync(join(OUT, "sitemap.xml"))) fail("sitemap.xml is published (the site is noindex)");
// The Captains tabs fetch the browser's copy of dynasty.json (build:pages writes it): same build, same players.
if (existsSync(join(OUT, "fantrax", "dynasty.json"))) {
  const slimPath = join(OUT, "fantrax", "dynasty-table.json");
  if (!existsSync(slimPath)) fail("fantrax/dynasty-table.json missing (run tsx scripts/build-dynasty-client.ts before next build)");
  else {
    type Snap = { builtAt?: string; players?: Record<string, unknown>; zero?: string[] };
    const full = JSON.parse(read("fantrax/dynasty.json")) as Snap;
    const slim = JSON.parse(readFileSync(slimPath, "utf8")) as Snap;
    const ids = (s: Snap) => Object.keys(s.players ?? {}).sort().join(",");
    if (full.builtAt !== slim.builtAt || ids(full) !== ids(slim) || (full.zero ?? []).length !== (slim.zero ?? []).length) {
      fail("fantrax/dynasty-table.json does not match fantrax/dynasty.json (stale copy)");
    }
  }
}

// ---- helpers
/** HTML with script / style / template bodies removed (tags and attributes kept). */
function markupOnly(html: string): string {
  return html
    .replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, "<script$1></script>")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, "");
}
function visibleText(html: string): string {
  return markupOnly(html)
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ");
}
/** Internal path (without basePath) → does the export serve it? */
function served(path: string): boolean {
  if (path === "/") return existsSync(join(OUT, "index.html"));
  const clean = decodeURIComponent(path.replace(/^\//, ""));
  const f = join(OUT, clean);
  return (existsSync(f) && statSync(f).isFile()) || existsSync(`${f}.html`);
}

const ENGLISH = ["Loading", "Something went wrong", "Back to rankings", "Page not found", "Other tools", "(FR)", "Try again", "Rankings"];
const OLD_ADDRESSES = LEGACY_RULES.map((r) => r.from as string);
const htmlFiles = walk(OUT).filter((f) => f.endsWith(".html")).map(rel).sort();

// ---- every HTML page
for (const page of htmlFiles) {
  const html = read(page);
  const markup = markupOnly(html);
  if (!html.includes('<html lang="fr-CA"')) fail(`${page}: <html lang="fr-CA"> missing`);
  if (!/<meta name="robots" content="noindex/.test(html)) fail(`${page}: robots noindex meta missing`);
  const mains = (markup.match(/<main[\s>]/g) ?? []).length;
  const h1s = (markup.match(/<h1[\s>]/g) ?? []).length;
  if (mains !== 1) fail(`${page}: ${mains} <main> (want 1)`);
  if (h1s !== 1) fail(`${page}: ${h1s} <h1> (want 1)`);
  if (!/<title>[^<]*\| Fantasy Hockey VOR<\/title>/.test(html)) fail(`${page}: title lacks « | Fantasy Hockey VOR »`);
  if (html.includes("player-details.json")) fail(`${page}: references player-details.json`);
  // Complete HTML, no streamed boundary: the content must not wait for an
  // inline script (no JavaScript, background tab) to be revealed.
  if (html.includes("<!--$?-->")) fail(`${page}: a Suspense boundary is still pending in the HTML (a loading.tsx?)`);

  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
  if (canonical) {
    if (!canonical.startsWith(SITE_ORIGIN)) fail(`${page}: canonical outside the site (${canonical})`);
    else if (canonical !== `${SITE_ORIGIN}/` && canonical.endsWith("/")) fail(`${page}: canonical ends with a slash (${canonical})`);
  }

  // Links: HTML attributes only.
  for (const m of markup.matchAll(/<(\w+)\b[^>]*?\s(href|src|action)="([^"]*)"/g)) {
    const [, tag, , url] = m as unknown as [string, string, string, string];
    if (!url.startsWith("/") || url.startsWith("//")) continue;
    if (BASE && url !== `${BASE}/` && !url.startsWith(`${BASE}/`)) {
      fail(`${page}: <${tag}> ${url} lacks the basePath`);
      continue;
    }
    const withoutBase = BASE ? url.slice(BASE.length) || "/" : url;
    const path = withoutBase.split(/[?#]/)[0] || "/";
    if (path !== "/" && path.endsWith("/")) fail(`${page}: <${tag}> ${url} ends with a slash (404 on Pages)`);
    if (!served(path)) fail(`${page}: <${tag}> ${url} points at nothing in the export`);
    if (tag === "a" && OLD_ADDRESSES.includes(path)) fail(`${page}: <a> to the old address ${path}`);
  }

  const text = visibleText(html);
  for (const phrase of ENGLISH) {
    const re = new RegExp(`(^|[^\\p{L}])${phrase.replace(/[()]/g, "\\$&")}([^\\p{L}]|$)`, "u");
    if (!re.test(text)) continue;
    // The visible text also carries synced league data (Fantrax team names,
    // injury notes): like the budgets, only a warning on the deploys.
    if (BUDGET_WARN_ONLY) {
      warnings.push(`${page}: English text « ${phrase} »`);
      console.log(`::warning::${page}: English text « ${phrase} »`);
    } else {
      fail(`${page}: English text « ${phrase} »`);
    }
  }
}

// ---- pages
{
  const index = read("index.html");
  if (!visibleText(index).includes("Mes ligues")) fail("index.html: « Mes ligues » missing");
  if (!/<title>Mes ligues \| Fantasy Hockey VOR<\/title>/.test(index)) fail("index.html: title");
  for (const p of tabPages) {
    const html = read(`${p}.html`);
    if (!html.includes(`<link rel="canonical" href="${SITE_ORIGIN}/${p}"`)) fail(`${p}.html: canonical`);
    if (!html.includes('aria-current="page"')) fail(`${p}.html: no active tab / nav item`);
  }
}

// ---- old addresses
for (const rule of LEGACY_RULES) {
  const page = `${rule.from.slice(1)}.html`;
  const html = read(page);
  const isStub = html.includes('http-equiv="refresh"');
  if (!isStub) {
    // The draft helper's old address stays a real page until after the draft.
    if (rule.from !== "/draft/light-the-lamp") fail(`${page}: expected a redirect stub`);
    else if (!visibleText(html).includes("Nouvelle adresse")) fail(`${page}: « Nouvelle adresse » banner missing`);
    continue;
  }
  const target = `${BASE}${legacyTarget(rule, "", "")}`;
  const scriptAt = html.indexOf("function rec(");
  const noscriptAt = html.indexOf("<noscript");
  if (scriptAt < 0 || !html.includes("l.replace(b+t)")) fail(`${page}: recovery script missing`);
  if (noscriptAt >= 0 && scriptAt > noscriptAt) fail(`${page}: the script must come before the <noscript> refresh`);
  const outside = html.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "");
  if (outside.includes('http-equiv="refresh"')) fail(`${page}: refresh <meta> outside <noscript> (would redirect JS users without their query)`);
  if (!html.includes(`<noscript><meta http-equiv="refresh" content="0;url=${target}"></noscript>`)) {
    fail(`${page}: <noscript> refresh to ${target} missing`);
  }
  if (!markupOnly(html).includes(`href="${target}"`)) fail(`${page}: visible link to ${target} missing`);
}
{
  const notFound = read("404.html");
  if (!notFound.includes("function rec(") || !notFound.includes("l.replace(b+t)")) fail("404.html: recovery script missing");
  if (notFound.includes("aria-current")) fail("404.html: an item is marked current (the page is served at any address)");
}

// ---- budgets (gzip KB)
const gzCache = new Map<string, number>();
const gzKb = (file: string) => {
  let n = gzCache.get(file);
  if (n === undefined) {
    n = gzipSync(readFileSync(file)).length / 1024;
    gzCache.set(file, n);
  }
  return n;
};
const scriptsOf = new Map<string, string[]>();
for (const page of htmlFiles) {
  const markup = markupOnly(read(page));
  const src = [...markup.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]!);
  const preload = [...markup.matchAll(/<link\b(?=[^>]*\bas="script")[^>]*\shref="([^"]+)"/g)].map((m) => m[1]!);
  scriptsOf.set(page, [...new Set([...src, ...preload])]);
}
const lists = [...scriptsOf.values()];
const shared = (lists[0] ?? []).filter((s) => lists.every((l) => l.includes(s)));
const fileOf = (url: string) => join(OUT, url.slice(BASE.length).split("?")[0]!);
const sharedKb = shared.reduce((n, s) => n + gzKb(fileOf(s)), 0);

interface Budget {
  label: string;
  match: (page: string) => boolean;
  /** Page JS (gzip KB) beyond the chunks every page loads. */
  js: number;
  htmlRaw: number;
  htmlGz: number;
}
const isTab = (slug: string, tabs: string[]) => (p: string) => tabs.some((t) => p === `ligues/${slug}/${t}.html`);
// Calibrated on the first build of the league spaces (measured + ~15 %).
const BUDGETS: Budget[] = [
  { label: "Mes ligues", match: (p) => p === "index.html", js: 20, htmlRaw: 80, htmlGz: 15 },
  { label: "Captains · Aujourd’hui", match: isTab("captains-dynasty", ["aujourdhui"]), js: 50, htmlRaw: 300, htmlGz: 40 },
  {
    label: "Captains · autres onglets",
    match: isTab("captains-dynasty", ["repechage", "joueurs", "ballottage", "mon-equipe"]),
    // Spec limit (measured 61.7–64.4 with the dynasty columns). The tabs
    // import the league through its context module (never the provider's),
    // so the planner is not shipped twice; the details row (the model's
    // sentence, the six-season chart, the « Conseil » sentences, Snake's
    // take), the dynasty filter row and the 2027 cutdown card load on
    // demand, and Snake's verdict store never pulls the dynasty modules
    // (Aujourd'hui stays at ~40).
    js: 65,
    htmlRaw: 200,
    htmlGz: 35,
  },
  { label: "LTL · Repêchage", match: isTab("light-the-lamp", ["repechage"]), js: 45, htmlRaw: 700, htmlGz: 75 },
  { label: "LTL · Joueurs / Mon équipe", match: isTab("light-the-lamp", ["joueurs", "mon-equipe"]), js: 55, htmlRaw: 700, htmlGz: 75 },
  // Spec limit: the league route's own client chunk (tabs, switcher, the
  // Snake disclaimer from its tiny module, the per-tab loaders) and nothing of
  // Fantrax or the player table. Over it: fix the import graph, not the number.
  { label: "LTL · Duel", match: isTab("light-the-lamp", ["duel"]), js: 5, htmlRaw: 60, htmlGz: 12 },
  { label: "Snake", match: (p) => p === "snake.html", js: 25, htmlRaw: 80, htmlGz: 15 },
  { label: "/league (stub), 404", match: (p) => ["league.html", "404.html", "_not-found.html"].includes(p), js: 5, htmlRaw: 60, htmlGz: 12 },
  { label: "/draft/light-the-lamp", match: (p) => p === "draft/light-the-lamp.html", js: 45, htmlRaw: 700, htmlGz: 75 },
];
// Spec limit (§11: ≤ 200 KB; about 192 KB at the restructure).
const SHARED_MAX = 200;
const overBudget: string[] = [];
if (sharedKb > SHARED_MAX) overBudget.push(`shared JS ${sharedKb.toFixed(1)} KB > ${SHARED_MAX} KB`);
const rows: string[] = [];
for (const page of htmlFiles) {
  const budget = BUDGETS.find((b) => b.match(page));
  const own = (scriptsOf.get(page) ?? []).filter((s) => !shared.includes(s));
  const js = own.reduce((n, s) => n + gzKb(fileOf(s)), 0);
  const raw = statSync(join(OUT, page)).size / 1024;
  const gz = gzKb(join(OUT, page));
  if (!budget) {
    fail(`${page}: no size budget`);
    continue;
  }
  const flags: string[] = [];
  if (js > budget.js) flags.push(`JS ${js.toFixed(1)} > ${budget.js}`);
  if (raw > budget.htmlRaw) flags.push(`HTML ${raw.toFixed(0)} > ${budget.htmlRaw}`);
  if (gz > budget.htmlGz) flags.push(`HTML gz ${gz.toFixed(1)} > ${budget.htmlGz}`);
  for (const f of flags) overBudget.push(`${page} (${budget.label}): ${f} KB`);
  rows.push(
    `${page.padEnd(42)} JS ${js.toFixed(1).padStart(5)} / ${String(budget.js).padStart(3)}  HTML ${raw.toFixed(0).padStart(4)} / ${String(budget.htmlRaw).padStart(3)} KB, gz ${gz.toFixed(1).padStart(5)} / ${budget.htmlGz}${flags.length ? "  ← over" : ""}`,
  );
}
for (const o of overBudget) {
  if (BUDGET_WARN_ONLY) {
    warnings.push(o);
    console.log(`::warning::budget: ${o}`);
  } else {
    fail(`budget: ${o}`);
  }
}

if (errors.length) {
  for (const e of errors) console.error(`FAIL: ${e}`);
  console.error(`\n${errors.length} export check(s) failed`);
  process.exit(1);
}
console.log(`Shared JS: ${sharedKb.toFixed(1)} / ${SHARED_MAX} KB gz (${shared.length} chunks)`);
for (const r of rows) console.log(`  ${r}`);
console.log(
  `OK: export (${htmlFiles.length} pages, basePath ${BASE || "none"}${warnings.length ? `, ${warnings.length} warning(s)` : ""})`,
);
