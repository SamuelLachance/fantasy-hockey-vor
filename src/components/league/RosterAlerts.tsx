import { ArrowRight, CircleCheck, Info, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import type { DailyPlan, PlanAlert } from "@/lib/fantrax/daily-plan";
import {
  alertText,
  deadReasonLabel,
  fmtNum,
  legalitySummary,
  plural,
  statusLabel,
} from "@/lib/fantrax/league-copy";
import { deadReason } from "@/lib/fantrax/roster-rules";
import { LeagueCard, PlayerName, Tag, type PlayerLookup } from "./LeagueCard";

interface RosterAlertsProps {
  plan: DailyPlan;
  player: PlayerLookup;
}

/**
 * Legality first: an illegal roster scores nothing for the lineup period.
 * Then the moves that reach the minimum (playable Minors / healthy IR
 * players, then Reserve bodies who count without scoring), then every
 * other alert. The dead-player advice in the alerts comes from the same
 * after-moves count, so following all of it leaves a legal roster.
 */
export function RosterAlerts({ plan, player }: RosterAlertsProps) {
  const L = plan.legality;
  const name = (id: string | null | undefined) => (id ? (player(id)?.n ?? "Nouveau joueur") : "—");
  const others = L.movableFromMinors.filter((id) => !L.fixes.includes(id) && !L.reserveFills.includes(id));
  // A player picked since the sync has no team in the snapshot, which the
  // rules read as "no NHL team"; say what it really is.
  const alerts = plan.alerts
    .filter((a) => a.code !== "illegal-roster")
    .map((a): PlanAlert & { text: string } => {
      const unknown = a.code === "dead-active" && a.detail === "no-team" && !player(a.ids?.[0]);
      return unknown
        ? {
            ...a,
            level: "info",
            text: `Un joueur ajouté depuis la dernière synchronisation occupe un poste ${a.slot ?? ""} : ses données arriveront à la prochaine synchro.`,
          }
        : { ...a, text: alertText(a, name) ?? "" };
    })
    .filter((a) => a.text);
  const clean = !L.illegal && alerts.length === 0;

  return (
    <LeagueCard
      id="alertes"
      icon={L.illegal ? <ShieldAlert className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
      title="Légalité de l'alignement"
      accentClass={L.illegal ? "text-rose-400" : "text-emerald-400"}
    >
      <p
        className={`rounded-xl px-4 py-3 text-sm ${
          L.illegal
            ? "border border-rose-500/40 bg-rose-500/10 font-medium text-rose-100"
            : "border border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
        }`}
      >
        {legalitySummary(L)}
      </p>

      {L.fixes.length + L.reserveFills.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-white">À faire maintenant pour atteindre le minimum</h3>
          <p className="mt-1 text-xs text-slate-400">
            Sortir un joueur des mineures est toujours permis : aucun choix au repêchage ni
            aucune réclamation requis. Un joueur en réserve compte pour le minimum même
            s&apos;il ne joue pas.
          </p>
          <ul className="mt-2 divide-y divide-white/5 rounded-xl border border-white/10">
            {L.fixes.map((id) => {
              const to = L.fixTo[id] ?? "ACTIVE";
              return (
                <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <PlayerName id={id} player={player} className="mr-auto" />
                  <span className="inline-flex items-center gap-1 text-xs text-slate-300">
                    <Tag>{statusLabel(player(id)?.st ?? "MINORS")}</Tag>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                    <span className="sr-only">vers</span>
                    <Tag tone={to === "ACTIVE" ? "emerald" : "slate"}>{statusLabel(to)}</Tag>
                  </span>
                  <span className="whitespace-nowrap text-right tabular-nums text-slate-300">
                    {fmtNum(player(id)?.fpg ?? 0)} pts/match
                  </span>
                </li>
              );
            })}
            {L.reserveFills.map((id) => {
              const p = player(id);
              const why = p ? deadReason({ icons: p.icons, team: p.t }) : null;
              return (
                <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <PlayerName id={id} player={player} className="mr-auto" />
                  <span className="inline-flex items-center gap-1 text-xs text-slate-300">
                    <Tag>{statusLabel(p?.st ?? "MINORS")}</Tag>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                    <span className="sr-only">vers</span>
                    <Tag>{statusLabel("RESERVE")}</Tag>
                  </span>
                  <span className="text-right text-xs text-slate-400">
                    compte pour le minimum{why ? ` · ne marquera pas (${deadReasonLabel(why)})` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {L.shortBy > 0 ? (
        <p className="mt-3 text-sm text-rose-200">
          Il en manquera encore {L.shortBy} après ces mouvements : réclamez ou repêchez{" "}
          {plural(L.shortBy, "un joueur", "des joueurs")}.
        </p>
      ) : null}

      {others.length > 0 ? (
        <p className="mt-3 text-sm text-slate-400">
          Autres joueurs des mineures qui peuvent jouer :{" "}
          {others.map((id, i) => (
            <span key={id}>
              {i > 0 ? ", " : ""}
              <span className="text-slate-200">{name(id)}</span>{" "}
              <span className="tabular-nums">({fmtNum(player(id)?.fpg ?? 0)})</span>
            </span>
          ))}
          .
        </p>
      ) : null}

      {alerts.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {alerts.map((a, i) => (
            <li
              key={`${a.code}-${a.slot ?? ""}-${a.ids?.join(",") ?? ""}-${i}`}
              className={`flex gap-2 rounded-lg px-3 py-2 text-sm ${
                a.level === "error"
                  ? "bg-rose-500/10 text-rose-100"
                  : a.level === "warn"
                    ? "bg-amber-500/10 text-amber-100"
                    : "bg-white/5 text-slate-300"
              }`}
            >
              {a.level === "info" ? (
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              ) : (
                <TriangleAlert
                  className={`mt-0.5 h-4 w-4 shrink-0 ${a.level === "error" ? "text-rose-400" : "text-amber-400"}`}
                  aria-hidden="true"
                />
              )}
              <span>
                <span className="sr-only">
                  {a.level === "error" ? "Erreur : " : a.level === "warn" ? "Attention : " : "Note : "}
                </span>
                {a.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {clean ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-emerald-200">
          <CircleCheck className="h-4 w-4" aria-hidden="true" />
          Aucune alerte : aucun poste vide ni joueur inactif dans l&apos;alignement.
        </p>
      ) : null}
    </LeagueCard>
  );
}
