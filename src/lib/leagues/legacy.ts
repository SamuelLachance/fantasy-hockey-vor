/**
 * Old addresses and 404 recovery under static export (no server redirects
 * on GitHub Pages). Pure: `legacyTarget` / `recoverTarget` say where an
 * address goes; `recoveryScript` is the same logic as an ES5 inline script
 * for the legacy stub pages and `404.html` (it runs before hydration, and
 * without the React bundle).
 *
 * Paths here never carry the basePath; search strings start with "?" (or
 * are empty) and hashes with "#" (or are empty).
 */
import { LEAGUES, knownPaths, type LeagueTab } from "./registry";

export interface LegacyRule {
  from: "/league" | "/draft/light-the-lamp";
  slug: string;
  /** Where the address lands by default (explicit in the registry, never the league's default tab). */
  tab: LeagueTab;
  /** An old in-page section that is now a tab: "#repechage" → repechage. The hash is dropped. */
  hashTabs?: Partial<Record<string, LeagueTab>>;
  /** Section hashes kept on `tab` (the others are dropped). Without it, the hash is kept as is. */
  keepHashes?: readonly string[];
  /** `?vue=<preset>` → the tab that now shows that view. */
  presetTabs?: Partial<Record<string, LeagueTab>>;
  /** The view a tab starts from: `?vue=` naming it is redundant there and dropped. */
  tabBases?: Partial<Record<LeagueTab, string>>;
  /** Any of these params (an old player-explorer bookmark) → `tableTab`. */
  tableParams?: readonly string[];
  tableTab?: LeagueTab;
}

/** The old /league player-explorer URL params (except `vue`). */
export const OLD_EXPLORER_PARAMS: readonly string[] = [
  "q",
  "pos",
  "statut",
  "lnh",
  "type",
  "age",
  "fp",
  "fpm",
  "ros",
  "adp",
  "mineures",
  "sansblesses",
  "actifs",
  "verdict",
  "tendance",
  "phase",
  "pnhl",
  "eta",
  "dyn",
  "tri",
  "ordre",
  "cols",
  "page",
  "par",
];

/** Per-address details beyond the registry's `{ path, tab }`. */
const LEGACY_EXTRAS: Record<LegacyRule["from"], Omit<LegacyRule, "from" | "slug" | "tab">> = {
  "/league": {
    hashTabs: { "#repechage": "repechage", "#ballottage": "ballottage", "#explorateur": "joueurs" },
    keepHashes: ["#alertes", "#alignement", "#gardiens", "#plafonds", "#calendrier"],
    presetTabs: { repechage: "repechage", autonomes: "ballottage", equipe: "mon-equipe", espoirs: "joueurs" },
    tabBases: { joueurs: "tous", repechage: "repechage", ballottage: "autonomes", "mon-equipe": "equipe" },
    tableParams: OLD_EXPLORER_PARAMS,
    tableTab: "joueurs",
  },
  "/draft/light-the-lamp": {},
};

export const LEGACY_RULES: readonly LegacyRule[] = LEAGUES.flatMap((l) =>
  l.legacyPaths.map((p) => ({ from: p.path, slug: l.slug, tab: p.tab, ...LEGACY_EXTRAS[p.path] })),
);

const own = <T>(o: Partial<Record<string, T>> | undefined, k: string): T | undefined =>
  o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;

/** Where an old address goes (path without basePath, with query and hash). */
export function legacyTarget(rule: LegacyRule, search: string, hash: string): string {
  const params = new URLSearchParams(search.charAt(0) === "?" ? search.slice(1) : search);
  let tab = rule.tab;
  let rewritten = false;
  const vue = params.get("vue");
  const presetTab = vue === null ? undefined : own(rule.presetTabs, vue);
  const hashTab = hash ? own(rule.hashTabs, hash) : undefined;
  if (presetTab) {
    tab = presetTab;
    if (own(rule.tabBases, tab) === vue) {
      params.delete("vue");
      rewritten = true;
    }
  } else if (hashTab) {
    tab = hashTab;
  } else if (rule.tableTab && rule.tableParams && rule.tableParams.some((k) => params.has(k))) {
    tab = rule.tableTab;
  }
  let keptHash = hash;
  if (rule.keepHashes) keptHash = tab === rule.tab && rule.keepHashes.includes(hash) ? hash : "";
  else if (hashTab) keptHash = "";
  let qs: string;
  if (rewritten) {
    const s = params.toString();
    qs = s ? `?${s}` : "";
  } else {
    qs = search && search !== "?" ? (search.charAt(0) === "?" ? search : `?${search}`) : "";
  }
  return `/ligues/${rule.slug}/${tab}${qs}${keptHash}`;
}

/**
 * What a stub page or the 404 page should do with `pathname` (without
 * basePath): the address to go to, or null to stay. At most one hop: a
 * page that exists always answers null.
 */
export function recoverTarget(pathname: string, search: string, hash: string): string | null {
  let p = pathname || "/";
  if (p.length > 5 && p.slice(-5) === ".html") {
    p = p.slice(0, -5);
    if (p === "/index") p = "/";
  }
  while (p.length > 1 && p.charAt(p.length - 1) === "/") p = p.slice(0, -1);
  const changed = p !== pathname;
  for (const rule of LEGACY_RULES) {
    if (rule.from === p) return legacyTarget(rule, search, hash);
  }
  if (p === "/ligues") return `/${search}${hash}`;
  const m = /^\/ligues\/([^/]+)(?:\/([^/]+))?$/.exec(p);
  if (m) {
    const league = LEAGUES.find((l) => l.slug === m[1]);
    if (!league) return null;
    const tab = m[2];
    if (tab && (league.tabs as readonly string[]).includes(tab)) return changed ? `${p}${search}${hash}` : null;
    return `/ligues/${league.slug}/${league.defaultTab}${search}${hash}`;
  }
  if (changed && knownPaths().includes(p)) return `${p}${search}${hash}`;
  return null;
}

/**
 * ES5 body mirroring `legacyTarget` + `recoverTarget` (tested for identical
 * results in node:vm). No arrow functions, `let`/`const` or template
 * literals: it must parse in any browser that reaches a stub.
 */
const SCRIPT_BODY = [
  "function own(o,k){return o&&Object.prototype.hasOwnProperty.call(o,k)?o[k]:undefined;}",
  "function has(a,x){for(var i=0;i<a.length;i++){if(a[i]===x)return true;}return false;}",
  "function leg(r,search,hash){",
  "var P=new URLSearchParams(search.charAt(0)==='?'?search.slice(1):search);",
  "var tab=r.tab,rw=false,v=P.get('vue');",
  "var pt=v===null?undefined:own(r.presetTabs,v),ht=hash?own(r.hashTabs,hash):undefined;",
  "if(pt){tab=pt;if(own(r.tabBases,tab)===v){P['delete']('vue');rw=true;}}",
  "else if(ht){tab=ht;}",
  "else if(r.tableTab&&r.tableParams){for(var i=0;i<r.tableParams.length;i++){if(P.has(r.tableParams[i])){tab=r.tableTab;break;}}}",
  "var kh=hash;",
  "if(r.keepHashes){kh=tab===r.tab&&has(r.keepHashes,hash)?hash:'';}else if(ht){kh='';}",
  "var qs;",
  "if(rw){var s=P.toString();qs=s?'?'+s:'';}",
  "else{qs=search&&search!=='?'?(search.charAt(0)==='?'?search:'?'+search):'';}",
  "return '/ligues/'+r.slug+'/'+tab+qs+kh;",
  "}",
  "function rec(pathname,search,hash){",
  "var p=pathname||'/';",
  "if(p.length>5&&p.slice(-5)==='.html'){p=p.slice(0,-5);if(p==='/index')p='/';}",
  "while(p.length>1&&p.charAt(p.length-1)==='/')p=p.slice(0,-1);",
  "var changed=p!==pathname,i;",
  "for(i=0;i<D.r.length;i++){if(D.r[i].from===p)return leg(D.r[i],search,hash);}",
  "if(p==='/ligues')return '/'+search+hash;",
  "var m=/^\\/ligues\\/([^\\/]+)(?:\\/([^\\/]+))?$/.exec(p);",
  "if(m){var lg=null;for(i=0;i<D.l.length;i++){if(D.l[i].slug===m[1])lg=D.l[i];}",
  "if(!lg)return null;",
  "if(m[2]&&has(lg.tabs,m[2]))return changed?p+search+hash:null;",
  "return '/ligues/'+lg.slug+'/'+lg.defaultTab+search+hash;}",
  "if(changed&&has(D.k,p))return p+search+hash;",
  "return null;",
  "}",
  "function run(){",
  "var l=window.location,b=D.b,p=l.pathname;",
  "if(b){if(p===b)p='/';else if(p.indexOf(b+'/')===0)p=p.slice(b.length);else return;}",
  "var t=rec(p,l.search,l.hash);",
  "if(t!==null)l.replace(b+t);",
  "}",
  "try{run();}catch(e){}",
].join("");

/** Data the inline script needs (small, JSON-embedded). */
export function recoveryData(basePath: string) {
  return {
    b: basePath,
    r: LEGACY_RULES,
    k: knownPaths(),
    l: LEAGUES.map((l) => ({ slug: l.slug, tabs: l.tabs, defaultTab: l.defaultTab })),
  };
}

/**
 * Inline `<script>` body: `recoverTarget` for `location`, then
 * `location.replace(basePath + target)`. ES5 IIFE with its data embedded
 * (every "<" escaped, so no `</script>` can end it early), whole body in
 * try/catch.
 */
export function recoveryScript(basePath: string): string {
  const json = JSON.stringify(recoveryData(basePath)).replace(/</g, "\\u003c");
  return `(function(){var D=${json};${SCRIPT_BODY}})();`;
}
