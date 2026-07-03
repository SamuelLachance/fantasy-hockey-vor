import {
  BASE_SEASON_IDS,
  computeFaceoffWins,
  fetchGoalieSummaries,
  fetchJson,
  fetchSkaterFaceoffs,
  fetchSkaterRealtime,
  fetchSkaterSummaries,
  fetchSkaterStatReport,
  fetchTeamRoster,
  fetchTeamStandings,
  mapNhlPosition,
  NHL_TEAMS,
  PROJECTION_SEASON,
  PROJECTION_SEASON_ID,
  seasonIdToLabel,
  type PlayerLanding,
  type RosterPlayer,
} from "./nhl-api";
import type {
  ContractEstimate,
  DraftInfo,
  InjuryProfile,
  PlayerBio,
  PlayerProfile,
  SeasonHistory,
  TeamContext,
} from "./profile-types";
import type { Position } from "./types";

const SEASON_SCHEDULED_GAMES = 82;
const PROFILE_CONCURRENCY = 6;

function finite(n: unknown, fallback = 0): number {
  const value = Number(n);
  return Number.isFinite(value) ? value : fallback;
}

function ageFromBirthDate(birthDate: string): number {
  const birth = new Date(birthDate);
  const ref = new Date("2026-10-01");
  let age = ref.getFullYear() - birth.getFullYear();
  const m = ref.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < birth.getDate())) age--;
  return age;
}

function rosterName(player: RosterPlayer): string {
  return `${player.firstName.default} ${player.lastName.default}`;
}

function careerStage(age: number, draft: DraftInfo | null): ContractEstimate {
  const yearsSinceDraft = draft ? 2026 - draft.year : Math.max(0, age - 18);
  let stage: ContractEstimate["careerStage"] = "prime";
  if (yearsSinceDraft <= 1) stage = "rookie";
  else if (yearsSinceDraft <= 3) stage = "entry_level";
  else if (age >= 34) stage = "decline";
  else if (age >= 30) stage = "veteran";

  const contractYearNote =
    stage === "rookie" || stage === "entry_level"
      ? "Likely on entry-level or early contract; motivation for bigger role"
      : stage === "decline"
        ? "Veteran contract year risk; possible reduced usage"
        : stage === "veteran"
          ? "Prime veteran years; stable role expected"
          : "Peak production window";

  return { yearsSinceDraft, careerStage: stage, contractYearNote };
}

function sumRecord(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: Record<string, number> = {};
  for (const k of keys) {
    out[k] = finite(a[k]) + finite(b[k]);
  }
  return out;
}

/** Merge two rows for the same player/season (e.g. mid-season trade). */
function mergeSeasonHistory(
  existing: SeasonHistory,
  incoming: SeasonHistory,
): SeasonHistory {
  const teams = new Set(
    `${existing.team},${incoming.team}`
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  );
  return {
    season: existing.season,
    seasonId: existing.seasonId,
    team: [...teams].join(","),
    gamesPlayed: existing.gamesPlayed + incoming.gamesPlayed,
    isGoalie: existing.isGoalie,
    stats: sumRecord(existing.stats, incoming.stats),
    // Realtime/advanced feeds are full-season totals — never sum duplicates.
    advanced: existing.advanced,
  };
}

function upsertSeason(seasons: SeasonHistory[], season: SeasonHistory): void {
  const idx = seasons.findIndex((s) => s.seasonId === season.seasonId);
  if (idx >= 0) {
    seasons[idx] = mergeSeasonHistory(seasons[idx], season);
  } else {
    seasons.push(season);
  }
}

/** Collapse duplicate per-team season rows left over from older collects. */
export function consolidateSeasonHistory(
  seasons: SeasonHistory[],
): SeasonHistory[] {
  const byId = new Map<number, SeasonHistory>();
  for (const s of seasons) {
    const existing = byId.get(s.seasonId);
    if (existing) {
      byId.set(s.seasonId, mergeSeasonHistory(existing, s));
    } else {
      byId.set(s.seasonId, { ...s });
    }
  }
  return [...byId.values()].sort((a, b) => a.seasonId - b.seasonId);
}

export function normalizeProfile(profile: PlayerProfile): PlayerProfile {
  const teamHistory = consolidateSeasonHistory(profile.teamHistory);
  const injury = buildInjuryProfile(teamHistory, profile.isGoalie);
  const partial = {
    ...profile,
    teamHistory,
    injury,
    advancedSeasonLatest:
      teamHistory.length > 0
        ? teamHistory[teamHistory.length - 1].advanced
        : {},
  };
  return {
    ...partial,
    contextNarrative: buildContextNarrative(partial),
  };
}

function buildInjuryProfile(
  seasons: SeasonHistory[],
  isGoalie: boolean,
): InjuryProfile {
  const recent = seasons
    .filter((s) => s.gamesPlayed > 0)
    .slice(-3)
    .map((s) => s.gamesPlayed);
  const lastGp = recent[recent.length - 1] ?? 0;
  const avg = recent.length
    ? recent.reduce((a, b) => a + b, 0) / recent.length
    : 0;
  const missed = Math.max(0, SEASON_SCHEDULED_GAMES - lastGp);
  const durability = Math.min(1, avg / SEASON_SCHEDULED_GAMES);

  let trend: InjuryProfile["trend"] = "healthy";
  let note = "Consistent availability";
  if (durability < 0.65 || missed >= 20) {
    trend = "injury_prone";
    note = `Missed ~${missed} games last season; durability concern`;
  } else if (durability < 0.85 || missed >= 10) {
    trend = "moderate";
    note = `Missed ~${missed} games last season`;
  }

  if (isGoalie && lastGp < 30) {
    trend = "moderate";
    note = "Limited starts last season; platoon or injury risk";
  }

  return {
    gamesPlayedLastSeason: lastGp,
    gamesMissedLastSeason: missed,
    avgGamesPlayedLast3: Math.round(avg),
    durabilityScore: Math.round(durability * 100) / 100,
    trend,
    note,
  };
}

function buildContextNarrative(profile: Omit<PlayerProfile, "contextNarrative" | "collectedAt">): string {
  const lines: string[] = [
    `${profile.name} (${profile.position}, ${profile.team})`,
    `Age ${profile.bio.age}, ${profile.bio.heightInches}" / ${profile.bio.weightPounds}lb, shoots ${profile.bio.shootsCatches}`,
  ];

  if (profile.draft) {
    lines.push(
      `Drafted ${profile.draft.year} round ${profile.draft.round} (#${profile.draft.overallPick} overall) by ${profile.draft.team}`,
    );
  } else {
    lines.push("Undrafted or draft data unavailable");
  }

  const teams = [...new Set(profile.teamHistory.map((s) => s.team))];
  if (teams.length > 1) {
    lines.push(`Team history: ${teams.join(" → ")} (recent change affects linemates/usage)`);
  }

  lines.push(
    `Team ${profile.teamContext.teamAbbrev} ranks #${profile.teamContext.leagueRank} (${(profile.teamContext.pointsPct * 100).toFixed(1)}% pts), ${profile.teamContext.goalsForPerGame.toFixed(2)} GF/G`,
  );
  lines.push(`Durability: ${profile.injury.trend} — ${profile.injury.note}`);
  lines.push(`Contract stage: ${profile.contract.careerStage} — ${profile.contract.contractYearNote}`);

  if (profile.awards.length > 0) {
    lines.push(`Awards: ${profile.awards.slice(0, 5).join(", ")}`);
  }

  const last = profile.teamHistory[profile.teamHistory.length - 1];
  if (last) {
    lines.push(
      `Last season (${last.season}): ${last.gamesPlayed} GP, key stats ${JSON.stringify(
        Object.fromEntries(
          Object.entries(last.stats).filter(([k]) =>
            ["goals", "assists", "points", "shots", "wins", "savePct"].includes(k),
          ),
        ),
      )}`,
    );
  }

  return lines.join(". ");
}

async function fetchPlayerLanding(id: number): Promise<PlayerLanding | null> {
  try {
    return await fetchJson<PlayerLanding>(
      `https://api-web.nhle.com/v1/player/${id}/landing`,
    );
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

export async function collectAllProfiles(
  onProgress?: (done: number, total: number) => void,
  limit?: number,
): Promise<PlayerProfile[]> {
  const standings = await fetchTeamStandings();
  const teamMap = new Map(standings.map((t) => [t.teamAbbrev, t]));

  const playerIds = new Set<number>();
  const baseRecords = new Map<
    number,
    {
      name: string;
      team: string;
      position: Position;
      isGoalie: boolean;
      seasons: SeasonHistory[];
    }
  >();

  for (const seasonId of BASE_SEASON_IDS) {
    const label = seasonIdToLabel(seasonId);
    const [skaters, realtime, faceoffs, goalies, puckPoss, penalties] =
      await Promise.all([
        fetchSkaterSummaries(seasonId),
        fetchSkaterRealtime(seasonId),
        fetchSkaterFaceoffs(seasonId),
        fetchGoalieSummaries(seasonId),
        fetchSkaterStatReport("puckPossessions", seasonId),
        fetchSkaterStatReport("penalties", seasonId),
      ]);

    const rtMap = new Map(realtime.map((r) => [r.playerId, r]));
    const foMap = new Map(faceoffs.map((f) => [f.playerId, f]));
    const ppMap = new Map(puckPoss.map((p) => [p.playerId, p]));
    const penMap = new Map(penalties.map((p) => [p.playerId, p]));

    for (const s of skaters) {
      const pos = mapNhlPosition(s.positionCode);
      if (pos === "G") continue;
      playerIds.add(s.playerId);
      const fo = foMap.get(s.playerId);
      const rt = rtMap.get(s.playerId);
      const pp = ppMap.get(s.playerId);
      const season: SeasonHistory = {
        season: label,
        seasonId,
        team: s.teamAbbrevs.split(",")[0],
        gamesPlayed: finite(s.gamesPlayed),
        isGoalie: false,
        stats: {
          goals: finite(s.goals),
          assists: finite(s.assists),
          points: finite(s.goals) + finite(s.assists),
          shots: finite(s.shots),
          ppPoints: finite(s.ppPoints),
          pim: finite(s.penaltyMinutes),
          plusMinus: finite((s as { plusMinus?: number }).plusMinus),
          evGoals: finite((s as { evGoals?: number }).evGoals),
          evPoints: finite((s as { evPoints?: number }).evPoints),
          shootingPct: finite((s as { shootingPct?: number }).shootingPct),
          toiPerGame: finite((s as { timeOnIcePerGame?: number }).timeOnIcePerGame),
        },
        advanced: {
          blocks: finite(rt?.blockedShots),
          hits: finite(rt?.hits),
          giveaways: finite((rt as { giveaways?: number })?.giveaways),
          takeaways: finite((rt as { takeaways?: number })?.takeaways),
          faceoffWins: computeFaceoffWins(
            fo?.totalFaceoffs ?? 0,
            fo?.faceoffWinPct ?? s.faceoffWinPct,
          ),
          satFor60: finite((pp as { individualSatForPer60?: number })?.individualSatForPer60),
          shotsFor60: finite((pp as { individualShotsForPer60?: number })?.individualShotsForPer60),
          oZoneStartPct: finite((pp as { offensiveZoneStartPct?: number })?.offensiveZoneStartPct),
          dZoneStartPct: finite((pp as { defensiveZoneStartPct?: number })?.defensiveZoneStartPct),
          penaltiesDrawn: finite((penMap.get(s.playerId) as { penaltiesDrawn?: number })?.penaltiesDrawn),
        },
      };

      const existing = baseRecords.get(s.playerId);
      if (existing) {
        upsertSeason(existing.seasons, season);
        existing.team = season.team;
        existing.name = s.skaterFullName;
      } else {
        baseRecords.set(s.playerId, {
          name: s.skaterFullName,
          team: season.team,
          position: pos,
          isGoalie: false,
          seasons: [season],
        });
      }
    }

    for (const g of goalies) {
      playerIds.add(g.playerId);
      const season: SeasonHistory = {
        season: label,
        seasonId,
        team: g.teamAbbrevs.split(",")[0],
        gamesPlayed: finite(g.gamesPlayed),
        isGoalie: true,
        stats: {
          wins: finite(g.wins),
          losses: finite((g as { losses?: number }).losses),
          shutouts: finite(g.shutouts),
          saves: finite(g.saves),
          savePct: finite(g.savePct),
          gaa: finite((g as { goalsAgainstAverage?: number }).goalsAgainstAverage),
          gamesStarted: finite((g as { gamesStarted?: number }).gamesStarted),
        },
        advanced: {},
      };
      const existing = baseRecords.get(g.playerId);
      if (existing) {
        upsertSeason(existing.seasons, season);
        existing.team = season.team;
        existing.name = g.goalieFullName;
      } else {
        baseRecords.set(g.playerId, {
          name: g.goalieFullName,
          team: season.team,
          position: "G",
          isGoalie: true,
          seasons: [season],
        });
      }
    }
  }

  for (const team of NHL_TEAMS) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      const roster = await fetchTeamRoster(team);
      for (const p of roster) {
        playerIds.add(p.id);
        if (!baseRecords.has(p.id)) {
          baseRecords.set(p.id, {
            name: rosterName(p),
            team,
            position: mapNhlPosition(p.positionCode),
            isGoalie: p.positionCode === "G",
            seasons: [],
          });
        }
      }
    } catch {
      /* roster optional */
    }
  }

  const ids = [...playerIds].slice(0, limit ?? undefined);

  const results = await mapWithConcurrency(ids, PROFILE_CONCURRENCY, async (id) => {
    const base = baseRecords.get(id);
    if (!base) return null;

    const landing = await fetchPlayerLanding(id);
    const teamCtx = teamMap.get(base.team) ?? standings[0];

    const birthDate =
      landing?.birthDate ?? "2000-01-01";
    const draft: DraftInfo | null = landing?.draftDetails
      ? {
          year: landing.draftDetails.year,
          round: landing.draftDetails.round,
          pickInRound: landing.draftDetails.pickInRound,
          overallPick: landing.draftDetails.overallPick,
          team: landing.draftDetails.teamAbbrev,
        }
      : null;

    const bio: PlayerBio = {
      age: ageFromBirthDate(birthDate),
      birthDate,
      birthCity: landing?.birthCity?.default ?? "",
      birthCountry: landing?.birthCountry ?? "",
      heightInches: finite(landing?.heightInInches, 72),
      weightPounds: finite(landing?.weightInPounds, 190),
      shootsCatches: (landing?.shootsCatches === "R" ? "R" : "L"),
      sweaterNumber: landing?.sweaterNumber ?? null,
    };

    const teamContext: TeamContext = {
      teamAbbrev: teamCtx.teamAbbrev,
      leagueRank: teamCtx.leagueRank,
      pointsPct: teamCtx.pointPctg,
      goalsForPerGame: teamCtx.goalsForPerGame,
      goalsAgainstPerGame: teamCtx.goalsAgainstPerGame,
      goalDifferential: teamCtx.goalDifferential,
      l10Wins: teamCtx.l10Wins,
      l10GoalsFor: teamCtx.l10GoalsFor,
      l10GoalsAgainst: teamCtx.l10GoalsAgainst,
      playoffClinch: teamCtx.clinchIndicator !== "",
    };

    const seasons = consolidateSeasonHistory(base.seasons);
    const injury = buildInjuryProfile(seasons, base.isGoalie);
    const contract = careerStage(bio.age, draft);

    const latestAdvanced =
      seasons.length > 0 ? seasons[seasons.length - 1].advanced : {};

    const partial = {
      id,
      name: landing
        ? `${landing.firstName.default} ${landing.lastName.default}`
        : base.name,
      team: landing?.currentTeamAbbrev ?? base.team,
      position: base.position,
      positions: [base.position],
      isGoalie: base.isGoalie,
      isActive: landing?.isActive ?? true,
      bio,
      draft,
      teamContext,
      teamHistory: seasons,
      injury,
      contract,
      careerTotals: (landing?.careerTotals?.regularSeason as Record<string, number>) ?? {},
      awards: (landing?.awards ?? []).map((a) => a.trophy?.default ?? "").filter(Boolean),
      last5Games: (landing?.last5Games ?? []) as Record<string, number>[],
      advancedSeasonLatest: latestAdvanced,
    };

    return {
      ...partial,
      contextNarrative: buildContextNarrative(partial),
      collectedAt: new Date().toISOString(),
    } satisfies PlayerProfile;
  });

  const profiles = results.filter((p): p is PlayerProfile => p !== null);
  onProgress?.(profiles.length, ids.length);
  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}
