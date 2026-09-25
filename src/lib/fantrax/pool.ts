/**
 * The player explorer's pool: `public/fantrax/pool.json`, one compact record
 * per RELEVANT Fantrax player, projected or not. `values.json` only carries
 * the players the planner can value (projected, or rostered); this file adds
 * the prospects a dynasty draft spends half its picks on.
 *
 * A player is in the pool when any of these holds:
 * - we project him (values.json `src: "proj"`);
 * - he has a Fantrax ADP (fxea getAdp; every draftable player with one);
 * - a team of this league rosters him, or Fantrax lists him on waivers here;
 * - he was picked in one of the last `RECENT_NHL_DRAFTS` NHL entry drafts
 *   (see `assignDraftPicks`: his NHL profile, else a one-to-one name match);
 * - at least `POOL_MIN_ROS` % of Fantrax leagues roster him (catches the
 *   prospects whose name the draft lists spell differently, and undrafted
 *   signings).
 *
 * Built by `scripts/fantrax-sync.ts` (pure function below, unit-tested);
 * read by the /league explorer in the browser. Keys are short and absent
 * fields are omitted: the file stays small and gzips well.
 */
import { FANTRAX_ICON, FANTRAX_NO_TEAM } from "./config";
import { bestFpg, seasonFp } from "./draft-inputs";
import { canonicalFirstName, fantraxDisplayName, nameKey } from "./match";
import type { ValueRecord } from "./snapshot-types";

export type PoolGroup = "C" | "W" | "D" | "G";
export const POOL_GROUPS: readonly PoolGroup[] = ["C", "W", "D", "G"];

/** How many NHL entry drafts (the latest included) count as "recent". */
export const RECENT_NHL_DRAFTS = 6;
/** Rostered in at least this % of Fantrax leagues: relevant whoever he is. */
export const POOL_MIN_ROS = 1;

/** Roster status on a fantasy team, one letter (Fantrax ACTIVE / RESERVE / INJURED_RESERVE / MINORS). */
export type PoolRosterStatus = "A" | "R" | "I" | "M";

/**
 * "p" = projected (season FP known); "e" = prospect (espoir: no projection,
 * and minors-eligible, 24 or younger, or a recent NHL draft pick); "n" = no
 * projection and not a prospect (veterans abroad, depth players).
 */
export type PoolSource = "p" | "e" | "n";

export interface PoolRecord {
  /** Fantrax id. */
  id: string;
  /** "First Last". */
  n: string;
  /** NHL team abbreviation; "" without an NHL club. */
  t: string;
  /** Eligible groups in C, W, D, G order ("CW", "D", "G"). */
  pos: string;
  age?: number;
  /** Birth date (YYYY-MM-DD) when an NHL profile has it. */
  bd?: string;
  /** "FA", "WW", or the id of the fantasy team rostering him at sync. */
  st: string;
  /** Roster status on that team. */
  rs?: PoolRosterStatus;
  /** Eligible for this league's Minors slots. */
  me?: 1;
  /** Fantrax status icons that matter (injury, minor leagues, suspension…; minors-eligible is `me`). */
  ic?: string[];
  /**
   * Not listed: absent from Fantrax's available / taken player lists at the
   * sync (retired, abroad, out), so the draft and waiver helpers skip him.
   * Only set when those lists were read.
   */
  nl?: 1;
  /** % of Fantrax leagues rostering him this week. */
  ros?: number;
  /** Fantrax ADP (all Fantrax leagues). */
  adp?: number;
  /** NHL entry draft: [year, overall pick, team]. */
  dr?: [number, number, string];
  /** Projected season fantasy points (league scoring). */
  fp?: number;
  /** Projected points per game played (per start for goalies). */
  fpg?: number;
  /** Projected games played (starts for goalies). */
  gp?: number;
  src: PoolSource;
  /** NHL id when matched (joins the dynasty and Snake files). */
  nhl?: number;
}

export interface PoolSnapshot {
  v: 1;
  fetchedAt: string;
  /** Projection season (players.json). */
  season: string;
  projectionsAt: string;
  /** NHL entry drafts counted as recent, inclusive. */
  recentDrafts: [number, number];
  counts: { total: number; projected: number; prospects: number; other: number };
  players: PoolRecord[];
}

/** One NHL entry draft pick. */
export interface PoolDraftPick {
  year: number;
  overallPick: number;
  team: string;
  firstName: string;
  lastName: string;
}

export interface PoolFlags {
  age?: number;
  ros?: number;
  icons?: readonly string[];
  minorsEligible?: boolean;
}

export interface PoolBuildInput {
  fetchedAt: string;
  season: string;
  projectionsAt: string;
  /** This league's player universe (fxea getLeagueInfo `playerInfo`). */
  leaguePlayers: Record<string, { eligiblePos: string; status: string }>;
  /** Identity by Fantrax id (fxea getPlayerIds: "Last, First" names, NHL team). */
  identity: Record<string, { name: string; team?: string } | undefined>;
  rosters: Record<string, ReadonlyArray<{ id: string; status: string }>>;
  values: Record<string, ValueRecord>;
  /** fxpa flags (age, Ros%, icons, minors eligibility) by Fantrax id. */
  flags: ReadonlyMap<string, PoolFlags>;
  /**
   * Ids on fxpa's main available / taken lists with a Ros% (what the draft
   * and waiver helpers call `state.ros`); null or absent when fxpa failed.
   */
  listed?: ReadonlySet<string> | null;
  adp: Record<string, number>;
  /** Fantrax id → NHL id. */
  nhlIds: Record<string, number>;
  /**
   * Birth date and draft by NHL id (player profiles). `draft: null` is the
   * profile saying "undrafted"; an absent key means unknown.
   */
  bios: ReadonlyMap<number, { birthDate?: string; draft?: { year: number; overallPick: number; team: string } | null }>;
  /**
   * NHL entry draft picks: every pick of the recent drafts (fetched by year,
   * so namesakes each keep theirs) plus the older registry picks.
   */
  draftPicks: readonly PoolDraftPick[];
  /** Normalizes NHL team codes (ARI → UTA…). */
  teamAlias?: (team: string) => string;
}

const ROSTER_STATUS: Record<string, PoolRosterStatus> = {
  ACTIVE: "A",
  RESERVE: "R",
  INJURED_RESERVE: "I",
  MINORS: "M",
};

/** Icons the pool keeps (minors eligibility travels as `me`). */
const POOL_ICONS = new Set<string>(
  Object.values(FANTRAX_ICON).filter((i) => i !== FANTRAX_ICON.minorsEligible),
);

/** Groups from Fantrax eligiblePos ("W,C,F,Skt" → "CW"). */
export function poolGroups(eligiblePos: string): string {
  const tokens = eligiblePos.split(",").map((t) => t.trim());
  return POOL_GROUPS.filter((g) => tokens.includes(g)).join("");
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** Whole years between a YYYY-MM-DD birth date and an instant. */
export function ageOn(birthDate: string, atMs: number): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) return undefined;
  const at = new Date(atMs);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = at.getUTCFullYear() - y;
  if (at.getUTCMonth() + 1 < mo || (at.getUTCMonth() + 1 === mo && at.getUTCDate() < d)) age--;
  return age >= 0 && age < 80 ? age : undefined;
}

/**
 * Age at the draft implied by today's age (or birth year): real picks are
 * 17 to 22. Keeps a 2026 draftee from inheriting a 1990s namesake's pick.
 */
export function plausibleDraftAge(
  draftYear: number,
  person: { age?: number; birthYear?: number },
  syncYear: number,
): boolean {
  const birthYear = person.birthYear ?? (person.age !== undefined ? syncYear - person.age : undefined);
  if (birthYear === undefined) return true;
  const draftAge = draftYear - birthYear;
  return draftAge >= 17 && draftAge <= 22;
}

/** Edit distance, for transliterated family names (Scherbakov / Shcherbakov). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Folded first-name tokens, parenthesised nicknames included: "Simon (Haoxi)" → simon, haoxi; "J.P." → jp. */
function firstNameTokens(first: string): string[] {
  const folded = first
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z]+/g, " ")
    .trim();
  return folded ? folded.split(" ").map(canonicalFirstName) : [];
}

/** Nicknames the shared alias table leaves out (it also feeds NHL id matching). */
const EXTRA_FIRST_NAMES: Record<string, string> = { joey: "joseph", ted: "theodore", teddy: "theodore" };

const commonPrefix = (x: string, y: string) => {
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
};

/** "L.J.", "AJ", "JP": initials only. */
const initialism = (first: string) => {
  const s = first.replace(/[.\s]/g, "");
  return /^[A-Z]{2,3}$/.test(s) ? s.toLowerCase() : null;
};

/** Two folded first-name tokens: equal, one letter apart, or the same start (3 letters, 4 when both are long). */
function sameFirstToken(x: string, y: string): boolean {
  if (x === y) return true;
  const short = Math.min(x.length, y.length);
  return commonPrefix(x, y) >= (short >= 5 ? 4 : 3) || (short >= 4 && editDistance(x, y) <= 1);
}

/**
 * Same person by first name: a shared token ("JP" in "Jeffrey (JP)"), a
 * nickname fold (Nick / Nicholas, Joey / Joseph), the same start (Gabe /
 * Gabriel, Charlie / Charlton, Andrei / Andrey), one letter apart (Aidan /
 * Aiden) or initials that hold the other's initial (L.J. / John). "Justin"
 * never passes for "Jake", nor "Chris" for "Nolan", nor "Josh" for "Joey".
 */
export function firstNamesCompatible(a: string, b: string): boolean {
  const fold = (t: string) => EXTRA_FIRST_NAMES[t] ?? t;
  const ta = firstNameTokens(a).map(fold);
  const tb = firstNameTokens(b).map(fold);
  if (ta.some((x) => tb.some((y) => sameFirstToken(x, y)))) return true;
  const ia = initialism(a);
  const ib = initialism(b);
  return (!!ia && tb.some((y) => ia.includes(y.charAt(0)))) || (!!ib && ta.some((x) => ib.includes(x.charAt(0))));
}

/** "Last, First" (Fantrax) or "First Last" → first and family names. */
function splitName(fantraxName: string | undefined, display: string): { first: string; last: string } {
  const i = fantraxName?.indexOf(",") ?? -1;
  if (fantraxName && i > 0) return { first: fantraxName.slice(i + 1).trim(), last: fantraxName.slice(0, i).trim() };
  const parts = display.trim().split(/\s+/);
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] ?? "" };
}

/** Latest NHL draft year in the registry, capped at the sync year. */
export function latestDraftYear(picks: readonly PoolDraftPick[], syncYear: number): number {
  let max = 0;
  for (const p of picks) if (p.year <= syncYear && p.year > max) max = p.year;
  return max || syncYear;
}

const pickId = (p: { year: number; overallPick: number }) => `${p.year}:${p.overallPick}`;

/** Who the draft matcher looks at: one entry per Fantrax player. */
export interface DraftMatchPerson {
  id: string;
  /** "First Last". */
  name: string;
  /** Fantrax "Last, First" when known (splits compound family names right). */
  fantraxName?: string;
  /** Current NHL club ("" without one). */
  team: string;
  age?: number;
  birthYear?: number;
  /** His NHL profile's draft: a pick, null = undrafted, undefined = no profile. */
  profileDraft?: { year: number; overallPick: number; team: string } | null;
  /** Rostered in this % of Fantrax leagues (tie-break between duplicates). */
  ros?: number;
}

/**
 * NHL entry draft pick of each player, one-to-one: a pick goes to one
 * Fantrax record at most. In order of trust:
 * 0. his NHL profile (a profile saying "undrafted" is final; one with an
 *    impossible draft age is ignored);
 * 1. same full name, age known and plausible for that draft;
 * 2. a recent pick of his current club whose family name is the same or a
 *    transliteration away (≤ 2 edits), with a compatible first name
 *    ("J.P." / "Jeffrey JP", "Scherbakov" / "Shcherbakov"); age known;
 * 3. same full name, age unknown (old duplicate records): only picks nobody
 *    above claimed.
 * Within a step a player takes a pick only when it is his one open
 * candidate, and a pick wanted by several players goes to the one on the
 * drafting club (then the most rostered), or to nobody when that ties.
 */
export function assignDraftPicks(
  people: readonly DraftMatchPerson[],
  picks: readonly PoolDraftPick[],
  opts: { syncYear: number; recentFrom: number; teamAlias?: (team: string) => string },
): Map<string, [number, number, string]> {
  const alias = opts.teamAlias ?? ((t: string) => t);
  const out = new Map<string, [number, number, string]>();
  const claimed = new Set<string>();
  const byKey = new Map<string, PoolDraftPick[]>();
  const recentByTeam = new Map<string, PoolDraftPick[]>();
  const seen = new Set<string>();
  for (const p of picks) {
    const id = pickId(p);
    if (seen.has(id)) continue;
    seen.add(id);
    const k = nameKey(`${p.firstName} ${p.lastName}`);
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
    if (p.year >= opts.recentFrom) {
      const t = alias(p.team);
      recentByTeam.set(t, [...(recentByTeam.get(t) ?? []), p]);
    }
  }

  const ageKnown = (w: DraftMatchPerson) => w.age !== undefined || w.birthYear !== undefined;
  const plausible = (w: DraftMatchPerson, p: { year: number }) => plausibleDraftAge(p.year, w, opts.syncYear);
  /** Tie-break between claimants: on the drafting club, then the most rostered; undefined when that ties. */
  const best = <T extends { who: DraftMatchPerson; pick: { team: string } }>(list: readonly T[]): T | undefined => {
    if (list.length === 1) return list[0];
    const score = (c: T) => [alias(c.pick.team) === c.who.team ? 1 : 0, c.who.ros ?? -1] as const;
    const ranked = [...list].sort((a, b) => score(b)[0] - score(a)[0] || score(b)[1] - score(a)[1]);
    const [s0, r0] = score(ranked[0]!);
    const [s1, r1] = score(ranked[1]!);
    return s0 !== s1 || r0 !== r1 ? ranked[0] : undefined;
  };

  // Step 0: profiles. Some profiles took their draft from an older name
  // lookup (a 1998-born goalie "drafted" in 2012): an impossible draft age,
  // or a pick another profile holds with a better claim, is no answer.
  const open: DraftMatchPerson[] = [];
  const profileClaims = new Map<string, Array<{ who: DraftMatchPerson; pick: { year: number; overallPick: number; team: string } }>>();
  for (const who of people) {
    const d = who.profileDraft;
    if (d === undefined || (d && !plausible(who, d))) open.push(who);
    else if (d) profileClaims.set(pickId(d), [...(profileClaims.get(pickId(d)) ?? []), { who, pick: d }]);
  }
  for (const [id, list] of profileClaims) {
    const winner = best(list);
    for (const c of list) {
      if (c === winner) {
        out.set(c.who.id, [c.pick.year, c.pick.overallPick, c.pick.team]);
        claimed.add(id);
      } else open.push(c.who);
    }
  }
  const exact = (w: DraftMatchPerson) => (byKey.get(nameKey(w.name)) ?? []).filter((p) => plausible(w, p));
  const spelling = (w: DraftMatchPerson): Array<{ pick: PoolDraftPick; dist: number }> => {
    if (!w.team) return [];
    const { first, last } = splitName(w.fantraxName, w.name);
    const fam = nameKey(last);
    if (!fam) return [];
    const res: Array<{ pick: PoolDraftPick; dist: number }> = [];
    for (const p of recentByTeam.get(w.team) ?? []) {
      if (!plausible(w, p) || !firstNamesCompatible(first, p.firstName)) continue;
      const pf = nameKey(p.lastName);
      const dist = pf === fam ? 0 : fam.length >= 5 ? editDistance(pf, fam) : Number.POSITIVE_INFINITY;
      if (dist <= 2) res.push({ pick: p, dist });
    }
    return res;
  };

  // Candidates per step (and, for spelling, per edit distance: closer first).
  type Cand = { who: DraftMatchPerson; pick: PoolDraftPick };
  const steps: Cand[][] = [];
  const known = open.filter(ageKnown);
  steps.push(known.flatMap((who) => exact(who).map((pick) => ({ who, pick }))));
  const sp = known.flatMap((who) => spelling(who).map((c) => ({ who, ...c })));
  for (const d of [0, 1, 2]) steps.push(sp.filter((c) => c.dist === d).map(({ who, pick }) => ({ who, pick })));
  steps.push(open.filter((w) => !ageKnown(w)).flatMap((who) => exact(who).map((pick) => ({ who, pick }))));

  for (const cands of steps) {
    for (let changed = true; changed; ) {
      changed = false;
      // Each open player's candidates still free at this step.
      const wants = new Map<string, Cand[]>();
      for (const c of cands) {
        if (out.has(c.who.id) || claimed.has(pickId(c.pick))) continue;
        wants.set(c.who.id, [...(wants.get(c.who.id) ?? []), c]);
      }
      // Players with a single candidate propose it.
      const proposals = new Map<string, Cand[]>();
      for (const list of wants.values()) {
        const picksOf = new Set(list.map((c) => pickId(c.pick)));
        if (picksOf.size !== 1) continue;
        const c = list[0]!;
        proposals.set(pickId(c.pick), [...(proposals.get(pickId(c.pick)) ?? []), c]);
      }
      for (const [id, list] of proposals) {
        const winner = best(list);
        if (!winner) continue;
        out.set(winner.who.id, [winner.pick.year, winner.pick.overallPick, winner.pick.team]);
        claimed.add(id);
        changed = true;
      }
    }
  }
  return out;
}

export function buildPool(input: PoolBuildInput): PoolSnapshot {
  const alias = input.teamAlias ?? ((t: string) => t);
  const syncMs = Date.parse(input.fetchedAt);
  const syncYear = new Date(syncMs).getUTCFullYear();
  const lastDraft = latestDraftYear(input.draftPicks, syncYear);
  const recentDrafts: [number, number] = [lastDraft - RECENT_NHL_DRAFTS + 1, lastDraft];

  const onTeam = new Map<string, { teamId: string; status: string }>();
  for (const [teamId, roster] of Object.entries(input.rosters)) {
    for (const r of roster) onTeam.set(r.id, { teamId, status: r.status });
  }

  // Everyone this league knows, with what the draft matcher needs.
  const people = new Map<string, DraftMatchPerson & { birthDate?: string; league: { eligiblePos: string; status: string } }>();
  for (const [id, league] of Object.entries(input.leaguePlayers)) {
    const who = input.identity[id];
    const value = input.values[id];
    if (!who?.name && !value) continue;
    const name = value?.n ?? fantraxDisplayName(who!.name);
    const flags = input.flags.get(id);
    const nhl = input.nhlIds[id];
    const bio = nhl !== undefined ? input.bios.get(nhl) : undefined;
    const birthDate = bio?.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(bio.birthDate) ? bio.birthDate : undefined;
    // Fantrax sends age 0 for some unsigned prospects: that is "unknown".
    const flagAge = flags?.age !== undefined && flags.age >= 14 && flags.age <= 50 ? flags.age : undefined;
    const age = flagAge ?? (birthDate ? ageOn(birthDate, syncMs) : undefined) ?? value?.age;
    const rawTeam = value?.t ?? who?.team ?? "";
    const team = !rawTeam || rawTeam === FANTRAX_NO_TEAM ? "" : alias(rawTeam);
    people.set(id, {
      id,
      name,
      ...(who?.name ? { fantraxName: who.name } : {}),
      team,
      ...(age !== undefined ? { age } : {}),
      ...(birthDate ? { birthDate, birthYear: Number(birthDate.slice(0, 4)) } : {}),
      // A profile answers for his draft; `bio.draft` undefined = no answer.
      ...(bio && bio.draft !== undefined ? { profileDraft: bio.draft } : {}),
      ...(flags?.ros !== undefined ? { ros: flags.ros } : {}),
      league,
    });
  }
  const drafts = assignDraftPicks([...people.values()], input.draftPicks, {
    syncYear,
    recentFrom: recentDrafts[0],
    teamAlias: alias,
  });

  const players: PoolRecord[] = [];
  for (const [id, who] of people) {
    const value = input.values[id];
    const flags = input.flags.get(id);
    const nhl = input.nhlIds[id];
    const dr = drafts.get(id);

    const projected = value?.src === "proj";
    const adp = input.adp[id];
    const rostered = onTeam.get(id);
    const onWaivers = who.league.status === "WW";
    const recentPick = !!dr && dr[0] >= recentDrafts[0];
    const rostersWidely = (flags?.ros ?? 0) >= POOL_MIN_ROS;
    if (!projected && adp === undefined && !rostered && !onWaivers && !recentPick && !rostersWidely) continue;

    const pos = poolGroups(value?.e ?? who.league.eligiblePos);
    if (!pos) continue;
    const minorsEligible = !!flags?.minorsEligible || (flags?.icons ?? []).includes(FANTRAX_ICON.minorsEligible);
    const icons = (flags?.icons ?? []).filter((i) => POOL_ICONS.has(i));
    const prospect = minorsEligible || (who.age !== undefined && who.age <= 24) || recentPick;
    const isGoalie = pos === "G";

    const rec: PoolRecord = {
      id,
      n: who.name,
      t: who.team,
      pos,
      ...(who.age !== undefined ? { age: who.age } : {}),
      ...(who.birthDate ? { bd: who.birthDate } : {}),
      st: rostered ? rostered.teamId : onWaivers ? "WW" : "FA",
      ...(rostered && ROSTER_STATUS[rostered.status] ? { rs: ROSTER_STATUS[rostered.status] } : {}),
      ...(minorsEligible ? { me: 1 as const } : {}),
      ...(icons.length ? { ic: [...new Set(icons)].sort() } : {}),
      ...(input.listed && !input.listed.has(id) ? { nl: 1 as const } : {}),
      ...(flags?.ros !== undefined && Number.isFinite(flags.ros) ? { ros: round(flags.ros, 1) } : {}),
      ...(adp !== undefined && Number.isFinite(adp) ? { adp: round(adp, 1) } : {}),
      ...(dr ? { dr } : {}),
      src: projected ? "p" : prospect ? "e" : "n",
      ...(nhl !== undefined ? { nhl } : {}),
    };
    if (projected && value) {
      rec.fp = round(seasonFp(value), 1);
      rec.fpg = round(isGoalie ? (value.gE ?? 0) : bestFpg(value), 2);
      rec.gp = value.gp;
    }
    players.push(rec);
  }
  players.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const count = (s: PoolSource) => players.filter((p) => p.src === s).length;
  return {
    v: 1,
    fetchedAt: input.fetchedAt,
    season: input.season,
    projectionsAt: input.projectionsAt,
    recentDrafts,
    counts: { total: players.length, projected: count("p"), prospects: count("e"), other: count("n") },
    players,
  };
}

/** Shape check for the browser (a truncated or foreign file is rejected). */
export function isPoolSnapshot(x: unknown): x is PoolSnapshot {
  if (!x || typeof x !== "object") return false;
  const p = x as Partial<PoolSnapshot>;
  return (
    p.v === 1 &&
    Array.isArray(p.players) &&
    p.players.every((r) => !!r && typeof r.id === "string" && typeof r.n === "string" && typeof r.st === "string")
  );
}
