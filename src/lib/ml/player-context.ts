import { ageFromBirthDate, parseBirthDate, seasonStartDate } from "../age";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { fetchJson, seasonIdToLabel, type PlayerLanding } from "../nhl-api";
import type { DraftInfo } from "../profile-types";
import {
  draftOverallPickFeature,
  draftRecordToInfo,
  draftRoundFeature,
  lookupDraftByName,
  type DraftRegistry,
} from "../draft-registry";
import type { PlayerBioContext, PlayerContractSeason } from "./context-types";

const BIO_CONCURRENCY = 8;
const CONTRACT_DELAY_MS = 120;

function parseMoney(raw?: string): number {
  if (!raw) return 0;
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function nameToSlug(first: string, last: string): string {
  return `${first}-${last}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function seasonLabelToStartYear(seasonLabel: string): number {
  return Number(seasonLabel.split("-")[0]);
}

function contractYearsRemainingAtSeason(
  contractEndYear: number,
  seasonLabel: string,
): number {
  const seasonStart = seasonLabelToStartYear(seasonLabel);
  return Math.max(0, contractEndYear - seasonStart);
}

export async function fetchPlayerLanding(playerId: number): Promise<PlayerLanding | null> {
  try {
    return await fetchJson<PlayerLanding>(
      `https://api-web.nhle.com/v1/player/${playerId}/landing`,
    );
  } catch {
    return null;
  }
}

const REGISTRY_PATH = join(process.cwd(), "src", "data", "draft-registry.json");

export function loadDraftRegistrySync(): DraftRegistry | null {
  if (!existsSync(REGISTRY_PATH)) return null;
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as DraftRegistry;
  } catch {
    return null;
  }
}

export function resolveDraftForBio(
  playerId: number,
  name: string,
  landing: PlayerLanding | null,
  registry: DraftRegistry | null,
): DraftInfo | null {
  if (landing?.draftDetails) {
    const d = landing.draftDetails;
    return {
      year: d.year,
      round: d.round,
      pickInRound: d.pickInRound,
      overallPick: d.overallPick,
      team: d.teamAbbrev,
    };
  }
  if (!registry) return null;
  const record = lookupDraftByName(registry, name);
  return record ? draftRecordToInfo(record) : null;
}

export function landingToBioContext(
  playerId: number,
  name: string,
  landing: PlayerLanding,
  registry: DraftRegistry | null,
): PlayerBioContext {
  const draft = resolveDraftForBio(playerId, name, landing, registry);
  return {
    playerId,
    birthDate: parseBirthDate(landing.birthDate) ?? landing.birthDate ?? null,
    heightInches: landing.heightInInches ?? 72,
    weightPounds: landing.weightInPounds ?? 190,
    shootsLeft: landing.shootsCatches?.toUpperCase().startsWith("L") ? 1 : 0,
    draftYear: draft?.year ?? 0,
    draftRound: draftRoundFeature(draft),
    draftOverallPick: draftOverallPickFeature(draft),
  };
}

export async function buildPlayerBioContexts(
  players: Array<{ playerId: number; name: string }>,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<number, PlayerBioContext>> {
  const registry = loadDraftRegistrySync();
  const map = new Map<number, PlayerBioContext>();
  let done = 0;

  for (let i = 0; i < players.length; i += BIO_CONCURRENCY) {
    const batch = players.slice(i, i + BIO_CONCURRENCY);
    await Promise.all(
      batch.map(async ({ playerId, name }) => {
        const landing = await fetchPlayerLanding(playerId);
        if (landing) {
          map.set(playerId, landingToBioContext(playerId, name, landing, registry));
        }
      }),
    );
    done += batch.length;
    onProgress?.(done, players.length);
    await new Promise((r) => setTimeout(r, 150));
  }

  return map;
}

interface CapWagesPlayer {
  nhlId?: number;
  contracts?: Array<{
    expiryStatus?: string;
    details?: Array<{ season?: string; capHit?: string }>;
  }>;
}

export async function fetchPlayerContractSeasons(
  playerId: number,
  firstName: string,
  lastName: string,
): Promise<PlayerContractSeason[]> {
  const slug = nameToSlug(firstName, lastName);
  const urls = [
    `https://capwages.com/players/${slug}`,
    `https://capwages.com/players/${lastName.toLowerCase()}-${firstName.toLowerCase()}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { Accept: "text/html" } });
      if (!res.ok) continue;

      const html = await res.text();
      const start = html.indexOf("__NEXT_DATA__");
      if (start < 0) continue;

      const jsonStart = html.indexOf(">", start) + 1;
      const jsonEnd = html.indexOf("</script>", jsonStart);
      const data = JSON.parse(html.slice(jsonStart, jsonEnd)) as {
        props?: { pageProps?: { player?: CapWagesPlayer } };
      };

      const player = data.props?.pageProps?.player;
      if (!player || (player.nhlId && player.nhlId !== playerId)) continue;

      const active = player.contracts?.[0];
      if (!active?.details?.length) return [];

      const endYearMatch = active.expiryStatus?.match(/(\d{4})/);
      const contractEndYear = endYearMatch ? Number(endYearMatch[1]) : 0;

      return active.details
        .filter((d) => d.season && d.capHit)
        .map((d) => ({
          playerId,
          seasonLabel: d.season!,
          capHitUsd: parseMoney(d.capHit),
          yearsRemaining: contractYearsRemainingAtSeason(contractEndYear, d.season!),
        }));
    } catch {
      continue;
    }
  }

  return [];
}

export async function buildContractSeasonMap(
  players: Array<{ playerId: number; name: string }>,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, PlayerContractSeason>> {
  const map = new Map<string, PlayerContractSeason>();
  let done = 0;

  for (const p of players) {
    const [firstName, ...rest] = p.name.split(" ");
    const lastName = rest.join(" ") || firstName;
    const seasons = await fetchPlayerContractSeasons(
      p.playerId,
      firstName,
      lastName,
    );
    for (const s of seasons) {
      map.set(`${s.playerId}|${s.seasonLabel}`, s);
    }
    done++;
    if (done % 25 === 0) onProgress?.(done, players.length);
    await new Promise((r) => setTimeout(r, CONTRACT_DELAY_MS));
  }

  onProgress?.(done, players.length);
  return map;
}

export function ageAtSeasonStart(
  birthDate: string | null,
  seasonId: number,
): number {
  if (!birthDate) return 0;
  const label = seasonIdToLabel(seasonId);
  return ageFromBirthDate(birthDate, seasonStartDate(label));
}

export function yearsSinceDraft(seasonId: number, draftYear: number): number {
  if (!draftYear) return 0;
  const seasonStartYear = Number(String(seasonId).slice(0, 4));
  return Math.max(0, seasonStartYear - draftYear);
}

/** @deprecated use draftOverallPickFeature — kept for migration only */
export function draftOverallLog(overallPick: number): number {
  if (!overallPick || overallPick >= 999) return 0;
  return overallPick / 224;
}
