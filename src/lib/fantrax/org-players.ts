/**
 * NHL-organisation players in the Fantrax pools (investigation 2026-09-27):
 * everyone `src/data/nhl-rosters.json` ties to a club (current rosters,
 * prospect lists, the NHL search index's club players, unsigned draft
 * rights included). Neither the profiles nor the projections cover most of
 * them, so the syncs matched them to no Fantrax id: no NHL id, no birth
 * date, no draft, and the pool rule dropped every one without a projection,
 * an ADP, a roster spot or a recent draft (225 of a 2,342-player draftable
 * universe missing from the Slapshot pool, 98 from the Captains pool).
 *
 * Here: their match candidates and a second, stricter matching pass over
 * the Fantrax players the first pass left unmatched (no earlier match can
 * change), and their birth date and draft by NHL id for the pool (from the
 * lists, `src/data/nhl-org-bios.json` — `npm run nhl:org-bios` — and
 * `league-seasons.json`). Pure: no fs, no network.
 */
import { firstNamesCompatible, editDistance } from "./pool";
import {
  fantraxDisplayName,
  groupOfPosition,
  nameKey,
  type FantraxMatchPlayer,
  type MatchResult,
  type NhlMatchCandidate,
} from "./match";
import type { NhlListedPlayer, NhlListKind } from "../nhl-rosters";

export const NHL_ORG_BIOS_SCHEMA = 1;

/** One landing's bio: birth date, draft [year, overall pick, club] (null = undrafted), NHL position code. */
export interface NhlOrgBio {
  b: string | null;
  d: [number, number, string] | null;
  p: string;
}

export interface NhlOrgBiosFile {
  schema: typeof NHL_ORG_BIOS_SCHEMA;
  fetchedAt: string;
  source: string;
  /** NHL id → bio; null when the landing was not found. */
  players: Record<string, NhlOrgBio | null>;
}

/** A player landing (`/v1/player/{id}/landing`) → the bio the pools need. */
export function parseOrgBio(raw: unknown): NhlOrgBio {
  const l = (raw ?? {}) as {
    birthDate?: unknown;
    position?: unknown;
    draftDetails?: { year?: unknown; overallPick?: unknown; teamAbbrev?: unknown };
  };
  const b = typeof l.birthDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(l.birthDate) ? l.birthDate : null;
  const dd = l.draftDetails;
  const d =
    dd && typeof dd.year === "number" && typeof dd.overallPick === "number" && dd.overallPick > 0
      ? ([dd.year, dd.overallPick, typeof dd.teamAbbrev === "string" ? dd.teamAbbrev : ""] as [number, number, string])
      : null;
  return { b, d, p: typeof l.position === "string" ? l.position : "" };
}

/** One player per line (stable diffs). */
export function serializeOrgBios(file: NhlOrgBiosFile): string {
  const { players, ...head } = file;
  const rows = Object.entries(players).map(([id, v]) => `${JSON.stringify(id)}:${JSON.stringify(v)}`);
  return `${JSON.stringify(head).slice(0, -1)},"players":{\n${rows.join(",\n")}\n}}\n`;
}

/**
 * An organisation player as a match candidate. `known`: an earlier candidate
 * list (profiles, projections) has him, so the first pass already tried his
 * exact name; only the spelling step (3) may still take him.
 */
export type OrgMatchCandidate = NhlMatchCandidate & { known?: true };

/**
 * The organisation's players as match candidates (club normalized); those an
 * earlier candidate list has are flagged `known` (verifier 2026-09-28:
 * dropping them lost Nikita Okhotiuk, a profile player the first pass missed
 * on a spelling, Fantrax « Okhotyuk », in both leagues).
 */
export function orgMatchCandidates(
  players: readonly NhlListedPlayer[],
  known: ReadonlySet<number>,
  teamAlias: (team: string) => string = (t) => t,
): OrgMatchCandidate[] {
  return players.map((p) => ({
    id: p.id,
    name: p.name,
    team: teamAlias(p.team),
    groups: new Set([groupOfPosition(p.code)]),
    ...(known.has(p.id) ? { known: true as const } : {}),
  }));
}

/** "Last, First" (Fantrax) → first and family names. */
function split(fantraxName: string): { first: string; last: string } {
  const i = fantraxName.indexOf(",");
  if (i > 0) return { first: fantraxName.slice(i + 1).trim(), last: fantraxName.slice(0, i).trim() };
  const parts = fantraxName.trim().split(/\s+/);
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] ?? "" };
}

export interface OrgMatchOptions {
  /** Normalizes club codes on both sides (ARI → UTA…). */
  teamAlias?: (team: string) => string;
  /** Fantrax age (fxpa) of a Fantrax player, when known. */
  ageOf?: (fantraxId: string) => number | undefined;
  /** Birth year of an NHL player, when known. */
  birthYearOf?: (nhlId: number) => number | undefined;
  /** The season year the Fantrax ages are read in. */
  year?: number;
}

/**
 * Second pass for the organisation's players: only Fantrax players the first
 * pass left undecided (unmatched, no override) and NHL ids nobody claimed.
 * 1. same name and club (the club's candidates sharing a group when the key repeats);
 * 2. same name alone: one unclaimed candidate sharing a group, and the name
 *    unique on Fantrax in that group (the whole pool, matched or not);
 * 3. same club, a family name one or two letters away (transliterations:
 *    Silaev / Silayev, Okhotyuk / Okhotiuk; five letters or more) and a
 *    compatible first name, one-to-one both ways.
 * Steps 1-2 skip `known` candidates (the first pass tried their exact names
 * with its own rules); step 3 takes them too while nobody claimed them.
 * A known Fantrax age more than a year off the NHL birth year rejects a pair.
 */
export function matchFantraxToOrg(
  fantrax: readonly FantraxMatchPlayer[],
  candidates: readonly OrgMatchCandidate[],
  first: ReadonlyMap<string, MatchResult>,
  overrides: Readonly<Record<string, number | null>>,
  opts: OrgMatchOptions = {},
): Map<string, MatchResult> {
  const alias = opts.teamAlias ?? ((t: string) => t);
  const claimed = new Set([...first.values()].map((m) => m.nhlId));
  const open = fantrax.filter((f) => !first.has(f.fantraxId) && !(f.fantraxId in overrides));
  const cands = candidates.filter((c) => !claimed.has(c.id));
  const fresh = (c: OrgMatchCandidate) => !c.known;
  const overlaps = (a: ReadonlySet<string>, b: ReadonlySet<string>) => [...a].some((g) => b.has(g));
  const ageOk = (f: FantraxMatchPlayer, c: NhlMatchCandidate) => {
    const age = opts.ageOf?.(f.fantraxId);
    const by = opts.birthYearOf?.(c.id);
    if (age === undefined || by === undefined || opts.year === undefined) return true;
    return Math.abs(opts.year - by - age) <= 1;
  };
  const clubOf = (f: FantraxMatchPlayer) => (f.team && f.team !== "(N/A)" ? alias(f.team) : "");
  // Fantrax name + group counts over the whole pool (two « Matt Murray »s never guess)
  const fxKeyCount = new Map<string, number>();
  for (const f of fantrax) {
    const k = nameKey(fantraxDisplayName(f.name));
    for (const g of f.groups) fxKeyCount.set(`${k}|${g}`, (fxKeyCount.get(`${k}|${g}`) ?? 0) + 1);
  }
  const byNameTeam = new Map<string, OrgMatchCandidate[]>();
  const byName = new Map<string, OrgMatchCandidate[]>();
  const byTeam = new Map<string, OrgMatchCandidate[]>();
  for (const c of cands) {
    byTeam.set(c.team, [...(byTeam.get(c.team) ?? []), c]);
    if (!fresh(c)) continue;
    const k = nameKey(c.name);
    byNameTeam.set(`${k}|${c.team}`, [...(byNameTeam.get(`${k}|${c.team}`) ?? []), c]);
    byName.set(k, [...(byName.get(k) ?? []), c]);
  }
  const out = new Map<string, MatchResult>();
  const taken = new Set<number>();
  const take = (f: FantraxMatchPlayer, c: OrgMatchCandidate, method: MatchResult["method"]) => {
    out.set(f.fantraxId, { nhlId: c.id, method });
    taken.add(c.id);
  };

  // 1. name + club
  for (const f of open) {
    const team = clubOf(f);
    if (!team) continue;
    let c = byNameTeam.get(`${nameKey(fantraxDisplayName(f.name))}|${team}`) ?? [];
    if (c.length > 1) c = c.filter((x) => overlaps(x.groups, f.groups));
    c = c.filter((x) => !taken.has(x.id) && ageOk(f, x));
    if (c.length === 1) take(f, c[0]!, "org-name-team");
  }
  // 2. name alone
  for (const f of open) {
    if (out.has(f.fantraxId)) continue;
    const k = nameKey(fantraxDisplayName(f.name));
    const c = (byName.get(k) ?? []).filter((x) => overlaps(x.groups, f.groups) && !taken.has(x.id) && ageOk(f, x));
    if (c.length !== 1) continue;
    if ([...f.groups].some((g) => (fxKeyCount.get(`${k}|${g}`) ?? 0) > 1)) continue;
    take(f, c[0]!, "org-name");
  }
  // 3. spelling, one-to-one within the club
  const wants = new Map<string, OrgMatchCandidate[]>();
  const wantedBy = new Map<number, string[]>();
  for (const f of open) {
    if (out.has(f.fantraxId)) continue;
    const team = clubOf(f);
    if (!team) continue;
    const { first: fn, last } = split(f.name);
    const fam = nameKey(last);
    if (fam.length < 5) continue;
    const list = (byTeam.get(team) ?? []).filter((c) => {
      if (taken.has(c.id) || !overlaps(c.groups, f.groups) || !ageOk(f, c)) return false;
      // NHL names are "First Last…": the first word is the first name
      const words = c.name.trim().split(/\s+/);
      const cf = nameKey(words.slice(1).join(" "));
      return cf.length >= 5 && editDistance(cf, fam) <= 2 && firstNamesCompatible(fn, words[0] ?? "");
    });
    if (list.length !== 1) continue;
    wants.set(f.fantraxId, list);
    wantedBy.set(list[0]!.id, [...(wantedBy.get(list[0]!.id) ?? []), f.fantraxId]);
  }
  for (const f of open) {
    const list = wants.get(f.fantraxId);
    if (!list || (wantedBy.get(list[0]!.id) ?? []).length !== 1) continue;
    take(f, list[0]!, "org-spelling");
  }
  return out;
}

/** Birth date and draft by NHL id: what the pool's `bios` carries for a player. */
export interface OrgBio {
  birthDate?: string;
  /** A pick; null = undrafted; absent = unknown. */
  draft?: { year: number; overallPick: number; team: string } | null;
}

/**
 * Birth date and draft of the organisation's players the profiles lack, by
 * NHL id, the most direct source first: `nhl-org-bios.json` (the landing),
 * `league-seasons.json` (the landing, for players with NHL history), then
 * the lists' birth dates. A draft club unknown to the source comes from the
 * entry-draft picks (`pickTeam`, by year and overall pick).
 */
export function orgBios(
  players: readonly NhlListedPlayer[],
  sources: {
    bios?: Readonly<Record<string, NhlOrgBio | null>>;
    seasons?: Readonly<Record<string, { birth?: string; draft?: number | null; draftYear?: number | null } | null>>;
    pickTeam?: (year: number, overallPick: number) => string | undefined;
  },
): Map<number, OrgBio> {
  const out = new Map<number, OrgBio>();
  const valid = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  for (const p of players) {
    const bio = sources.bios?.[String(p.id)];
    const ls = sources.seasons?.[String(p.id)];
    const birthDate = valid(bio?.b) ?? valid(ls?.birth) ?? valid(p.birthDate);
    let draft: OrgBio["draft"];
    if (bio) draft = bio.d ? { year: bio.d[0], overallPick: bio.d[1], team: bio.d[2] || (sources.pickTeam?.(bio.d[0], bio.d[1]) ?? "") } : null;
    else if (ls) {
      draft =
        ls.draft != null && ls.draftYear != null
          ? { year: ls.draftYear, overallPick: ls.draft, team: sources.pickTeam?.(ls.draftYear, ls.draft) ?? "" }
          : null;
    }
    if (birthDate === undefined && draft === undefined) continue;
    out.set(p.id, { ...(birthDate ? { birthDate } : {}), ...(draft !== undefined ? { draft } : {}) });
  }
  return out;
}

/** Where the NHL lists each organisation player (roster first), by NHL id. */
export function orgMembership(players: readonly NhlListedPlayer[]): Map<number, NhlListKind> {
  return new Map(players.map((p) => [p.id, p.list] as const));
}
