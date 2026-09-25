/**
 * Unit checks for the league registry, the route helpers and the global
 * navigation: the registry must agree with each platform's committed data,
 * and no generated path may end with a slash (GitHub Pages 404s `/x/`).
 * Run: npx tsx scripts/test-league-registry.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { draftStorageKey } from "../src/lib/draft/draft-store";
import {
  KIND_TABS,
  LEAGUE_KINDS,
  LEAGUES,
  LEAGUE_TABS,
  TAB_META,
  getLeague,
  isLeagueTab,
  knownPaths,
  leagueChips,
  leagueParams,
  tabParams,
} from "../src/lib/leagues/registry";
import {
  homeHref,
  leaguePlayerPath,
  leagueTabHref,
  leagueTabPath,
  snakePath,
  switchLeaguePath,
} from "../src/lib/leagues/routes";
import { SITE_NAV_LABEL, isNavActive, navCurrent, navItems } from "../src/lib/site-nav";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const eq = (a: unknown, b: unknown, msg: string) =>
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const load = <T>(...parts: string[]) => JSON.parse(readFileSync(join(process.cwd(), ...parts), "utf8")) as T;

// ---- registry shape
{
  const slugs = LEAGUES.map((l) => l.slug);
  eq(new Set(slugs).size, slugs.length, "unique slugs");
  for (const l of LEAGUES) {
    assert(/^[a-z0-9-]+$/.test(l.slug), `${l.slug}: URL-safe slug`);
    assert(l.tabs.length > 0, `${l.slug}: has tabs`);
    assert(new Set(l.tabs).size === l.tabs.length, `${l.slug}: no duplicate tab`);
    for (const t of l.tabs) assert(KIND_TABS[l.kind].includes(t), `${l.slug}: tab ${t} is valid for ${l.kind}`);
    assert(l.tabs.includes(l.defaultTab), `${l.slug}: default tab is one of its tabs`);
    for (const p of l.legacyPaths) assert(l.tabs.includes(p.tab), `${l.slug}: legacy ${p.path} lands on one of its tabs`);
    assert(l.externalUrl === null || l.externalUrl.startsWith("https://"), `${l.slug}: external URL is https or null`);
    eq(leagueChips(l).length, 4, `${l.slug}: four header chips`);
  }
  for (const t of LEAGUE_TABS) {
    assert(!!TAB_META[t].label && !!TAB_META[t].heading && !!TAB_META[t].description, `${t}: French tab copy`);
    assert(/^[a-z-]+$/.test(t), `${t}: ASCII tab slug`);
  }
  eq(Object.keys(KIND_TABS).sort(), [...LEAGUE_KINDS].sort(), "every kind has its tabs");
  // Every kind has a server adapter (checked in source: the adapters module is server-only JSX).
  const adapters = readFileSync(join(process.cwd(), "src/components/league-shell/server-adapters.tsx"), "utf8");
  for (const k of LEAGUE_KINDS) assert(adapters.includes(`"${k}": `), `server adapter for ${k}`);
  const legacy = LEAGUES.flatMap((l) => l.legacyPaths.map((p) => p.path));
  eq(new Set(legacy).size, legacy.length, "each old address belongs to one league");
  assert(isLeagueTab("joueurs") && !isLeagueTab("explorateur"), "isLeagueTab");
  eq(getLeague("nope"), undefined, "unknown league");
}

// ---- registry vs platform data
{
  const captains = getLeague("captains-dynasty")!;
  const league = load<{ leagueId: string; teams: Array<{ id: string }> }>("src", "data", "fantrax", "league.json");
  eq(captains.teams, league.teams.length, "Captains: team count matches league.json");
  assert(league.teams.some((t) => t.id === captains.myTeamId), "Captains: my team is in league.json");
  assert(captains.externalUrl?.includes(league.leagueId) ?? false, "Captains: Fantrax link uses the synced league id");

  const ltl = getLeague("light-the-lamp")!;
  const profile = load<{ slug: string; teams: number; teamId: number; leagueId: number }>(
    "src",
    "data",
    "leagues",
    `${ltl.profileSlug}.json`,
  );
  eq(ltl.teams, profile.teams, "Light the Lamp: team count matches the profile");
  eq(ltl.myTeamId, String(profile.teamId), "Light the Lamp: my team matches the profile");
  assert(ltl.externalUrl?.endsWith(`/${profile.leagueId}`) ?? false, "Light the Lamp: Yahoo link uses the profile league id");
  const board = load<{ slug: string; league: { teams: number } }>("public", "leagues", ltl.profileSlug!, "board.json");
  eq(board.slug, ltl.profileSlug, "Light the Lamp: board slug");
  eq(board.league.teams, ltl.teams, "Light the Lamp: board team count");
  // The in-progress draft must survive the move: same storage key as before.
  eq(draftStorageKey(ltl.profileSlug!), "vor-draft:light-the-lamp:v1", "draft storage key unchanged");
  for (const l of LEAGUES.filter((x) => x.kind === "yahoo-categories")) {
    assert(!!l.profileSlug, `${l.slug}: categories league names its profile`);
  }
}

// ---- static params
eq(leagueParams(), LEAGUES.map((l) => ({ ligue: l.slug })), "league params");
eq(tabParams("captains-dynasty").map((p) => p.onglet), ["aujourdhui", "repechage", "joueurs", "ballottage", "mon-equipe"], "Captains tabs");
eq(tabParams("light-the-lamp").map((p) => p.onglet), ["repechage", "joueurs", "mon-equipe", "duel"], "Light the Lamp tabs");
eq(tabParams("nope"), [], "unknown league: no tabs");
{
  const paths = knownPaths();
  for (const p of ["/", "/snake", "/league", "/draft/light-the-lamp", "/ligues/captains-dynasty/aujourdhui", "/ligues/light-the-lamp/duel"]) {
    assert(paths.includes(p), `known path ${p}`);
  }
  eq(paths.length, 2 + LEAGUES.reduce((n, l) => n + l.tabs.length + l.legacyPaths.length, 0), "known path count");
}

// ---- routes (both basePaths)
const prevBase = process.env.NEXT_PUBLIC_BASE_PATH;
for (const base of ["", "/fantasy-hockey-vor"]) {
  if (base) process.env.NEXT_PUBLIC_BASE_PATH = base;
  else delete process.env.NEXT_PUBLIC_BASE_PATH;
  eq(homeHref(), `${base}/`, `home href (${base || "local"})`);
  const outputs: Array<[string, string, boolean]> = [];
  for (const l of LEAGUES) {
    for (const t of l.tabs) {
      outputs.push([`path ${l.slug}/${t}`, leagueTabPath(l.slug, t), false]);
      outputs.push([`href ${l.slug}/${t}`, leagueTabHref(l.slug, t), true]);
      outputs.push([`path ${l.slug}/${t}?team`, leagueTabPath(l.slug, t, "?team=x"), false]);
    }
    for (const target of LEAGUES) outputs.push([`switch ${l.slug}`, switchLeaguePath(l.tabs[0]!, target), false]);
    outputs.push([`player ${l.slug}`, leaguePlayerPath(l.slug, "fx:1"), false]);
  }
  outputs.push(["snake", snakePath(), false], ["snake player", snakePath("fx:1"), false]);
  for (const [label, out, withBase] of outputs) {
    const path = out.split(/[?#]/)[0]!;
    assert(!path.endsWith("/"), `${label}: no trailing slash (${out})`);
    assert(!out.includes("//"), `${label}: no double slash (${out})`);
    if (base) assert(out.startsWith(base) === withBase, `${label}: basePath only in *Href (${out})`);
  }
  for (const item of navItems()) {
    if (item.kind === "document") eq(item.href, `${base}/`, "Accueil is a plain link to the home page, with the basePath");
    else assert(!item.href.startsWith(base || "\u0000") && !item.href.endsWith("/"), `nav ${item.key}: next/link href (${item.href})`);
  }
}
if (prevBase === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
else process.env.NEXT_PUBLIC_BASE_PATH = prevBase;

eq(leagueTabPath("captains-dynasty", "joueurs", "team=x"), "/ligues/captains-dynasty/joueurs?team=x", "search without ?");
eq(leagueTabPath("captains-dynasty", "joueurs", "?"), "/ligues/captains-dynasty/joueurs", "empty search dropped");
eq(leaguePlayerPath("captains-dynasty", "fx:06abc"), "/ligues/captains-dynasty/joueurs?joueur=fx%3A06abc", "player path");
eq(leaguePlayerPath("captains-dynasty", "05wwg"), "/ligues/captains-dynasty/joueurs?joueur=05wwg", "a Fantrax row key opens his row");
{
  const ltl = getLeague("light-the-lamp")!;
  const captains = getLeague("captains-dynasty")!;
  eq(switchLeaguePath("joueurs", ltl), "/ligues/light-the-lamp/joueurs", "switch keeps a shared tab");
  eq(switchLeaguePath("ballottage", ltl), `/ligues/light-the-lamp/${ltl.defaultTab}`, "switch falls back to the default tab");
  eq(switchLeaguePath("duel", captains), "/ligues/captains-dynasty/aujourdhui", "Captains has no duel");
  eq(switchLeaguePath(null, captains), "/ligues/captains-dynasty/aujourdhui", "no tab: default");
}

// ---- global navigation
{
  const items = navItems();
  eq(SITE_NAV_LABEL, "Navigation principale", "nav landmark name");
  eq(items.map((i) => i.label), ["Accueil", ...LEAGUES.map((l) => l.shortName), "Snake"], "nav labels (French)");
  eq(items[0]?.kind, "document", "Accueil is a plain <a>");
  for (const l of LEAGUES) {
    const item = items.find((i) => i.key === l.slug)!;
    eq(item.href, leagueTabPath(l.slug, l.defaultTab), `${l.slug}: nav goes to the default tab`);
    eq(item.tag, l.platform, `${l.slug}: platform tag`);
  }
  const active = (path: string | null) => items.filter((i) => isNavActive(path, i)).map((i) => i.key);
  eq(active("/"), ["accueil"], "home active on /");
  eq(active("/snake"), ["snake"], "Snake active on /snake");
  eq(active("/ligues/captains-dynasty/joueurs"), ["captains-dynasty"], "league active on its tabs");
  eq(active("/ligues/light-the-lamp/duel"), ["light-the-lamp"], "other league active on its tabs");
  eq(active("/league"), ["captains-dynasty"], "old Captains address counts as the league");
  eq(active("/draft/light-the-lamp"), ["light-the-lamp"], "old draft address counts as the league");
  eq(active("/nimporte"), [], "unknown path: nothing active");
  eq(active("/_not-found"), [], "404: nothing active");
  eq(active("/ligues/captains-dynastyx/joueurs"), [], "prefix must end at the slug");
  eq(active(null), [], "no pathname");
  // aria-current: "page" only on the page the link opens, "true" inside a league.
  const current = (path: string) =>
    Object.fromEntries(items.flatMap((i) => (navCurrent(path, i) ? [[i.key, navCurrent(path, i)]] : [])));
  eq(current("/"), { accueil: "page" }, "home: page");
  eq(current("/snake"), { snake: "page" }, "Snake: page");
  eq(current("/ligues/captains-dynasty/aujourdhui"), { "captains-dynasty": "page" }, "league item on its default tab: page");
  eq(current("/ligues/captains-dynasty/joueurs"), { "captains-dynasty": "true" }, "league item on another tab: true, not page");
  eq(current("/draft/light-the-lamp"), { "light-the-lamp": "true" }, "old draft address: inside the league");
  eq(current("/nimporte"), {}, "unknown path: none");
}

if (failed) process.exit(1);
console.log(`OK: league registry (${LEAGUES.length} leagues, ${knownPaths().length} known paths)`);
