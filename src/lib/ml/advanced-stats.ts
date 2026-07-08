import type { RawSkaterFaceoffs, RawSkaterRealtime, RawSkaterSummary } from "../nhl-api";
import type { PlayerSeasonRow } from "./types";

function finite(n: unknown, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function field(row: Record<string, unknown> | undefined, key: string): number {
  if (!row) return 0;
  return finite(row[key]);
}

export type AdvancedReportMaps = {
  puckPoss: Map<number, Record<string, unknown>>;
  penalties: Map<number, Record<string, unknown>>;
  timeonice: Map<number, Record<string, unknown>>;
  powerplay: Map<number, Record<string, unknown>>;
  penaltykill: Map<number, Record<string, unknown>>;
  percentages: Map<number, Record<string, unknown>>;
  goalsForAgainst: Map<number, Record<string, unknown>>;
  faceoffwins: Map<number, Record<string, unknown>>;
};

export function mapReportRows<T extends { playerId: number }>(
  rows: T[],
): Map<number, Record<string, unknown>> {
  return new Map(rows.map((r) => [r.playerId, r as unknown as Record<string, unknown>]));
}

/** Advanced stat fields shared by ML dataset collection and player profiles. */
export function buildSkaterAdvancedFields(
  s: RawSkaterSummary,
  rt: RawSkaterRealtime | undefined,
  fo: RawSkaterFaceoffs | undefined,
  maps: AdvancedReportMaps,
): Pick<
  PlayerSeasonRow,
  | "points"
  | "plusMinus"
  | "evGoals"
  | "evPoints"
  | "shootingPct"
  | "toiPerGame"
  | "giveaways"
  | "takeaways"
  | "satFor60"
  | "shotsFor60"
  | "oZoneStartPct"
  | "dZoneStartPct"
  | "penaltiesDrawn"
  | "penaltiesTaken"
  | "penaltiesTakenPer60"
  | "faceoffWinPct"
  | "evToiPerGame"
  | "ppToiPerGame"
  | "shToiPerGame"
  | "shiftsPerGame"
  | "satPct"
  | "usatPct"
  | "satRelative"
  | "usatRelative"
  | "onIceShootingPct"
  | "shootingPct5v5"
  | "neutralZoneStartPct"
  | "zoneStartPct5v5"
  | "ppGoals"
  | "ppToiPctPerGame"
  | "ppGoalsPer60"
  | "ppShotsPer60"
  | "ppPointsPer60"
  | "shGoalsPer60"
  | "hitsPer60"
  | "blockedShotsPer60"
  | "giveawaysPer60"
  | "takeawaysPer60"
  | "totalShotAttempts"
  | "missedShots"
  | "penaltiesDrawnPer60"
  | "totalFaceoffs"
  | "evenStrengthGoalDiff"
  | "ppGoalsFor"
> {
  const pp = maps.puckPoss.get(s.playerId);
  const pen = maps.penalties.get(s.playerId);
  const toi = maps.timeonice.get(s.playerId);
  const pwr = maps.powerplay.get(s.playerId);
  const pk = maps.penaltykill.get(s.playerId);
  const pct = maps.percentages.get(s.playerId);
  const gfa = maps.goalsForAgainst.get(s.playerId);
  const fow = maps.faceoffwins.get(s.playerId);
  const goals = finite(s.goals);
  const assists = finite(s.assists);

  return {
    points: goals + assists,
    plusMinus: finite(s.plusMinus),
    evGoals: finite(s.evGoals),
    evPoints: finite(s.evPoints),
    shootingPct: finite(s.shootingPct),
    toiPerGame: finite(s.timeOnIcePerGame),
    giveaways: finite(rt?.giveaways),
    takeaways: finite(rt?.takeaways),
    satFor60: field(pp, "individualSatForPer60"),
    shotsFor60: field(pp, "individualShotsForPer60"),
    oZoneStartPct: field(pp, "offensiveZoneStartPct"),
    dZoneStartPct: field(pp, "defensiveZoneStartPct"),
    penaltiesDrawn: field(pen, "penaltiesDrawn"),
    penaltiesTaken: field(pen, "penalties") || field(pen, "netPenalties"),
    penaltiesTakenPer60: field(pen, "penaltiesTakenPer60") || field(pen, "netPenaltiesPer60"),
    faceoffWinPct: finite(fo?.faceoffWinPct ?? s.faceoffWinPct),
    evToiPerGame: field(toi, "evTimeOnIcePerGame"),
    ppToiPerGame: field(toi, "ppTimeOnIcePerGame"),
    shToiPerGame: field(toi, "shTimeOnIcePerGame"),
    shiftsPerGame: field(toi, "shiftsPerGame"),
    satPct: field(pp, "satPct") || field(pct, "satPercentage"),
    usatPct: field(pp, "usatPct") || field(pct, "usatPercentage"),
    satRelative: field(pct, "satRelative"),
    usatRelative: field(pct, "usatRelative"),
    onIceShootingPct: field(pp, "onIceShootingPct"),
    shootingPct5v5: field(pct, "shootingPct5v5"),
    neutralZoneStartPct: field(pp, "neutralZoneStartPct"),
    zoneStartPct5v5: field(pct, "zoneStartPct5v5"),
    ppGoals: finite((s as { ppGoals?: number }).ppGoals),
    ppToiPctPerGame: field(pwr, "ppTimeOnIcePctPerGame"),
    ppGoalsPer60: field(pwr, "ppGoalsPer60"),
    ppShotsPer60: field(pwr, "ppShotsPer60"),
    ppPointsPer60: field(pwr, "ppPointsPer60"),
    shGoalsPer60: field(pk, "shGoalsPer60"),
    hitsPer60: field(rt as unknown as Record<string, unknown>, "hitsPer60"),
    blockedShotsPer60: field(rt as unknown as Record<string, unknown>, "blockedShotsPer60"),
    giveawaysPer60: field(rt as unknown as Record<string, unknown>, "giveawaysPer60"),
    takeawaysPer60: field(rt as unknown as Record<string, unknown>, "takeawaysPer60"),
    totalShotAttempts: field(rt as unknown as Record<string, unknown>, "totalShotAttempts"),
    missedShots: field(rt as unknown as Record<string, unknown>, "missedShots"),
    penaltiesDrawnPer60: field(pen, "penaltiesDrawnPer60"),
    totalFaceoffs: field(fow, "totalFaceoffs") || finite(fo?.totalFaceoffs),
    evenStrengthGoalDiff: field(gfa, "evenStrengthGoalDifference"),
    ppGoalsFor: field(gfa, "powerPlayGoalFor"),
  };
}

/** Flat map for player profile `advanced` records. */
export function advancedFieldsToProfileRecord(
  fields: ReturnType<typeof buildSkaterAdvancedFields>,
  rt: RawSkaterRealtime | undefined,
  faceoffWins: number,
): Record<string, number> {
  return {
    blocks: finite(rt?.blockedShots),
    hits: finite(rt?.hits),
    faceoffWins,
    ...fields,
  };
}

const MONEYPUCK_RATE_FIELDS = new Set([
  "xGoalsPer60",
  "onIceXGoalsPct",
  "offIceXGoalsPct",
  "onIceCorsiPct",
  "offIceCorsiPct",
  "onIceFenwickPct",
  "offIceFenwickPct",
  "gameScore",
]);

const MONEYPUCK_COUNT_FIELDS = new Set([
  "xGoals",
  "goalsAboveExpected",
  "flurryAdjustedxGoals",
  "highDangerGoals",
  "highDangerShots",
  "highDangerxGoals",
]);

const RATE_FIELDS = new Set([
  "shootingPct",
  "toiPerGame",
  "satFor60",
  "shotsFor60",
  "oZoneStartPct",
  "dZoneStartPct",
  "faceoffWinPct",
  "evToiPerGame",
  "ppToiPerGame",
  "shToiPerGame",
  "shiftsPerGame",
  "satPct",
  "usatPct",
  "satRelative",
  "usatRelative",
  "onIceShootingPct",
  "shootingPct5v5",
  "neutralZoneStartPct",
  "zoneStartPct5v5",
  "ppToiPctPerGame",
  "ppGoalsPer60",
  "ppShotsPer60",
  "ppPointsPer60",
  "shGoalsPer60",
  "hitsPer60",
  "blockedShotsPer60",
  "giveawaysPer60",
  "takeawaysPer60",
  "penaltiesDrawnPer60",
  "penaltiesTakenPer60",
]);

const COUNT_FIELDS = new Set([
  "giveaways",
  "takeaways",
  "penaltiesDrawn",
  "penaltiesTaken",
  "ppGoals",
  "totalShotAttempts",
  "missedShots",
  "totalFaceoffs",
  "evenStrengthGoalDiff",
  "ppGoalsFor",
  "plusMinus",
  "evGoals",
  "evPoints",
  "points",
]);

export function mergeAdvancedSkaterFields(
  existing: PlayerSeasonRow,
  incoming: PlayerSeasonRow,
  gpA: number,
  gpB: number,
): Partial<PlayerSeasonRow> {
  const wavg = (a: number, b: number) =>
    (a * gpA + b * gpB) / Math.max(1, gpA + gpB);
  const sum = (a: number, b: number) => a + b;
  const merged: Record<string, number> = {};

  for (const key of [
    ...RATE_FIELDS,
    ...COUNT_FIELDS,
    ...MONEYPUCK_RATE_FIELDS,
    ...MONEYPUCK_COUNT_FIELDS,
  ]) {
    const isRate =
      RATE_FIELDS.has(key) || MONEYPUCK_RATE_FIELDS.has(key);
    const a = finite(existing[key as keyof PlayerSeasonRow]);
    const b = finite(incoming[key as keyof PlayerSeasonRow]);
    merged[key] = isRate ? wavg(a, b) : sum(a, b);
  }

  return merged as Partial<PlayerSeasonRow>;
}
