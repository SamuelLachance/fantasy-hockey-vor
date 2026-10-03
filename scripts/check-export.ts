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
import { CLIENT_DYNASTY_FILE } from "../src/lib/dynasty/client-snapshot";
import { FANTRAX_LEAGUES } from "../src/lib/fantrax/config";
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
// A dynasty league's tabs fetch the browser's copy of its dynasty.json
// (build:pages writes it): same build, same players. One published directory
// per Fantrax league (Captains at the root of fantrax/, the others under
// their slug), and no dynasty file at all for a league without the model.
for (const cfg of Object.values(FANTRAX_LEAGUES)) {
  const dir = cfg.paths.public.replace(/^public\//, "");
  const fullRel = `${dir}/dynasty.json`;
  const slimRel = `${dir}/${CLIENT_DYNASTY_FILE}`;
  if (!existsSync(join(OUT, fullRel))) continue;
  if (!cfg.features.dynasty) {
    fail(`${fullRel} is published but ${cfg.slug} has no keeper model`);
    continue;
  }
  const slimPath = join(OUT, slimRel);
  if (!existsSync(slimPath)) fail(`${slimRel} missing (run tsx scripts/build-dynasty-client.ts before next build)`);
  else {
    type Snap = { builtAt?: string; players?: Record<string, unknown>; zero?: string[] };
    const full = JSON.parse(read(fullRel)) as Snap;
    const slim = JSON.parse(readFileSync(slimPath, "utf8")) as Snap;
    const ids = (s: Snap) => Object.keys(s.players ?? {}).sort().join(",");
    if (full.builtAt !== slim.builtAt || ids(full) !== ids(slim) || (full.zero ?? []).length !== (slim.zero ?? []).length) {
      fail(`${slimRel} does not match ${fullRel} (stale copy)`);
    }
  }
}

// The stand-alone Slapshot draft page embeds values and contracts: they must
// be the deployed dynasty.json's (build:pages regenerates the page first).
{
  const page = join(OUT, "slapshot-draft.html");
  const dyn = join(OUT, "fantrax", "slapshot", "dynasty.json");
  // Every row is reachable: pages of 100 with « Tout afficher » (the pager
  // replaced a829d03's « Afficher 300 de plus »; test-slapshot-draft runs it).
  if (existsSync(page)) {
    const html = readFileSync(page, "utf8");
    if (!html.includes('<nav id="pager"') || !html.includes('pageBtn("all"') || /rows\.length >= 300/.test(html)) {
      fail("slapshot-draft.html lost its pager or « Tout afficher » (scripts/slapshot-draft/template.html)");
    }
  }
  if (existsSync(page) && existsSync(dyn)) {
    const m = /<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(readFileSync(page, "utf8"));
    let embedded: string | null = null;
    try {
      embedded = m ? ((JSON.parse(m[1]!) as { dynastyBuiltAt?: string }).dynastyBuiltAt ?? null) : null;
    } catch {
      embedded = null;
    }
    const published = (JSON.parse(readFileSync(dyn, "utf8")) as { builtAt?: string }).builtAt ?? null;
    if (embedded !== published) {
      fail(`slapshot-draft.html embeds values of ${embedded ?? "?"}, dynasty.json is ${published ?? "?"} (run tsx scripts/build-slapshot-draft-page.ts)`);
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
// Stand-alone pages without Next chunks (public/slapshot-draft.html) would
// empty the intersection and bill every page for the shared runtime.
const lists = [...scriptsOf.values()].filter((l) => l.length > 0);
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
  // Measured on the deploy build (GITHUB_PAGES=true, basePath in every link):
  // 81.3 KB before the cards were bounded, with only 3 + 3 alert lines, and
  // 95 KB for an illegal, over-cap Slapshot roster mid-draft (8 alerts). Each
  // line cost ~2.3 KB (its HTML with two inline SVG icons, and the page data).
  // Now a Fantrax card lists at most HOME_MAX_ALERTS (4) lines, the rest folded
  // into « Et N autres alertes » (home-summary.ts, tested there on that very
  // roster), and a line's classes and icons live in globals.css
  // (.home-alert-*): 71 KB on the committed data, 73 KB with BOTH Fantrax
  // leagues on a worst-case plan (12 alerts each, the longest wordings, on the
  // clock). 80 leaves 7 KB for the synced wording over that worst case.
  { label: "Mes ligues", match: (p) => p === "index.html", js: 20, htmlRaw: 80, htmlGz: 15 },
  { label: "Captains · Aujourd’hui", match: isTab("captains-dynasty", ["aujourdhui"]), js: 50, htmlRaw: 300, htmlGz: 40 },
  {
    label: "Captains · autres onglets",
    match: isTab("captains-dynasty", ["repechage", "joueurs", "ballottage", "mon-equipe"]),
    // Spec limit. The tabs import the league through its context module (never
    // the provider's), so the planner is not shipped twice; the details row
    // (the model's sentence, the six-season chart, the « Conseil » sentences,
    // Snake's take), the dynasty filter row and the 2027 cutdown card load on
    // demand, and Snake's verdict store never pulls the dynasty modules
    // (Aujourd'hui stays at ~40).
    //
    // It was 65 for a measured 61.7–64.4 before a second Fantrax league
    // existed. Building d7c50cb side by side with this tree gives 64.4 → 69.2
    // on the heaviest tab (Repêchage), 63.1 → 67.9 on Mon équipe, and shared
    // JS 192.2 → 193.3. Of that +4.8:
    //   ~1.1  the points-over-replacement model (`points-vor.ts` and the league
    //         fill it shares with the Yahoo engine). One dynamic route serves
    //         both leagues, so a Slapshot tab and a Captains tab are the same
    //         chunk, and Captains carries a model it cannot use
    //         (`canRankByPoints` is false with a captain slot).
    //   ~1.0  the second league's config — its slot table, eligibility tokens,
    //         limits, priors — plus the eligibility helpers every league now
    //         goes through instead of hard-coded C/W/D/G token tests.
    //   ~0.8  the per-league copy: « Valeur » has two names and two
    //         explanations, the board note and the table note each branch, and
    //         the captain card and the minors filter are now conditional.
    //   ~1.9  Turbopack re-splitting the page: 6 own chunks at d7c50cb, 8 here
    //         (a 19.5 KB chunk became two of 10.4), each with its own module
    //         wrappers. Not an import: the same modules, in more pieces.
    // 70 leaves about as much room as the old 65 did over 64.4. Over it: look
    // for an accidental import first, and only move the number with a
    // measurement like the one above.
    //
    // Measured again after the review follow-ups: 69.2 → 69.5. The +0.3 is the
    // per-league position vocabulary (`eligibility.groups`, `parseGroups`, the
    // filter and the VONA panel reading it instead of a module constant) and
    // the `fxpa` capability branches that drop the Ros% column, its range
    // filter and the « exclure les blessés » toggle where the league publishes
    // none of them. That leaves only ~0.5 KB of headroom: the next addition
    // here should expect to have to measure and justify a move to 71, not
    // assume the budget is roomy.
    //
    // Measured again for the Slapshot salary cap (full dynasty, cap on the 23
    // Active + Reserve): the A+B port alone built 69.7 on Repêchage, this tree
    // 72.4 (Mon équipe 71.1, Ballottage 70.5). Of that +2.7, after moving the
    // cap's words out of the planner's chunk (salary-copy.ts) and its money
    // format into league-copy: ~0.9 the table model's contract columns, sorts,
    // salary bound and per-league preset columns; ~0.5 the plan's cap use and
    // the contracts read in the provider (every Slapshot tab shows the cap
    // line); ~0.5 the dynasty reader's Slapshot records and the per-league
    // dynasty cache; ~0.3 the Repêchage tab's three lazy Slapshot pieces
    // (their bodies are separate chunks, loaded only by Slapshot); ~0.5 the
    // cells, the legend and the copy. One dynamic route serves both leagues,
    // so Captains carries these few KB too. 73 leaves ~0.6 KB: measure again
    // before adding anything here.
    //
    // Measured again for the Slapshot rules pass (per-game lineup locks in
    // the planner, the cap read over at most 23 counted players, season
    // totals over the league's own season): Repêchage 71.8 → 73.5, every
    // Fantrax tab +1.7 (Aujourd’hui 43.4 → 45.1). Of that, +2.2 KB raw /
    // ~0.8 KB gz is code (the gzip of the page's chunks concatenated: 69.7 →
    // 70.5); the other ~0.9 is Turbopack splitting the planner's chunk
    // (46.2 KB raw) in two (25.8 + 21.9), each compressed on its own. 74.5
    // leaves 1.0 KB.
    //
    // Deploy build (GITHUB_PAGES=true) after the draft follow-ups: the points-
    // over-replacement model (points-vor.ts and its seat fill, ~6.4 KB raw) is
    // now a chunk the provider imports only for a league it ranks, so no
    // Captains tab loads it: Joueurs 71.0 → 69.0, Ballottage 72.2 → 70.3, Mon
    // équipe 71.9 → 70.8. Repêchage 73.6 → 73.5: the same saving, spent on the
    // live-draft states every league's panel now has (the last good live
    // draft kept and dated, the background poll, the taken players' tags).
    // What remains Slapshot-only here is inline in synchronous paths (the
    // planner's per-game locks and cap line, the table's contract columns).
    //
    // Then those moved out (deploy build, measured against master e932c7a,
    // where Captains is the only Fantrax league: Repêchage 64.5, Mon équipe
    // 63.1, Ballottage 63.0, Joueurs 61.8, Aujourd’hui 39.6). Slapshot's
    // rules and words now reach its tabs through its OWN shell chunk
    // (CapLeagueShell, picked per league by the server adapter): the league
    // pack (cap-league-copy.ts: « Valeur (VOR) », the salary columns, the cap
    // alert, the closed-fxpa notice; cap-league-parts.tsx: the draft board,
    // the cap card, the contract cells), the contracts read, and the model
    // chunk it fetches (points-vor.ts with plan-kit.ts: the cap over the
    // counted spots, the per-game locks). Captains' tabs load none of it:
    // Repêchage 73.5 → 70.5, Mon équipe 70.8 → 68.9, Ballottage 70.3 → 68.4,
    // Joueurs 69.0 → 67.2, Aujourd’hui 45.2 → 43.9 (the local build: the same). The ~6 KB left over master is what every Fantrax
    // league shares: the config-driven slots and eligibility, per-league
    // caches, the live-draft states (background poll, dated last good read,
    // taken tags, the pool's names for the latest picks), the table's
    // per-league caps and presets. 73 keeps 2.5 KB of room and still catches
    // a Slapshot piece that slips back into a shared chunk.
    //
    // 2026-10-02 audit fixes, three branches merged (local build): Repêchage
    // 71.4 (projection fixes only) → 72.7 with the Fantrax fixes alone (the
    // rest-of-season waiver gain, cap-aware period totals and bench policy,
    // the fitted draft-availability noise) and 72.6 with the dynasty fixes
    // alone (one shared asset-score module, lottery / order odds for the
    // picks) → 73.9 with both. Each branch stayed under 73; together they
    // add ~2.5 KB to the same shared chunks. 74.5 keeps ~0.6 KB of room:
    // measure again before adding anything here.
    //
    // Management workstream (local builds, Repêchage): 74.1 at bd259b2 →
    // 74.4 the games-cap planner (capDayPlan: +45.9 points a team-season on
    // box scores) → 74.8 the planned cap model in the waiver gains (false
    // gains 9 → 5 of 110 in the replay) → 75.1 the salary-cap fit's call in
    // the plan (its body, cap-fit.ts, is the cap league's lazy plan kit).
    // 75.5 keeps ~0.4 KB.
    js: 75.5,
    htmlRaw: 200,
    htmlGz: 35,
  },
  // Slapshot (full dynasty with a salary cap, points): the Captains tabs'
  // chunks plus its own shell chunk (the league pack above: its words and
  // pieces, the contracts read). Its HTML is smaller: 20 lineup slots but a
  // 1-to-2-day matchup panel instead of a 7-to-14-day one.
  { label: "Slapshot · Aujourd’hui", match: isTab("slapshot", ["aujourdhui"]), js: 50, htmlRaw: 300, htmlGz: 40 },
  // Plafond (league contracts) and Actifs (asset scores): their own chunks, data fetched on demand (cap-plan.json, dynasty-table.json, fxea getDraftPicks).
  { label: "Slapshot · Plafond / Actifs", match: isTab("slapshot", ["plafond", "actifs"]), js: 45, htmlRaw: 100, htmlGz: 20 },
  { label: "Captains · Actifs", match: isTab("captains-dynasty", ["actifs"]), js: 45, htmlRaw: 100, htmlGz: 20 },
  {
    label: "Slapshot · autres onglets",
    match: isTab("slapshot", ["repechage", "joueurs", "mon-equipe"]),
    // Its own number since its shell chunk is its own. Deploy build: Repêchage
    // 72.8, Mon équipe 71.2, Joueurs 69.5 (local 72.8 / 71.2 / 69.4), i.e.
    // Captains + ~2.3 KB for the pack (cap-league-copy.ts ~3 KB raw of words,
    // CapLeagueShell, cap-league-parts.tsx, contracts-client.ts). Its model
    // (points over replacement, plan kit) and every piece's body stay lazy
    // chunks outside this count. 75.5 leaves about the room Captains has
    // (2.7 KB); over it, look for a shared import first. 2026-10-02: 74.9-75.0
    // on each audit-fix branch alone, 76.2 merged (the same ~2.5 KB as
    // Captains above); 77 keeps ~0.8 KB. Management workstream: 76.4 →
    // 77.5 (the same three as Captains above); 78 keeps ~0.5 KB.
    js: 78,
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
  { label: "Fiche de joueur", match: (p) => p === "joueur.html", js: 25, htmlRaw: 60, htmlGz: 12 },
  { label: "/league (stub), 404", match: (p) => ["league.html", "404.html", "_not-found.html"].includes(p), js: 5, htmlRaw: 60, htmlGz: 12 },
  { label: "/draft/light-the-lamp", match: (p) => p === "draft/light-the-lamp.html", js: 45, htmlRaw: 700, htmlGz: 75 },
  // Stand-alone live draft page for the Slapshot league (public/, no Next chunks):
  // its board is inlined, its script is inline.
  { label: "Slapshot · repêchage en direct", match: (p) => p === "slapshot-draft.html", js: 0, htmlRaw: 550, htmlGz: 120 },
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
