/**
 * Season-by-season NHL cap hits (capwages.com player pages, the source
 * player-profiles.json already uses) for the Slapshot league's salary-cap
 * layer: src/data/dynasty/slapshot/contract-seasons.json.
 *
 * Why not profiles' `contract` alone: it keeps one cap hit and the page's
 * "years remaining", so a signed extension that starts in 2027-28 shows as
 * the 2026-27 cap hit (Celebrini: $18.8M listed, $975k ELC in 2026-27) and a
 * new deal that starts in 2026-27 can show 0 years remaining (Bedard).
 * Here every contract's per-season rows are kept.
 *
 * Polite: one request at a time, ≥ 1 s apart, descriptive User-Agent;
 * resumable (players already fetched are skipped unless --refresh).
 *
 * Run: npx tsx scripts/fetch-contract-seasons.ts [--limit N] [--refresh]
 */
import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import type { PlayerProfile } from "../src/lib/profile-types";

const OUT = join(process.cwd(), "src", "data", "dynasty", "slapshot", "contract-seasons.json");
const PROFILES = join(process.cwd(), "src", "data", "player-profiles.json");
const PLAYERS = join(process.cwd(), "src", "data", "players.json");
const UA = "fantasy-hockey-vor/0.1 (personal fantasy research; contract seasons; 1 req/s)";
const DELAY_MS = 1100;

export interface ContractSegment {
  /** Contract type as listed ("Entry-Level Contract", "Standard Contract (Extension)", …). */
  type: string | null;
  /** Status at the end of this contract ("UFA", "RFA", "RFA (Arb)", …). */
  exp: string | null;
  signed: string | null;
  /** [start year, cap hit USD] per season (2026 = 2026-27). */
  seasons: Array<[number, number]>;
}
export interface ContractSeasonsFile {
  fetchedAt: string;
  source: string;
  players: Record<string, { n: string; slug: string | null; segs: ContractSegment[]; err?: string }>;
}

const money = (s?: string) => {
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const slugOf = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * capwages spells some first names differently from the NHL (Nick Paul is
 * "nicholas-paul", Egor Chinakhov "yegor-chinakhov"): the other spellings
 * tried, one request each, only after the NHL spelling found no page.
 */
const FIRST_NAME_VARIANTS: Record<string, readonly string[]> = {
  nick: ["nicholas"],
  nicholas: ["nick"],
  sam: ["samuel"],
  samuel: ["sam"],
  zach: ["zachary", "zack"],
  zachary: ["zach", "zack"],
  zack: ["zach", "zachary"],
  alex: ["alexander", "alexandre"],
  alexander: ["alex"],
  joshua: ["josh"],
  josh: ["joshua"],
  kenneth: ["ken"],
  patrick: ["pat"],
  egor: ["yegor"],
  dmitri: ["dmitry", "dmitriy"],
  maxim: ["maksim", "max"],
  max: ["maxwell", "maxim"],
  georgii: ["georgi", "georgiy"],
  sergei: ["sergey"],
  arseny: ["arseni", "arseniy"],
  matthew: ["matt"],
  cam: ["cameron"],
  ben: ["benjamin"],
};

/** Slugs to try for a player: his NHL spelling (and its -1 / -2 homonyms), then first-name variants. */
export function slugCandidates(name: string): string[] {
  const base = slugOf(name);
  const [first, ...rest] = base.split("-");
  const variants = (FIRST_NAME_VARIANTS[first ?? ""] ?? []).map((v) => [v, ...rest].join("-"));
  return [...new Set([base, `${base}-1`, `${base}-2`, ...variants])];
}

interface CwContract {
  type?: string;
  expiryStatus?: string;
  signingDate?: string;
  details?: Array<{ season?: string; capHit?: string }>;
}

async function fetchPlayer(slug: string, nhlId: number): Promise<ContractSegment[] | "mismatch" | null> {
  const res = await fetch(`https://capwages.com/players/${slug}`, { headers: { Accept: "text/html", "User-Agent": UA } });
  if (!res.ok) return null;
  const html = await res.text();
  const at = html.indexOf("__NEXT_DATA__");
  if (at < 0) return null;
  const j = html.indexOf(">", at) + 1;
  const data = JSON.parse(html.slice(j, html.indexOf("</script>", j))) as {
    props?: { pageProps?: { player?: { nhlId?: number; contracts?: CwContract[] } } };
  };
  const pl = data.props?.pageProps?.player;
  if (!pl) return null;
  if (pl.nhlId && pl.nhlId !== nhlId) return "mismatch";
  return (pl.contracts ?? []).map((c) => ({
    type: c.type?.trim() ?? null,
    exp: c.expiryStatus?.trim() ?? null,
    signed: c.signingDate ?? null,
    seasons: (c.details ?? [])
      .map((d) => [Number((d.season ?? "").slice(0, 4)), money(d.capHit)] as [number, number | null])
      .filter((x): x is [number, number] => Number.isFinite(x[0]) && x[0] > 1990 && x[1] != null),
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const li = args.indexOf("--limit");
  const limit = li >= 0 ? Number(args[li + 1]) : Number.NaN;
  const refresh = args.includes("--refresh");
  const profiles = (JSON.parse(readFileSync(PROFILES, "utf8")) as { profiles: PlayerProfile[] }).profiles;
  const rank = new Map(
    (JSON.parse(readFileSync(PLAYERS, "utf8")) as { players: Array<{ id: number; rank?: number }> }).players.map((p) => [
      p.id,
      p.rank ?? 9999,
    ]),
  );
  const prev: ContractSeasonsFile = existsSync(OUT)
    ? (JSON.parse(readFileSync(OUT, "utf8")) as ContractSeasonsFile)
    : { fetchedAt: "", source: "", players: {} };
  // most fantasy-relevant first, so a partial run already covers the draft board
  const todo = profiles
    .filter((p) => refresh || !prev.players[p.id] || prev.players[p.id]!.err)
    .sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999) || a.id - b.id)
    .slice(0, Number.isFinite(limit) ? limit : undefined);
  console.log(`contract seasons: ${todo.length} to fetch (${Object.keys(prev.players).length} cached)`);
  mkdirSync(dirname(OUT), { recursive: true });
  let done = 0;
  const save = () => {
    prev.fetchedAt = new Date().toISOString();
    prev.source =
      "capwages.com player pages (__NEXT_DATA__ contracts[].details: season, capHit), fetched one at a time >= 1 s apart";
    writeFileAtomic(OUT, `${JSON.stringify(prev)}\n`);
  };
  for (const p of todo) {
    const slugs = slugCandidates(p.name);
    let got: ContractSegment[] | null = null;
    let slug: string | null = null;
    let err: string | undefined;
    for (const s of slugs) {
      try {
        const r = await fetchPlayer(s, p.id);
        await sleep(DELAY_MS);
        if (r === "mismatch") {
          err = "nhlId mismatch";
          continue;
        }
        if (r) {
          got = r;
          slug = s;
          err = undefined;
          break;
        }
        // No page under this spelling: the next candidate (a first-name variant) may have one.
        err = "not found";
        continue;
      } catch (e) {
        err = String(e).slice(0, 80);
        await sleep(DELAY_MS);
        break;
      }
    }
    prev.players[p.id] = { n: p.name, slug, segs: got ?? [], ...(err ? { err } : {}) };
    done++;
    if (done % 25 === 0) {
      save();
      console.log(`  ${done}/${todo.length}`);
    }
  }
  save();
  const errs = Object.values(prev.players).filter((x) => x.err).length;
  console.log(`OK: ${Object.keys(prev.players).length} players (${errs} without a page) -> ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
