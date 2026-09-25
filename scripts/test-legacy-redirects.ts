/**
 * Unit checks for old addresses and 404 recovery: the pure rules, then the
 * inline ES5 script run in node:vm against fake `location` objects, which
 * must redirect exactly where the rules say (both basePaths).
 * Run: npx tsx scripts/test-legacy-redirects.ts
 */
import { runInNewContext } from "vm";
import { FANTRAX_TABLE } from "../src/lib/fantrax/table";
import { FOCUS_PARAM, ownedParams, PRESET_PARAM } from "../src/lib/player-table/url";
import {
  LEGACY_RULES,
  OLD_EXPLORER_PARAMS,
  legacyTarget,
  recoverTarget,
  recoveryData,
  recoveryScript,
} from "../src/lib/leagues/legacy";
import { LEAGUES, knownPaths } from "../src/lib/leagues/registry";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const eq = (a: unknown, b: unknown, msg: string) =>
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/** [pathname, search, hash] → expected target (null = stay). */
const CASES: Array<[string, string, string, string | null]> = [
  ["/league", "", "", "/ligues/captains-dynasty/aujourdhui"],
  ["/league", "?team=abc", "", "/ligues/captains-dynasty/aujourdhui?team=abc"],
  ["/league", "?vue=espoirs", "#explorateur", "/ligues/captains-dynasty/joueurs?vue=espoirs"],
  ["/league", "?team=abc&vue=autonomes", "#explorateur", "/ligues/captains-dynasty/ballottage?team=abc"],
  ["/league", "?vue=repechage", "", "/ligues/captains-dynasty/repechage"],
  ["/league", "?vue=equipe&team=abc", "", "/ligues/captains-dynasty/mon-equipe?team=abc"],
  ["/league", "?statut=dispo&tri=vona", "", "/ligues/captains-dynasty/joueurs?statut=dispo&tri=vona"],
  ["/league", "?q=Lane%20Hutson", "", "/ligues/captains-dynasty/joueurs?q=Lane%20Hutson"],
  ["/league", "", "#repechage", "/ligues/captains-dynasty/repechage"],
  ["/league", "?team=abc", "#ballottage", "/ligues/captains-dynasty/ballottage?team=abc"],
  ["/league", "", "#explorateur", "/ligues/captains-dynasty/joueurs"],
  ["/league", "", "#alignement", "/ligues/captains-dynasty/aujourdhui#alignement"],
  ["/league", "?team=abc", "#calendrier", "/ligues/captains-dynasty/aujourdhui?team=abc#calendrier"],
  ["/league", "", "#inconnu", "/ligues/captains-dynasty/aujourdhui"],
  ["/league", "?vue=constructor", "", "/ligues/captains-dynasty/aujourdhui?vue=constructor"],
  ["/league/", "?team=abc", "", "/ligues/captains-dynasty/aujourdhui?team=abc"],
  ["/league.html", "", "", "/ligues/captains-dynasty/aujourdhui"],
  ["/ligues/captains-dynasty", "", "", "/ligues/captains-dynasty/aujourdhui"],
  ["/ligues/captains-dynasty/", "?team=abc", "", "/ligues/captains-dynasty/aujourdhui?team=abc"],
  ["/ligues/light-the-lamp/", "", "", "/ligues/light-the-lamp/repechage"],
  ["/ligues/light-the-lamp/inconnu", "", "", "/ligues/light-the-lamp/repechage"],
  ["/ligues/captains-dynasty/joueurs/", "?q=x", "", "/ligues/captains-dynasty/joueurs?q=x"],
  ["/ligues/captains-dynasty/joueurs.html", "", "", "/ligues/captains-dynasty/joueurs"],
  ["/ligues", "", "", "/"],
  ["/ligues/", "", "", "/"],
  ["/snake/", "", "", "/snake"],
  ["/snake/", "?p=fx%3A1", "", "/snake?p=fx%3A1"],
  ["/index.html", "", "", "/"],
  ["/draft/light-the-lamp", "?x=1", "#y", "/ligues/light-the-lamp/repechage?x=1#y"],
  ["/draft/light-the-lamp/", "", "", "/ligues/light-the-lamp/repechage"],
  // Pages that exist stay put (at most one hop, never a loop).
  ["/", "", "", null],
  ["/snake", "?p=x", "", null],
  ["/ligues/captains-dynasty/joueurs", "", "", null],
  ["/ligues/light-the-lamp/duel", "", "", null],
  ["/ligues/nope", "", "", null],
  ["/ligues/nope/joueurs", "", "", null],
  ["/nimporte", "", "", null],
  ["/nimporte/", "", "", null],
];

// ---- pure rules
for (const [path, search, hash, want] of CASES) {
  eq(recoverTarget(path, search, hash), want, `recover ${path}${search}${hash}`);
}
for (const [, , , want] of CASES) {
  if (want === null) continue;
  const again = recoverTarget(want.split(/[?#]/)[0]!, "", "");
  assert(again === null, `${want}: the target is a page that exists (no second hop)`);
}
{
  const rule = LEGACY_RULES.find((r) => r.from === "/league")!;
  eq(legacyTarget(rule, "", ""), "/ligues/captains-dynasty/aujourdhui", "stub target");
  eq(legacyTarget(rule, "team=abc", ""), "/ligues/captains-dynasty/aujourdhui?team=abc", "search without ?");
  const draft = LEGACY_RULES.find((r) => r.from === "/draft/light-the-lamp")!;
  eq(draft.tab, "repechage", "the draft address is pinned to Repêchage, not the league's default tab");
}
eq(
  [...OLD_EXPLORER_PARAMS].sort(),
  ownedParams(FANTRAX_TABLE).filter((k) => k !== PRESET_PARAM && k !== FOCUS_PARAM).sort(),
  "old explorer params = the explorer's URL params except vue",
);
eq(
  LEGACY_RULES.map((r) => r.from).sort(),
  LEAGUES.flatMap((l) => l.legacyPaths.map((p) => p.path)).sort(),
  "one rule per registry old address",
);

// ---- the inline script
for (const base of ["", "/fantasy-hockey-vor"]) {
  const script = recoveryScript(base);
  assert(!/=>|\bconst\b|\blet\b|`/.test(script), `${base || "local"}: ES5 only (no arrows, const/let, template literals)`);
  const json = JSON.stringify(recoveryData(base));
  assert(script.includes(json.replace(/</g, "\\u003c")), "data embedded as JSON");
  const dataPart = script.slice(script.indexOf("var D="), script.indexOf(";function own"));
  assert(!dataPart.includes("<"), "no raw < inside the embedded JSON");
  assert(script.startsWith("(function(){") && script.endsWith("})();"), "IIFE");

  const run = (pathname: string, search: string, hash: string): string[] => {
    const calls: string[] = [];
    const location = { pathname, search, hash, replace: (u: string) => calls.push(u) };
    runInNewContext(script, { window: { location }, URLSearchParams });
    return calls;
  };
  for (const [path, search, hash, want] of CASES) {
    const calls = run(`${base}${path}`, search, hash);
    eq(calls, want === null ? [] : [`${base}${want}`], `script ${base}${path}${search}${hash}`);
  }
  if (base) {
    eq(run(base, "", ""), [], "basePath root (Pages serves index.html): stay");
    eq(run("/ailleurs/league", "", ""), [], "outside the basePath: never redirect");
    eq(run(`${base}x/league`, "", ""), [], "basePath prefix must end at a slash");
  }
  // A throwing location never breaks the page.
  runInNewContext(script, { window: {}, URLSearchParams });
}
assert(knownPaths().length > 0, "known paths");

if (failed) process.exit(1);
console.log(`OK: legacy redirects (${CASES.length} cases × pure rules + inline script, 2 basePaths)`);
