/** Facts for the Fantrax daily briefing. Dates remain attached to each source:
 * a live roster read never refreshes injuries, claims, caps or projections. */
import type { FantraxLeagueConfig } from "./config";
import type { DailyPlan } from "./daily-plan";
import type { LeagueSnapshotBundle } from "./league-client";
import type { LiveOverlay } from "./live";
import type { LeagueTab } from "../leagues/registry";

export type SourceStatus = "fresh" | "stale" | "unknown";
export type SourceId = "rosters" | "injuries" | "waivers" | "caps" | "projections" | "schedule";
export interface BriefSource {
  id: SourceId;
  status: SourceStatus;
  at: string | null;
  ageMs: number | null;
  maxAgeMs: number;
  live: boolean;
  available: boolean;
  availability: "available" | "unavailable" | "not-published";
}

const HOUR = 3_600_000;
/** Operational refresh limits, not probabilities of accuracy. */
export const BRIEF_REFRESH_MS = {
  rosters: HOUR / 4,
  injuries: 24 * HOUR,
  waivers: 24 * HOUR,
  caps: 24 * HOUR,
  projections: 14 * 24 * HOUR,
  schedule: 48 * HOUR,
} as const;

export function briefSource(
  id: SourceId,
  at: string | null | undefined,
  nowMs: number | null,
  available = true,
  live = false,
  published = true,
): BriefSource {
  const then = at ? Date.parse(at) : NaN;
  const dated = Number.isFinite(then);
  const clockKnown = nowMs !== null && Number.isFinite(nowMs);
  const ageMs = dated && clockKnown ? nowMs - then : null;
  const valid = available && dated && ageMs !== null && ageMs >= 0;
  return {
    id,
    at: dated ? at! : null,
    ageMs: ageMs !== null && ageMs >= 0 ? ageMs : null,
    maxAgeMs: BRIEF_REFRESH_MS[id],
    status: valid ? (ageMs! > BRIEF_REFRESH_MS[id] ? "stale" : "fresh") : "unknown",
    live: valid && live,
    available,
    availability: !published ? "not-published" : available ? "available" : "unavailable",
  };
}

export interface BriefAction {
  id: "data" | "roster" | "lineup" | "salary" | "cap-fit" | "games-cap" | "waiver" | "goalies";
  tone: "rose" | "amber" | "cyan";
  title: string;
  detail: string;
  tab?: LeagueTab;
  hash?: string;
}

export interface DecisionBriefModel {
  sources: BriefSource[];
  coverage: { projected: number; prior: number; unknown: number; total: number };
  targetCurrent: boolean;
  nextLock: string | null;
  lineupPoints: number | null;
  moves: number | null;
  occupied: number;
  playing: number;
  seats: number;
  actions: BriefAction[];
  stale: number;
  unknown: number;
}

export function decisionBrief({
  plan,
  config,
  bundle,
  live,
  nowMs,
}: {
  plan: DailyPlan;
  config: FantraxLeagueConfig;
  bundle: LeagueSnapshotBundle | null;
  live: LiveOverlay | null;
  nowMs: number | null;
}): DecisionBriefModel {
  const snapshotAt = bundle?.state.fetchedAt ?? plan.dataAsOf;
  const liveApplies = !!live && live.rosterPeriod === (plan.target?.rosterPeriod ?? bundle?.state.rosterPeriod) && !!live.rosters[plan.teamId];
  const detailsAvailable = config.features.fxpa && (bundle?.state.fxpaOk ?? plan.fxpaOk);
  const sources: BriefSource[] = [
    briefSource("rosters", liveApplies ? live.fetchedAt : snapshotAt, nowMs, true, liveApplies),
    briefSource("injuries", snapshotAt, nowMs, detailsAvailable, false, config.features.fxpa),
    briefSource("waivers", snapshotAt, nowMs, detailsAvailable, false, config.features.fxpa),
    ...(config.features.gamesCaps ? [briefSource("caps", snapshotAt, nowMs, detailsAvailable && !!plan.cap?.known)] : []),
    briefSource("projections", bundle?.values.projectionsAt, nowMs, !!bundle),
    briefSource("schedule", bundle?.schedule.updatedAt ?? bundle?.schedule.fetchedAt, nowMs, !!bundle),
  ];
  const roster = liveApplies ? live.rosters[plan.teamId] : bundle?.state.rosters[plan.teamId];
  // The plan contains waiver targets as well as this team's players; never
  // count every plan player as roster coverage.
  const ids = new Set(roster ? roster.map((r) => r.id) : Object.entries(plan.players).filter(([, p]) => ["ACTIVE", "RESERVE", "MINORS", "INJURED_RESERVE"].includes(p.st)).map(([id]) => id));
  const coverage = { projected: 0, prior: 0, unknown: 0, total: ids.size };
  for (const id of ids) {
    const src = bundle?.values.players[id]?.src ?? plan.players[id]?.src;
    if (src === "proj") coverage.projected++;
    else if (src === "prior") coverage.prior++;
    else coverage.unknown++;
  }
  const clockKnown = nowMs !== null && Number.isFinite(nowMs);
  const targetStart = plan.target ? Date.parse(plan.target.start) : NaN;
  const targetEnd = plan.target ? Date.parse(plan.target.end) : NaN;
  // A period-lock lineup stops being actionable at its FIRST game, even if
  // the lineup period ends tomorrow. A per-game lineup remains actionable
  // only until its LAST player lock, including between that night's games.
  const perGame = config.cadence.lock?.kind === "game";
  const lastLock = perGame && plan.locks?.last ? Date.parse(plan.locks.last) : targetStart;
  const targetCurrent = clockKnown && Number.isFinite(targetStart) && Number.isFinite(targetEnd) && targetEnd > targetStart && targetEnd > nowMs && lastLock > nowMs;
  const candidateLock = perGame ? plan.locks?.next : plan.target?.start;
  const candidateMs = candidateLock ? Date.parse(candidateLock) : NaN;
  const nextLock = targetCurrent && candidateLock && candidateMs > nowMs! && candidateMs <= targetEnd ? candidateLock : null;
  const lineup = targetCurrent ? plan.lineup : null;
  const actions: BriefAction[] = [];
  const stale = sources.filter((s) => s.status === "stale").length;
  const unknown = sources.filter((s) => s.status === "unknown").length;
  const source = (id: SourceId) => sources.find((s) => s.id === id);
  if (stale || unknown || !targetCurrent) {
    actions.push({ id: "data", tone: "amber", title: "Vérifier les données avant d’agir", detail: "Les effectifs en direct ne mettent pas à jour les blessures, les réclamations ou les plafonds. Vérifiez les sources ci-dessous et confirmez la situation dans Fantrax.", hash: "fiabilite" });
  }
  const errors = plan.alerts.filter((a) => a.level === "error");
  if (errors.length) actions.push({ id: "roster", tone: "rose", title: "Examiner la légalité de l’effectif", detail: `${errors.length} signalement${errors.length > 1 ? "s" : ""} bloquant${errors.length > 1 ? "s" : ""} dans le plan. Vérifiez les limites et les statuts avant le verrouillage.`, hash: "alertes" });
  if (lineup?.moves.length) actions.push({ id: "lineup", tone: "cyan", title: "Préparer les mouvements d’alignement", detail: `${lineup.moves.length} changement${lineup.moves.length > 1 ? "s" : ""} de poste ou de statut proposé${lineup.moves.length > 1 ? "s" : ""}. Confirmez les joueurs disponibles et les verrous dans Fantrax.`, hash: "alignement" });
  if (plan.salary?.over) actions.push({ id: "salary", tone: "rose", title: "Réduire la masse salariale", detail: "La masse calculée dépasse le plafond. Les salaires inconnus et les contrats projetés doivent aussi être vérifiés.", tab: "plafond" });
  else if (plan.capFit?.moves.length) actions.push({ id: "cap-fit", tone: "cyan", title: "Examiner la répartition actifs / mineures", detail: `${plan.capFit.moves.length} mouvement${plan.capFit.moves.length > 1 ? "s" : ""} proposé${plan.capFit.moves.length > 1 ? "s" : ""} pour le plafond ou les places disponibles. Consultez les conséquences avant de modifier l’effectif.`, tab: "mon-equipe", hash: "masse-salariale" });
  if (plan.cap && (plan.cap.gpBinds || plan.cap.gsBinds)) actions.push({ id: "games-cap", tone: "amber", title: "Réserver les matchs aux meilleurs départs", detail: source("caps")?.status === "fresh" ? "Un plafond de matchs peut limiter la période. Consultez les joueurs à laisser sur le banc et les compteurs." : "Un plafond apparaît contraignant dans le scénario; les compteurs doivent être confirmés dans Fantrax.", hash: "plafonds" });
  const target = targetCurrent && config.features.fxpa ? plan.waivers.targets[0] : null;
  if (target && Number.isFinite(target.delta) && target.delta > 0 && plan.waivers.claimsLeft !== 0) {
    const name = plan.players[target.id]?.n ?? "La meilleure cible";
    const cost = target.drop ? target.drop.action === "minors" ? "Un joueur doit passer aux mineures." : "Un joueur doit être libéré : vérifiez sa valeur dynastie avant de le perdre." : "Aucun joueur à libérer dans le scénario.";
    actions.push({ id: "waiver", tone: "cyan", title: `Étudier ${name}`, detail: `${signed(target.delta)} points projetés sur le reste de la période${target.rental ? "; gain temporaire, coût projeté ensuite" : ""}. ${cost}${plan.waivers.claimsLeft === null ? " Réclamations restantes inconnues." : ""}${source("waivers")?.status !== "fresh" ? " Disponibilité à confirmer." : ""}`, tab: "ballottage" });
  }
  if (targetCurrent && plan.goalies.some((g) => !!g.game)) actions.push({ id: "goalies", tone: "amber", title: "Confirmer les gardiens partants", detail: "Les probabilités de départ viennent du modèle de tandem. Elles ne remplacent pas l’annonce d’un partant.", hash: "gardiens" });
  return {
    sources,
    coverage,
    targetCurrent,
    nextLock,
    lineupPoints: lineup && Number.isFinite(lineup.total) ? lineup.total : null,
    moves: lineup ? lineup.moves.length : null,
    occupied: lineup?.slots.filter((s) => !!s.id).length ?? 0,
    playing: lineup?.slots.filter((s) => !!s.id && !!s.game).length ?? 0,
    seats: lineup?.slots.length ?? Object.values(config.slots.counts).reduce((n, v) => n + (v ?? 0), 0),
    actions,
    stale,
    unknown,
  };
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1).replace(".", ",")}`;
}
