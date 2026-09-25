/**
 * Lightweight UI contract checks (no browser): source needles that guard
 * real regressions (accessibility hooks, static-export pitfalls, noindex,
 * the draft helper's keyboard and storage contract), plus forbidden
 * patterns scanned across the whole source tree.
 * Run: npx tsx scripts/check-ui-contracts.ts
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const root = process.cwd();

const files: Record<string, string[]> = {
  // ---- site shell (every page)
  "src/app/layout.tsx": [
    'lang="fr-CA"',
    'href="#contenu"',
    'id="contenu"',
    "index: false",
    "template: SITE_TITLE_TEMPLATE",
    "<SiteHeader",
    "<SiteFooter",
    'colorScheme: "dark"',
    'themeColor: "#020617"',
    'locale: "fr_CA"',
    "appleWebApp",
  ],
  "src/components/site/SiteHeader.tsx": ["homeHref()", "<SiteNavLinks", "safe-area-inset-top"],
  "src/components/site/SiteNavLinks.tsx": [
    "aria-current",
    "aria-expanded",
    "aria-controls",
    "usePathname",
    "prefetch={false}",
    "suppressHydrationWarning",
    '"Escape"',
    "Ouvrir le menu",
    "Fermer le menu",
    "min-h-11",
    "focus-visible:ring-2",
    "motion-reduce:transition-none",
  ],
  "src/components/site/SiteFooter.tsx": [
    "FOOTER_SOURCE_HREF",
    'target="_blank"',
    'rel="noopener noreferrer"',
    "footerSourceLinkAriaLabel",
    "safe-area-inset-bottom",
    "min-h-11",
  ],
  "src/lib/site-nav.ts": ["navItems", "isNavActive", "Navigation principale", "homeHref()", 'kind: "document"'],
  "src/lib/site-footer.ts": ["FOOTER_SOURCE_HREF", "nouvel onglet", "lecture seule"],
  "src/lib/site.ts": ["SITE_ORIGIN", "SITE_URL", "SITE_BRAND", "SITE_SHORT_NAME", "export function withBasePath", "NEXT_PUBLIC_BUILD_TIME"],
  "src/lib/site-meta.ts": ["SITE_TITLE_TEMPLATE", "siteHomeTitle", "siteDefaultDescription", "siteManifestDescription"],
  "src/app/page.tsx": ["Mes ligues", "absolute: siteHomeTitle()", "<BoardLinkNotice", "homeLeagues()", "<SnakeHomeCard"],
  "src/lib/leagues/home-data.ts": ["LEAGUES.map", "fantraxHomeCard", "categoryHomeCard"],
  "src/components/home/LeagueHomeCard.tsx": ["aria-labelledby", "<Countdown", "prefetch={false}", "nouvel onglet"],
  "src/components/home/BoardLinkNotice.tsx": ['"#rankings"', "Fermer ce message", "useSyncExternalStore", "leaguePlayerPath(l.slug, oldLink)"],
  "src/components/home/CategoryDraftLocal.tsx": ["getDraftStore", "useSyncExternalStore"],
  "src/components/site/Countdown.tsx": ["useEffect", "Date.now()", "fmtCountdown"],
  "src/app/not-found.tsx": ["<RecoveryScript", "<RecoveryEffect", "notFoundTitle", "index: false", "homeHref()"],
  "src/app/error.tsx": ["errorTryAgainCopy", "errorBackHomeCopy", "errorBoundaryTitle", "homeHref()", "error.digest", "focus-visible:ring-2"],
  "src/app/global-error.tsx": [
    'lang="fr-CA"',
    "errorTryAgainCopy",
    "globalErrorTitle",
    "homeHref()",
    "globals.css",
    "--font-geist-sans",
    "console.error",
    "error.digest",
  ],
  "src/lib/app-shell-copy.ts": ["Réessayer", "Page introuvable", "Mes ligues"],
  "src/app/robots.ts": ["NEXT_PUBLIC_BASE_PATH", 'userAgent: "*"', "force-static", 'basePath ? `${basePath}/` : "/"'],
  "src/app/manifest.ts": [
    "siteManifestDescription",
    'lang: "fr-CA"',
    "standalone",
    "SITE_BRAND",
    "SITE_SHORT_NAME",
    "192x192",
    "512x512",
    'purpose: "maskable"',
  ],
  "src/app/opengraph-image.tsx": ["ImageResponse", "force-static", "SITE_BRAND", "1200", "630", "Mes ligues"],
  "src/app/twitter-image.tsx": ["OpenGraphImage", "force-static", "TwitterImage"],
  "src/components/BrandEyebrow.tsx": ["SITE_BRAND", "tracking-[0.2em]"],
  "src/app/globals.css": [
    "safe-area-inset-top",
    "safe-area-inset-bottom",
    "100dvh",
    "touch-action: manipulation",
    "text-size-adjust: 100%",
    ".focus\\:not-sr-only:focus",
    "prefers-reduced-motion: reduce",
  ],

  // ---- old addresses and 404 recovery (static export: no server redirects)
  "src/app/league/page.tsx": ["<LegacyRedirect", "index: false", "follow: true"],
  "src/components/site/LegacyRedirect.tsx": ["<RecoveryScript", "<noscript", 'http-equiv="refresh"', "<RecoveryEffect", "Cette page a déménagé"],
  "src/components/site/RecoveryScript.tsx": ["recoveryScript(", "dangerouslySetInnerHTML"],
  "src/components/site/RecoveryEffect.tsx": ["recoverTarget(", "location.replace", "useEffect"],
  "src/lib/leagues/legacy.ts": ["recoverTarget", "legacyTarget", "recoveryScript", 'replace(/</g, "\\\\u003c")', "try{run();}catch(e){}"],
  "src/app/draft/light-the-lamp/page.tsx": ["<CategoryDraftTab board={board} seed={seed} />", "snakeNhlSeed(", "Nouvelle adresse", 'leagueTabPath("light-the-lamp", "repechage")', "canonical: PATH"],

  // ---- league spaces: one static page per registry tab
  "src/app/ligues/[ligue]/layout.tsx": ["generateStaticParams", "dynamicParams = false", "<LeagueShell"],
  "src/app/ligues/[ligue]/[onglet]/page.tsx": [
    "generateStaticParams",
    "dynamicParams = false",
    "canonical: path",
    "generateMetadata",
    "<TabFrame",
    'locale: "fr_CA"',
  ],
  "src/components/league-shell/LeagueShell.tsx": ["SERVER_ADAPTERS", "<LeagueTabs", "<LeagueShellHeader"],
  "src/components/league-shell/LeagueTabs.tsx": [
    "useSelectedLayoutSegment",
    "aria-current",
    "prefetch={false}",
    "useTabSearch",
    "Sections de la ligue",
    "relative overflow-x-auto",
    "min-h-12",
  ],
  "src/components/league-shell/LeagueSwitcher.tsx": ["Changer de ligue", "switchLeaguePath", "aria-current", "prefetch={false}"],
  "src/components/league-shell/LeagueShellHeader.tsx": ['rel="noopener noreferrer"', "nouvel onglet", "<LeagueSwitcher"],
  "src/components/league-shell/TabFrame.tsx": ["<h1", "bleed"],
  "src/components/league-shell/tab-search.tsx": ["TabSearchContext"],
  "src/components/league-shell/server-adapters.tsx": ["SERVER_ADAPTERS", 'fullBleedTabs: ["repechage"]', "categoryBoard(entry)", "categorySnakeSeed(entry)"],
  // One route serves every league and tab: each kind's and tab's client code is its own chunk.
  "src/components/league-shell/client-parts.tsx": ['"use client"', "next/dynamic", "FantraxShellPart", "CategoryDraftPart", "CategoryPlayersPart", "CategoryTeamPart"],
  "src/components/league-shell/category-board.ts": ["readFileSync", '"board.json"', "snakeNhlSeed("],
  "src/lib/leagues/registry.ts": ["LEAGUES", "KIND_TABS", "TAB_META", "knownPaths", "legacyPaths"],
  "src/lib/leagues/routes.ts": ["homeHref", "leagueTabPath", "leagueTabHref", "switchLeaguePath"],

  // ---- Yahoo draft helper: keyboard, storage and layout contract (Sunday's draft)
  "src/components/draft/DraftHelper.tsx": [
    "getDraftStore",
    "onUndo",
    "TYPE_TO_SEARCH",
    "coarsePointer",
    "DRAFT_FILTERS",
    "--draft-bar-h",
    "max-w-[96rem]",
  ],
  "src/lib/draft/draft-store.ts": ["`vor-draft:${slug}:v1`", '"pageshow"', "state = null", '"storage"'],
  "src/components/draft/CategoryLeagueHeader.tsx": ["SnakeDisclaimerShort", "Détails de la ligue", "<details", "CATEGORY_FR"],
  "src/components/draft/CategoryTeamTab.tsx": [
    "getDraftStore",
    "useSyncExternalStore",
    "<DraftMyTeam",
    "cet appareil",
    "<SnakeVerdictsProvider kind=\"nhl\" seed={seed} complete>",
    "<CategoryPlayerTable",
    'base="equipe"',
    "Effectif au repêchage",
  ],
  // Repêchage: the draft helper as is, inside a complete Snake seed (no fetch during the draft).
  "src/components/draft/CategoryDraftTab.tsx": ["<SnakeVerdictsProvider kind=\"nhl\" seed={seed} complete>", "<DraftHelper board={board} />"],
  "src/components/draft/DraftPlayerRow.tsx": ["<SnakeNhlMini id={p.id} />", "memo(function DraftPlayerRow"],
  "src/components/draft/CategoryPlayersTab.tsx": ["<DraftMethodNote", "shortcuts={false}", "{table}"],
  "src/components/draft/category-table.tsx": [
    "categoryAdapter",
    "getDraftStore",
    "useSyncExternalStore",
    "<SnakeVerdictsProvider kind=\"nhl\" seed={seed} complete>",
    "useEffect",
    "Date.now()",
    "SnakeDetail",
    "sm:hidden",
    'base="tous"',
  ],
  "src/components/draft/CategoryTableFilters.tsx": ["FilterUiProps", "{actions}", "DRAFT_FILTERS", "<legend", "more.button"],
  "src/lib/draft/table.ts": ["displayRank", "matchesDraftFilter", "probAvailableAt", "DRAFT_DONE_AFTER_MS", "viewCtx", "oddsPickOf"],
  "src/components/player-table/fields.tsx": ["aria-expanded={open}", "aria-invalid", "<legend", "sr-only"],
  "src/components/draft/CategoryDuelTab.tsx": ["Duel", "OAuth", "Mon équipe"],

  // ---- the unified player table (every league's player lists)
  "src/components/player-table/PlayerTable.tsx": [
    "usePlayerTableView",
    "useCountAnnouncer",
    "useDeferredValue",
    "IntersectionObserver",
    "TABLE_COPY.notInPool",
    "wantFullSnake",
    "aria-labelledby",
  ],
  "src/components/player-table/usePlayerTableView.tsx": [
    "<Suspense",
    "useSearchParams",
    "History.prototype.replaceState",
    "URL_WRITE_DELAY_MS",
    '"popstate"',
    "sameViewSearch",
  ],
  "src/components/player-table/useCountAnnouncer.tsx": ['role="status"', 'aria-live="polite"', "ANNOUNCE_DELAY_MS"],
  "src/components/player-table/PlayerTableGrid.tsx": [
    "relative -mx-4 overflow-x-auto",
    "<caption",
    "aria-sort",
    'scope="row"',
    'scope="col"',
    "aria-expanded",
    "aria-controls",
    "sortButtonLabel(TABLE_COPY.player",
    "useHorizontalScrollShadow",
    "memo(",
    "motion-reduce:transition-none",
  ],
  "src/components/player-table/PlayerTableToolbar.tsx": [
    'role="search"',
    "aria-pressed",
    'autoComplete="off"',
    "data-1p-ignore",
    'enterKeyHint="search"',
    "aria-disabled={atBase",
    "max-sm:hidden",
  ],
  "src/components/player-table/PlayerTablePager.tsx": ["aria-disabled={page <= 1", "aria-disabled={page >= pages", "TABLE_COPY.pages"],
  "src/components/player-table/PlayerTableDetail.tsx": ["sticky left-3", "w-[min(48rem,calc(100vw-3.5rem))]"],
  "src/components/player-table/PlayerTableColumns.tsx": ["<legend", "TABLE_COPY.lazyColumn"],
  "src/lib/player-table/url.ts": ["ownedParams", "PRESET_PARAM", "FOCUS_PARAM", 'encodeRange(r) || "-"'],
  "src/lib/player-table/search.ts": ["NAME_PUNCTUATION", "foldSearchText"],
  "src/components/fantrax/fantrax-table.tsx": ["FANTRAX_ADAPTER", "peekFantraxPool", "hasDynasty", "fantraxFallbackRows", "ensureFullSnakeIndex"],
  "src/components/league-shell/TabLink.tsx": ["useTabSearch", "prefetch={false}", "leagueTabPath"],

  // ---- shared helpers kept for the unified player table
  "src/lib/search-fold.ts": ["foldSearchText", "foldSearchTextWithMap", "FOLD_MAP_CACHE_MAX", "foldMapCache"],
  "src/lib/player-table/highlight.tsx": ["highlightMatch", "HIGHLIGHT_QUERY_MAX", "<mark"],
  "src/hooks/useHorizontalScrollShadow.ts": [
    "useHorizontalScrollShadow",
    "applyHorizontalScrollChrome",
    "useLayoutEffect",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    'addEventListener("resize"',
  ],
  "src/lib/horizontal-scroll-shadow.ts": [
    "HORIZONTAL_SCROLL_SHADOW_PX",
    "horizontalScrollShadowVisible",
    "applyHorizontalScrollShadow",
    "applyHorizontalScrollChrome",
  ],
  "src/lib/clipboard.ts": ["copyText", "execCommand", "aria-hidden", "selectNodeContents", "getSelection"],
  "src/lib/publish-players.ts": ["perStatSigma", "compactBoardNumbers"],
  "src/lib/vor.ts": ["softCapCategoryZ", "PERIPHERAL"],
  "src/lib/format.ts": ["POSITION_COLORS"],

  // ---- Snake: public, noindex, French, disclaimer everywhere, lazy data
  "src/app/snake/page.tsx": [
    "SnakeExplorer",
    "SnakeMethodology",
    "SnakeDisclaimerShort",
    'canonical: "/snake"',
    "robots: { index: false",
    "safe-area-inset-bottom",
  ],
  "src/components/snake/SnakeExplorer.tsx": [
    "KeyFromUrl",
    "Suspense",
    "History.prototype.pushState",
    "loadSnakeIndex",
    'role="status"',
    "snake-carte-",
    "SnakeRankings",
  ],
  "src/components/snake/SnakePlayerDetail.tsx": [
    "loadSnakePlayer",
    "SnakeSynthesisCard",
    "SnakeDisclaimerShort",
    "SnakeOpinionItem",
    "tabIndex={-1}",
    "document.title",
    "Dans vos ligues",
    "leaguePlayerPath",
    "boardLeagues",
  ],
  "src/components/snake/SnakeOpinionItem.tsx": [
    "youtubeHref(o.vid, o.t)",
    'rel="noopener noreferrer"',
    "SnakeProbableMark",
    "formatSnakeDate(o.d)",
    "nouvel onglet",
  ],
  "src/components/snake/SnakeMethodology.tsx": ['id="sources"', "SNAKE_DISCLAIMER_FULL", "SNAKE_ATTRIBUTION_POLICY", "byShow"],
  "src/components/player-table/SnakeDetail.tsx": [
    "SnakeDisclaimerShort",
    "snakePlayerHref",
    "loadSnakePlayer",
    "youtubeHref(o.vid, o.t)",
    'rel="noopener noreferrer"',
    "nouvel onglet",
    "aria-busy",
  ],
  "src/components/snake/SnakeBoardChip.tsx": ["sr-only", 'aria-hidden="true"', "snakeChipTitle", "outline-dashed"],
  "src/components/snake/SnakeRankings.tsx": ["armed", "loadSnakeRankings", "IntersectionObserver", "rankingHeadingId"],
  // Verdicts load with the page (no idle wait); a complete seed never fetches.
  "src/components/snake/SnakeVerdicts.tsx": ["SnakeVerdictsProvider", "snakePlayerHref", "prefetch={false}", "SnakeNhlMini"],
  // The store half: the Captains provider's chunk holds it without the chips.
  "src/components/snake/SnakeVerdictsContext.tsx": ["SnakeVerdictsProvider", "useSyncExternalStore", "subscribeVerdicts", "complete"],
  "src/lib/snake/verdicts.ts": ["subscribeVerdicts", "loadSnakeFantrax", "loadSnakeNhl", "ensureFullSnakeIndex", "opts.complete"],
  "src/components/fantrax/WeekGrid.tsx": ["SnakeLeagueMini id={r.id} decorative"],
};

/** Files that must not contain a needle. */
const forbidden: Array<{ file: string; needle: string; why: string }> = [
  // `overflow` on the frame would break the draft helper's sticky bar and columns.
  { file: "src/components/league-shell/TabFrame.tsx", needle: "overflow-", why: "breaks position: sticky below it" },
  // A trailing slash 404s on GitHub Pages.
  { file: "src/lib/leagues/routes.ts", needle: "}/`", why: "no trailing slash in generated paths" },
  // Snake's verdicts belong to the tables: no idle wait, no Save-Data skip.
  { file: "src/lib/snake/verdicts.ts", needle: "scheduleIdle", why: "verdicts load with the page" },
  { file: "src/lib/snake/verdicts.ts", needle: "prefersSaveData", why: "verdicts load with the page" },
  // The Captains data layer no longer probes Snake files: verdicts come from src/lib/snake/verdicts.ts.
  { file: "src/lib/fantrax/league-client.ts", needle: "snake/", why: "Snake data loads through src/lib/snake" },
  // The draft helper itself is untouched by the tabs (Sunday's draft): its tab only wraps it.
  { file: "src/components/draft/CategoryDraftTab.tsx", needle: "useState", why: "the Repêchage tab only wraps the helper" },
  // The league layout's client chunk (every tab, Duel included) stays small:
  // the disclaimer reads its text from the tiny module, not Snake's whole copy.
  { file: "src/components/snake/SnakeDisclaimer.tsx", needle: '@/lib/snake/copy"', why: "keeps Snake's copy out of the league layout chunk" },
  { file: "src/components/snake/SnakeDisclaimer.tsx", needle: '@/lib/snake/url"', why: "keeps Snake's URL helpers out of the league layout chunk" },
  // The Captains provider holds the verdicts store only; the chips (and their copy) ship with the tabs.
  { file: "src/components/fantrax/FantraxLeagueProvider.tsx", needle: '@/components/snake/SnakeVerdicts"', why: "import the store from SnakeVerdictsContext" },
  // Categories leagues' pages inline their board and a complete Snake seed: nothing to fetch.
  { file: "src/components/draft/category-table.tsx", needle: "loadSnake", why: "the seed is complete" },
  { file: "src/components/draft/category-table.tsx", needle: "fetch(", why: "the board is inlined" },
];

let failed = 0;
const fail = (m: string) => {
  console.error(`FAIL: ${m}`);
  failed++;
};

// Catch duplicate object keys in this file (TS may also fail, but CI order varies).
{
  const self = readFileSync(join(root, "scripts/check-ui-contracts.ts"), "utf8");
  const keyRe = /^\s+"([^"]+\.[^"]+)": \[/gm;
  const seen = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(self))) {
    const k = m[1]!;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const [k, n] of seen) {
    if (n > 1) fail(`duplicate ui-contract key ${JSON.stringify(k)} (×${n})`);
  }
}

for (const [rel, needles] of Object.entries(files)) {
  const text = readFileSync(join(root, rel), "utf8");
  for (const n of needles) {
    if (!text.includes(n)) fail(`${rel} missing ${JSON.stringify(n)}`);
  }
}

for (const { file: rel, needle, why } of forbidden) {
  const text = readFileSync(join(root, rel), "utf8");
  if (text.includes(needle)) fail(`${rel} must not contain ${JSON.stringify(needle)} (${why})`);
}

// ---- tree-wide rules
function walk(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : [],
  );
}
const sources = walk("src").map((rel) => ({ rel, text: readFileSync(join(root, rel), "utf8") }));

for (const { rel, text } of sources) {
  // A loading.tsx turns each prerendered page into a streamed shell that only
  // shows its content once an inline script runs (never without JavaScript,
  // not before the next animation frame in a background tab).
  if (/^src\/app\/.*loading\.tsx$/.test(rel)) fail(`${rel}: no loading.tsx (the pages must be complete HTML)`);

  // One document language for the whole site, set by the root layout.
  if (text.includes("document.documentElement.lang")) fail(`${rel} switches the document language`);
  if (text.includes('hrefLang="en"')) fail(`${rel} links to an English page`);

  // The root layout owns the only <main> (global-error replaces the root layout).
  if (/<main[\s>]/.test(text) && rel !== "src/app/layout.tsx" && rel !== "src/app/global-error.tsx") {
    fail(`${rel} renders a <main> (the root layout owns it)`);
  }

  // Old addresses are only named by the registry, the redirect rules and their own pages.
  const legacyOk = [
    "src/lib/leagues/registry.ts",
    "src/lib/leagues/legacy.ts",
    "src/app/league/page.tsx",
    "src/app/draft/light-the-lamp/page.tsx",
  ];
  if (!legacyOk.includes(rel) && /"\/league"|"\/draft\/light-the-lamp"/.test(text)) {
    fail(`${rel} names an old address (use the registry and routes.ts)`);
  }

  // next/link must never point at the root route (its payload 404s on Pages),
  // an old address (a stub whose inline script cannot run after a client
  // navigation) or a league without its tab.
  if (rel.endsWith(".tsx")) {
    const linkRe = /<Link\b[\s\S]*?\bhref=(\{[^}]*\}|"[^"]*")/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(text))) {
      const href = m[1]!;
      if (/^"\/"$|^\{\s*"\/"\s*\}$/.test(href)) fail(`${rel}: <Link> to the root route (use a plain <a href={homeHref()}>)`);
      if (/["'`]\/league\b|["'`]\/draft\/light-the-lamp/.test(href)) fail(`${rel}: <Link> to an old address`);
      if (/`\/ligues\/\$\{[^}]*\}`/.test(href)) fail(`${rel}: <Link> to a league without its tab`);
    }
  }

  // Captains tab chunks: each tab is its own chunk next to the provider's
  // (both loaded by the page), so a tab that imported the provider's module,
  // the planner or the live reads would ship them a second time.
  if (/^src\/components\//.test(rel) && rel !== "src/components/league-shell/client-parts.tsx" && /from "[^"]*FantraxLeagueProvider"/.test(text)) {
    fail(`${rel} imports FantraxLeagueProvider (use ./fantrax-league-context)`);
  }
  const tabSide = [
    "src/components/fantrax/fantrax-table.tsx",
    "src/lib/fantrax/table.ts",
    "src/lib/fantrax/pool.ts",
    "src/lib/fantrax/pool-client.ts",
    "src/lib/fantrax/draft-inputs.ts",
  ];
  if (tabSide.includes(rel) && /^import (?!type )[^;]*from "(?:\.\/|@\/lib\/fantrax\/)(?:daily-plan|league-client|live)";/m.test(text)) {
    fail(`${rel} imports the planner or the live reads at run time (type-only imports are fine)`);
  }

  // The browser only reads Fantrax (fxea GETs).
  if (/^src\/(components\/(fantrax|league-shell|player-table)|app\/ligues)\//.test(rel) && /fxeaPost|fxpaPost/.test(text)) {
    fail(`${rel} calls a Fantrax POST`);
  }

  // Readable text stays at slate-400 or lighter on the slate-950 page (WCAG AA,
  // spec §12): darker greys only for decorative, aria-hidden marks.
  const lowContrastScope =
    /^src\/(app|components\/(home|player-table|site|league-shell|fantrax))\//.test(rel) ||
    /^src\/components\/draft\/(Category(LeagueHeader|DraftTab|PlayersTab|TeamTab|DuelTab|TableFilters)|category-table)\.tsx$/.test(rel);
  if (lowContrastScope) {
    text.split("\n").forEach((line, i) => {
      if (!line.includes("aria-hidden") && /(?<!placeholder:)\btext-slate-(500|600|700)\b/.test(line)) {
        fail(`${rel}:${i + 1}: text-slate-500 or darker on readable text (use text-slate-400 or lighter)`);
      }
    });
  }

  // The full Snake index (168 KB gz) is only for the Snake page and the « Opinions » column.
  const indexOk = ["src/lib/snake/client.ts", "src/lib/snake/verdicts.ts"];
  if (!indexOk.includes(rel) && !rel.startsWith("src/components/snake/") && /\bloadSnakeIndex\b/.test(text)) {
    fail(`${rel} loads the full Snake index (use ensureFullSnakeIndex)`);
  }
}

if (failed) process.exit(1);
console.log("OK: ui-contracts");
