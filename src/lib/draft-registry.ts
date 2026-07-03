import { fetchJson } from "./nhl-api";
import type { DraftInfo } from "./profile-types";

export interface DraftPickRecord {
  year: number;
  round: number;
  pickInRound: number;
  overallPick: number;
  team: string;
  firstName: string;
  lastName: string;
}

export interface DraftRegistry {
  builtAt: string;
  byName: Record<string, DraftPickRecord>;
}

interface RawDraftPick {
  round: number;
  pickInRound: number;
  overallPick: number;
  teamAbbrev: string;
  firstName: { default: string };
  lastName: { default: string };
}

interface DraftYearResponse {
  draftYears: number[];
  picks: RawDraftPick[];
}

export function normalizeDraftName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function draftNameKey(firstName: string, lastName: string): string {
  return normalizeDraftName(`${firstName} ${lastName}`);
}

export function draftRecordToInfo(record: DraftPickRecord): DraftInfo {
  return {
    year: record.year,
    round: record.round,
    pickInRound: record.pickInRound,
    overallPick: record.overallPick,
    team: record.team,
  };
}

/** Fetch every NHL entry draft pick and index by normalized player name. */
export async function buildDraftRegistry(
  onProgress?: (msg: string) => void,
): Promise<DraftRegistry> {
  const meta = await fetchJson<DraftYearResponse>(
    "https://api-web.nhle.com/v1/draft/picks/2024/1",
  );
  const years = meta.draftYears.filter((y) => y >= 1979);
  const byName = new Map<string, DraftPickRecord>();

  for (const year of years) {
    for (let round = 1; round <= 7; round++) {
      onProgress?.(`Draft ${year} round ${round}`);
      try {
        const data = await fetchJson<DraftYearResponse>(
          `https://api-web.nhle.com/v1/draft/picks/${year}/${round}`,
        );
        for (const pick of data.picks ?? []) {
          const firstName = pick.firstName?.default ?? "";
          const lastName = pick.lastName?.default ?? "";
          if (!firstName || !lastName) continue;

          const key = draftNameKey(firstName, lastName);
          const record: DraftPickRecord = {
            year,
            round: pick.round,
            pickInRound: pick.pickInRound,
            overallPick: pick.overallPick,
            team: pick.teamAbbrev,
            firstName,
            lastName,
          };

          const existing = byName.get(key);
          if (!existing || record.year < existing.year) {
            byName.set(key, record);
          }
        }
      } catch {
        /* some early-year rounds may be empty */
      }
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  const byNameObj: Record<string, DraftPickRecord> = {};
  for (const [k, v] of byName) byNameObj[k] = v;

  return { builtAt: new Date().toISOString(), byName: byNameObj };
}

export function lookupDraftByName(
  registry: DraftRegistry,
  fullName: string,
): DraftPickRecord | null {
  const key = normalizeDraftName(fullName);
  if (registry.byName[key]) return registry.byName[key];

  const parts = key.split(" ");
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const first = parts[0];
    for (const [k, v] of Object.entries(registry.byName)) {
      if (k.endsWith(` ${last}`) && k.startsWith(`${first} `)) return v;
    }
  }

  return null;
}

export async function fetchPlayerLandingDraft(
  playerId: number,
): Promise<DraftInfo | null> {
  try {
    const landing = await fetchJson<{
      draftDetails?: {
        year: number;
        round: number;
        pickInRound: number;
        overallPick: number;
        teamAbbrev: string;
      };
    }>(`https://api-web.nhle.com/v1/player/${playerId}/landing`);
    if (!landing.draftDetails) return null;
    const d = landing.draftDetails;
    return {
      year: d.year,
      round: d.round,
      pickInRound: d.pickInRound,
      overallPick: d.overallPick,
      team: d.teamAbbrev,
    };
  } catch {
    return null;
  }
}

export async function resolvePlayerDraft(
  playerId: number,
  fullName: string,
  registry: DraftRegistry | null,
): Promise<DraftInfo | null> {
  const fromLanding = await fetchPlayerLandingDraft(playerId);
  if (fromLanding) return fromLanding;
  if (!registry) return null;
  const fromRegistry = lookupDraftByName(registry, fullName);
  return fromRegistry ? draftRecordToInfo(fromRegistry) : null;
}

/** 0 = undrafted; otherwise NHL entry draft overall pick (1–N). */
export function draftOverallPickFeature(draft: DraftInfo | null | undefined): number {
  if (!draft?.overallPick) return 0;
  return draft.overallPick;
}

export function draftRoundFeature(draft: DraftInfo | null | undefined): number {
  if (!draft?.round) return 0;
  return draft.round;
}
