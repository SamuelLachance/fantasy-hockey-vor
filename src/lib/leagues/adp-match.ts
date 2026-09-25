import type { Position } from "../types";

/** One row of a Fantrax ADP export: "Last, First", C/LW/RW/D/G, ADP. */
export interface AdpRow {
  name: string;
  pos: string;
  id: string;
  adp: number;
}

export interface AdpMatchPlayer {
  id: number;
  name: string;
  positions: readonly Position[];
  isGoalie: boolean;
}

export interface AdpMatch {
  adp: number;
  fantraxId: string;
  /** "name+group" (normal) or "name" (position groups disagreed). */
  method: "name+group" | "name";
}

export interface AdpMatchReport {
  matches: Map<number, AdpMatch>;
  /** Pool players sharing a name+group key: left unmatched on purpose. */
  ambiguousPlayers: string[];
  /** ADP rows with no pool player (prospects, retirees, name variants). */
  unmatchedRows: AdpRow[];
}

/**
 * Canonical first names, applied to both sides so either spelling meets the
 * other. From the Fantrax ↔ NHL matching audit: Fantrax uses short forms
 * (Zac, Cam, Dan) where the NHL has the long one, and transliterations drift
 * (Aleksei/Alexei, Vasili/Vasily).
 */
const FIRST_NAME_CANON: Record<string, string> = {
  alex: "alexander",
  aleksei: "alexei",
  alexey: "alexei",
  artyom: "artem",
  ben: "benjamin",
  cam: "cameron",
  chris: "christopher",
  dan: "daniel",
  danny: "daniel",
  danil: "daniil",
  evgeni: "evgeny",
  georgi: "georgii",
  joe: "joseph",
  josh: "joshua",
  matt: "matthew",
  max: "maxim",
  maxime: "maxim",
  maxwell: "maxim",
  mike: "michael",
  mikey: "michael",
  nick: "nicholas",
  sam: "samuel",
  sammy: "samuel",
  vasili: "vasily",
  zac: "zachary",
  zach: "zachary",
  zack: "zachary",
};

/**
 * Name key: accents stripped, lowercase, apostrophes and dots deleted
 * (Fantrax writes "OReilly", "Miller, J.T."; the NHL "O'Reilly", "J.T."),
 * parentheses and Jr./Sr. suffixes dropped, other symbols as spaces, first
 * name canonicalised, then all spaces removed.
 */
export function personNameKey(firstLast: string): string {
  const cleaned = firstLast
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\b(jr|sr|ii|iii)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned.split(" ");
  if (parts.length > 1) parts[0] = FIRST_NAME_CANON[parts[0]!] ?? parts[0]!;
  return parts.join("");
}

/** "Last, First" → "First Last" (names without a comma pass through). */
export function fantraxToFirstLast(name: string): string {
  const i = name.indexOf(",");
  if (i < 0) return name.trim();
  return `${name.slice(i + 1).trim()} ${name.slice(0, i).trim()}`;
}

export type PositionGroup = "F" | "D" | "G";

export function positionGroupOf(positions: readonly string[]): PositionGroup {
  if (positions.includes("G")) return "G";
  if (positions.includes("D") && !positions.some((p) => p === "C" || p === "LW" || p === "RW")) {
    return "D";
  }
  return "F";
}

/**
 * Link ADP rows to pool players.
 *
 * Pass 1 — name + position group (F/D/G, not exact slots: Fantrax and Yahoo
 * disagree on LW vs RW). Duplicate names inside the pool (two Elias
 * Petterssons: C and D) are split by the group; if two pool players still
 * share a key (two goalie Matt Murrays) nobody gets that ADP, since no team
 * field exists to break the tie. Several rows on one key (NJD Jack Hughes
 * ADP 15, LAK prospect Jack Hughes undrafted) → the lowest ADP wins: the pool
 * only holds NHL regulars.
 * Pass 2 — name only, when both sides are unique by name (Fantrax listing a
 * forward as D, or vice versa). No last-name or fuzzy rules: the audit found
 * them wrong 6 times out of 7.
 */
export function matchAdp(
  players: readonly AdpMatchPlayer[],
  rows: readonly AdpRow[],
): AdpMatchReport {
  const rowsByKey = new Map<string, AdpRow[]>();
  const rowsByName = new Map<string, AdpRow[]>();
  for (const row of rows) {
    if (!Number.isFinite(row.adp)) continue;
    const name = personNameKey(fantraxToFirstLast(row.name));
    const key = `${name}|${positionGroupOf([row.pos])}`;
    rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), row]);
    rowsByName.set(name, [...(rowsByName.get(name) ?? []), row]);
  }
  const playersByKey = new Map<string, AdpMatchPlayer[]>();
  const playersByName = new Map<string, AdpMatchPlayer[]>();
  for (const p of players) {
    const name = personNameKey(p.name);
    const group = p.isGoalie ? "G" : positionGroupOf(p.positions);
    const key = `${name}|${group}`;
    playersByKey.set(key, [...(playersByKey.get(key) ?? []), p]);
    playersByName.set(name, [...(playersByName.get(name) ?? []), p]);
  }

  const matches = new Map<number, AdpMatch>();
  const usedRows = new Set<AdpRow>();
  const ambiguous = new Set<string>();

  for (const [key, list] of playersByKey) {
    const candidates = rowsByKey.get(key);
    if (!candidates) continue;
    if (list.length > 1) {
      for (const p of list) ambiguous.add(p.name);
      continue;
    }
    const best = [...candidates].sort((a, b) => a.adp - b.adp)[0]!;
    matches.set(list[0]!.id, { adp: best.adp, fantraxId: best.id, method: "name+group" });
    for (const r of candidates) usedRows.add(r);
  }

  for (const [name, list] of playersByName) {
    if (list.length !== 1 || matches.has(list[0]!.id)) continue;
    const candidates = (rowsByName.get(name) ?? []).filter((r) => !usedRows.has(r));
    if (candidates.length !== 1) continue;
    matches.set(list[0]!.id, {
      adp: candidates[0]!.adp,
      fantraxId: candidates[0]!.id,
      method: "name",
    });
    usedRows.add(candidates[0]!);
  }

  return {
    matches,
    ambiguousPlayers: [...ambiguous].sort(),
    unmatchedRows: rows.filter((r) => !usedRows.has(r)),
  };
}
