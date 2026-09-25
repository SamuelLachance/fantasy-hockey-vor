/**
 * Fantrax player → NHL id matching. Fantrax exposes no NHL id, so we match
 * on name + current team + position group, then name only, with a small
 * hand-kept override file for nicknames and namesakes.
 *
 * Differences from the Yahoo matcher (`yahoo-fantasy.ts`), each of which
 * caused real misses or a wrong match on this league's rosters:
 * - apostrophes and dots are deleted, not spaced ("OReilly" = "O'Reilly",
 *   "KAndre" = "K'Andre");
 * - positions compare by group (F / D / G) — Fantrax has no LW/RW;
 * - each NHL id can be claimed once, so the LAK prospect Jack Hughes can
 *   never inherit the NJD star's projection.
 */

export type PositionGroup = "F" | "D" | "G";

/** First-name nicknames folded onto one spelling before comparing. */
const FIRST_NAME_ALIASES: Record<string, string> = {
  zach: "zachary",
  zack: "zachary",
  zac: "zachary",
  jake: "jacob",
  cam: "cameron",
  sam: "samuel",
  sammy: "samuel",
  mitch: "mitchell",
  will: "william",
  dan: "daniel",
  danny: "daniel",
  joe: "joseph",
  ben: "benjamin",
  tom: "thomas",
  tommy: "thomas",
  nate: "nathan",
  nick: "nicholas",
  nic: "nicholas",
  nico: "nicholas",
  nicolas: "nicholas",
  jon: "jonathan",
  tony: "anthony",
  andy: "andrew",
  greg: "gregory",
  pat: "patrick",
  vince: "vincent",
  mike: "michael",
  mikey: "michael",
  matt: "matthew",
  chris: "christopher",
  josh: "joshua",
  max: "maxim",
  maxime: "maxim",
  maxwell: "maxim",
  alex: "alexander",
  alexandre: "alexander",
  aleksandr: "alexander",
  egor: "yegor",
  evgenii: "evgeny",
  evgeni: "evgeny",
  artyom: "artem",
  ilia: "ilya",
  nikolay: "nikolai",
  dmitri: "dmitry",
  aleksei: "alexei",
  alexey: "alexei",
  sergey: "sergei",
  matvey: "matvei",
  vasili: "vasily",
  vasiliy: "vasily",
  georgi: "georgii",
  jimmy: "james",
  jim: "james",
  bobby: "robert",
  rob: "robert",
  phil: "phillip",
  philip: "phillip",
  danil: "daniil",
};

/**
 * Compact comparison key: accents stripped, apostrophes and dots deleted,
 * parenthesised nicknames and Jr./Sr. suffixes dropped, first name folded
 * through the alias table, spaces removed.
 */
export function nameKey(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = base.split(" ");
  const alias = FIRST_NAME_ALIASES[parts[0] ?? ""];
  if (alias) parts[0] = alias;
  return parts.join("");
}

/** Fantrax lists names as "Last, First". */
export function fantraxDisplayName(name: string): string {
  const i = name.indexOf(",");
  return i < 0 ? name.trim() : `${name.slice(i + 1).trim()} ${name.slice(0, i).trim()}`;
}

/** Groups from Fantrax `eligiblePos` ("W,C,F,Skt", "D,Skt", "G"). */
export function groupsFromEligible(eligiblePos: string): Set<PositionGroup> {
  const tokens = eligiblePos.split(",").map((t) => t.trim());
  const out = new Set<PositionGroup>();
  if (tokens.includes("G")) out.add("G");
  if (tokens.includes("D")) out.add("D");
  if (tokens.some((t) => t === "C" || t === "W" || t === "F")) out.add("F");
  return out;
}

/** Groups from repo positions (C / LW / RW / D / G). */
export function groupOfPosition(pos: string): PositionGroup {
  if (pos === "G") return "G";
  if (pos === "D") return "D";
  return "F";
}

export interface FantraxMatchPlayer {
  fantraxId: string;
  /** "Last, First" or "First Last". */
  name: string;
  /** Fantrax NHL team abbrev, "(N/A)" or empty when clubless. */
  team: string;
  groups: Set<PositionGroup>;
}

export interface NhlMatchCandidate {
  id: number;
  name: string;
  /** Current NHL team abbrev (normalized). */
  team: string;
  groups: Set<PositionGroup>;
}

export type MatchMethod = "override" | "name-team" | "name";

export interface MatchResult {
  nhlId: number;
  method: MatchMethod;
}

const overlaps = (a: Set<PositionGroup>, b: Set<PositionGroup>) =>
  [...a].some((g) => b.has(g));

/**
 * Two passes over the Fantrax pool:
 * 1. name + team. The group filter applies only when the key is ambiguous
 *    (Pettersson C vs D, both VAN) — a lone same-name same-team player is
 *    accepted even if the sites disagree on his position (Geertsen D vs LW).
 * 2. name only, for clubless / moved players: accepted only if exactly one
 *    unclaimed NHL candidate shares a group AND the Fantrax name + group is
 *    unique in the pool (so two Fantrax "Matt Murray"s never guess).
 * `overrides` win outright; `null` forces "no match".
 * `teamAlias` normalizes team codes on both sides (e.g. ARI → UTA).
 */
export function matchFantraxToNhl(
  fantrax: FantraxMatchPlayer[],
  nhl: NhlMatchCandidate[],
  overrides: Record<string, number | null> = {},
  teamAlias: (team: string) => string = (t) => t,
): Map<string, MatchResult> {
  const byNameTeam = new Map<string, NhlMatchCandidate[]>();
  const byName = new Map<string, NhlMatchCandidate[]>();
  for (const c of nhl) {
    const k = nameKey(c.name);
    const kt = `${k}|${teamAlias(c.team)}`;
    byNameTeam.set(kt, [...(byNameTeam.get(kt) ?? []), c]);
    byName.set(k, [...(byName.get(k) ?? []), c]);
  }

  const fxKeyCount = new Map<string, number>();
  for (const f of fantrax) {
    const k = nameKey(fantraxDisplayName(f.name));
    for (const g of f.groups) fxKeyCount.set(`${k}|${g}`, (fxKeyCount.get(`${k}|${g}`) ?? 0) + 1);
  }

  const out = new Map<string, MatchResult>();
  const claimed = new Set<number>();
  const decided = new Set<string>();

  for (const f of fantrax) {
    if (!(f.fantraxId in overrides)) continue;
    decided.add(f.fantraxId);
    const id = overrides[f.fantraxId];
    if (id == null) continue;
    out.set(f.fantraxId, { nhlId: id, method: "override" });
    claimed.add(id);
  }

  for (const f of fantrax) {
    if (decided.has(f.fantraxId)) continue;
    const team = f.team && f.team !== "(N/A)" ? teamAlias(f.team) : "";
    if (!team) continue;
    let c = byNameTeam.get(`${nameKey(fantraxDisplayName(f.name))}|${team}`) ?? [];
    if (c.length > 1) c = c.filter((x) => overlaps(x.groups, f.groups));
    c = c.filter((x) => !claimed.has(x.id));
    if (c.length !== 1) continue;
    out.set(f.fantraxId, { nhlId: c[0]!.id, method: "name-team" });
    claimed.add(c[0]!.id);
    decided.add(f.fantraxId);
  }

  for (const f of fantrax) {
    if (decided.has(f.fantraxId)) continue;
    const k = nameKey(fantraxDisplayName(f.name));
    const c = (byName.get(k) ?? []).filter(
      (x) => overlaps(x.groups, f.groups) && !claimed.has(x.id),
    );
    if (c.length !== 1) continue;
    if ([...f.groups].some((g) => (fxKeyCount.get(`${k}|${g}`) ?? 0) > 1)) continue;
    out.set(f.fantraxId, { nhlId: c[0]!.id, method: "name" });
    claimed.add(c[0]!.id);
  }

  return out;
}
