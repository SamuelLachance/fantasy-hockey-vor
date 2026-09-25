import type { Position, SkaterCategory } from "../types";
import { SKATER_CATEGORIES } from "../types";
import {
  STARTING_SLOTS,
  type CategoryLeagueProfile,
  type LeagueCategory,
  type LeagueGoalieCategory,
  type RosterSlot,
  type StartingSlot,
} from "./types";

const ROSTER_SLOTS: readonly RosterSlot[] = [
  "C",
  "LW",
  "RW",
  "F",
  "D",
  "Util",
  "G",
  "BN",
  "IR+",
  "NA",
];
const GOALIE_CATS: readonly LeagueGoalieCategory[] = [
  "wins",
  "goalsAgainstAverage",
  "savePct",
  "shutouts",
];
const POSITIONS: readonly Position[] = ["C", "LW", "RW", "D", "G"];

function fail(msg: string): never {
  throw new Error(`league profile: ${msg}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate a profile JSON (hand-edited from pasted league settings) and
 * return it typed. Throws on anything the engine can't score, so a typo in a
 * category or slot name fails the board build instead of silently dropping
 * a category.
 */
export function parseLeagueProfile(raw: unknown): CategoryLeagueProfile {
  if (!isRecord(raw)) fail("not an object");
  const p = raw as unknown as CategoryLeagueProfile;
  if (!/^[a-z0-9-]+$/.test(String(p.slug))) fail("bad slug");
  if (p.scoring !== "h2h-categories") fail(`unsupported scoring ${p.scoring}`);
  if (!Number.isInteger(p.teams) || p.teams < 2 || p.teams > 32) {
    fail(`bad team count ${p.teams}`);
  }
  if (!isRecord(p.categories)) fail("missing categories");
  const skater = p.categories.skater;
  const goalie = p.categories.goalie;
  if (!Array.isArray(skater) || skater.length === 0) fail("no skater cats");
  for (const c of skater) {
    if (!(SKATER_CATEGORIES as readonly string[]).includes(c)) {
      fail(`unknown skater category ${c}`);
    }
  }
  if (!Array.isArray(goalie)) fail("goalie cats must be an array");
  for (const c of goalie) {
    if (!GOALIE_CATS.includes(c)) fail(`unknown goalie category ${c}`);
  }
  if (!isRecord(p.roster)) fail("missing roster");
  for (const slot of Object.keys(p.roster)) {
    if (!ROSTER_SLOTS.includes(slot as RosterSlot)) fail(`unknown slot ${slot}`);
  }
  for (const slot of ROSTER_SLOTS) {
    const n = p.roster[slot];
    if (!Number.isInteger(n) || n < 0) fail(`bad count for ${slot}`);
  }
  if (!isRecord(p.slotEligibility)) fail("missing slotEligibility");
  for (const slot of STARTING_SLOTS) {
    const eligible = p.slotEligibility[slot];
    if (!Array.isArray(eligible) || eligible.length === 0) {
      fail(`slotEligibility.${slot} missing`);
    }
    for (const pos of eligible) {
      if (!POSITIONS.includes(pos)) fail(`bad position ${pos} in ${slot}`);
    }
  }
  const rounds = draftRounds(p);
  if (p.draft?.rounds !== rounds) {
    fail(`draft.rounds ${p.draft?.rounds} ≠ drafted roster spots ${rounds}`);
  }
  if (!Number.isInteger(p.draft.pickSeconds) || p.draft.pickSeconds <= 0) {
    fail("bad pick clock");
  }
  if (Number.isNaN(Date.parse(p.draft.startsAt))) fail("bad draft time");
  if (
    p.draft.mySlot !== null &&
    (!Number.isInteger(p.draft.mySlot) ||
      p.draft.mySlot < 1 ||
      p.draft.mySlot > p.teams)
  ) {
    fail("bad draft.mySlot");
  }
  if (!Number.isInteger(p.matchupWeeks) || p.matchupWeeks < 1) {
    fail("bad matchupWeeks");
  }
  return p;
}

/**
 * Yahoo drafts every roster spot except IR/IR+/NA (those are filled in
 * season from players already on the roster), so rounds = starters + bench.
 */
export function draftRounds(profile: Pick<CategoryLeagueProfile, "roster">): number {
  const r = profile.roster;
  return (
    STARTING_SLOTS.reduce((sum, slot) => sum + (r[slot] ?? 0), 0) + (r.BN ?? 0)
  );
}

export function startingSlotCount(
  profile: Pick<CategoryLeagueProfile, "roster">,
): number {
  return STARTING_SLOTS.reduce((sum, slot) => sum + (profile.roster[slot] ?? 0), 0);
}

/** Starting slots in the order a lineup fills them (dedicated → flex). */
export function startingSlotsInFillOrder(
  profile: Pick<CategoryLeagueProfile, "roster">,
): StartingSlot[] {
  return STARTING_SLOTS.filter((s) => (profile.roster[s] ?? 0) > 0);
}

export function slotAccepts(
  profile: Pick<CategoryLeagueProfile, "slotEligibility">,
  slot: StartingSlot,
  positions: readonly Position[],
): boolean {
  const eligible = profile.slotEligibility[slot];
  return positions.some((pos) => eligible.includes(pos));
}

export function leagueCategories(
  profile: Pick<CategoryLeagueProfile, "categories">,
): LeagueCategory[] {
  return [...profile.categories.skater, ...profile.categories.goalie];
}

export function isGoalieCategory(cat: LeagueCategory): cat is LeagueGoalieCategory {
  return (GOALIE_CATS as readonly string[]).includes(cat);
}

export function isSkaterCategory(cat: LeagueCategory): cat is SkaterCategory {
  return !isGoalieCategory(cat);
}
