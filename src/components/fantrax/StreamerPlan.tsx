"use client";

import { CalendarClock } from "lucide-react";
import { useMemo } from "react";
import { fmtCalendarDay, fmtNum, fmtSigned, plural } from "@/lib/fantrax/league-copy";
import { streamerWeek } from "@/lib/fantrax/streamer-week";
import { useFantraxLeague } from "./fantrax-league-context";
import { LeagueCard, PlayerName, Tag, type PlayerLookup } from "./LeagueCard";

const isGoalie = (player: PlayerLookup, id: string) => (player(id)?.e ?? "").split(",").includes("G");

/**
 * The week's streaming plan: who to pick up, from which day to which, and who
 * goes (`streamers.ts`). Solved here, in the browser, from the league's plan and
 * snapshot; the Ballottage tab loads this module on demand.
 */
export function StreamerPlan() {
  const { plan, bundle, state, teamId, config, nowMs, player } = useFantraxLeague();
  const s = useMemo(
    () => (plan?.streamInputs && bundle && state && nowMs !== null ? streamerWeek({ ...bundle, state, teamId, nowMs, config }, plan) : undefined),
    [plan, bundle, state, teamId, config, nowMs],
  );
  // Not ready yet, or a plan baked before the streaming plan existed.
  if (s === undefined) return null;
  const last = s?.days[s.days.length - 1];
  const claims =
    s === null || s.claimsAvailable === null
      ? "Aucune limite de réclamations dans cette ligue."
      : `${s.claimsAvailable} ${plural(s.claimsAvailable, "réclamation utilisable", "réclamations utilisables")} sur ces jours (celles qui restent cette semaine, plus celles de la semaine suivante dès lundi).`;
  return (
    <LeagueCard
      id="streamers"
      icon={<CalendarClock className="h-5 w-5" />}
      title="Plan de streamers de la semaine"
      accentClass="text-emerald-300"
      description={claims}
    >
      {s === null || s.steps.length === 0 ? (
        <p className="text-sm text-slate-400">
          {`Aucune réclamation ne rapporte assez d’ici ${last ? fmtCalendarDay(last) : "la fin de la semaine"} pour justifier une place d’alignement et une réclamation.`}
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-300">
            <span className="text-base font-semibold tabular-nums text-emerald-300">{fmtSigned(s.gain, 1)} pts</span>{" "}
            d’ici {fmtCalendarDay(s.days[s.days.length - 1]!)} avec {s.steps.length} {plural(s.steps.length, "réclamation", "réclamations")}
            {s.capLimited ? (
              <span className="text-slate-400">{` (${fmtSigned(s.gainUncapped, 1)} pts sans la limite de matchs, qui plafonne le gain)`}</span>
            ) : null}
            .
          </p>
          <ol className="grid gap-3 md:grid-cols-2">
            {s.steps.map((x, i) => {
              const prev = i > 0 ? s.steps[i - 1]! : null;
              const goalie = isGoalie(player, x.id);
              const range = x.to > x.from ? `${fmtCalendarDay(s.days[x.from]!)} → ${fmtCalendarDay(s.days[x.to]!)}` : fmtCalendarDay(s.days[x.from]!);
              return (
                <li key={x.id} className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    {i + 1}. {range}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <PlayerName id={x.id} player={player} className="mr-auto" />
                    {x.status === "FA" ? <Tag tone="emerald">Joueur autonome</Tag> : <Tag tone="amber">Au ballottage</Tag>}
                  </div>
                  <p className="text-sm text-slate-300">
                    <span className="text-base font-semibold tabular-nums text-emerald-300">{fmtSigned(x.gain, 1)} pts</span>{" "}
                    sur {fmtNum(x.games, 1)} {goalie ? plural(Math.round(x.games), "départ attendu", "départs attendus") : plural(Math.round(x.games), "match attendu", "matchs attendus")}
                  </p>
                  <p className="text-xs text-slate-400">
                    {prev
                      ? `Remplace ${player(prev.id)?.n ?? "le streamer précédent"} : libérez-le après son dernier match de la période.`
                      : x.drop
                        ? x.drop.action === "minors"
                          ? `Envoyer ${player(x.drop.id)?.n ?? "un joueur"} aux mineures pour faire de la place.`
                          : `Libérer ${player(x.drop.id)?.n ?? "un joueur"} pour faire de la place.`
                        : "Aucun joueur à libérer : il reste de la place."}
                  </p>
                </li>
              );
            })}
          </ol>
        </>
      )}
      <p className="mt-3 text-xs text-slate-400">
        Chaque réclamation occupe une seule place de la formation : le joueur retiré, ou une place libre. Le plan choisit, jour par jour sur les 7 prochains jours,
        la suite de joueurs qui fait marquer le plus à votre alignement optimal (seuls comptent les soirs où le streamer joue dans l’alignement, et le coût du
        joueur retiré les soirs où il aurait joué), sans jamais reprendre un joueur déjà libéré, sous les réclamations restantes, le délai du ballottage (une
        réclamation ne joue qu’à partir du lendemain) et les limites de matchs de chaque période de pointage. Une réclamation de plus n’est gardée que si elle
        rapporte au moins le seuil de la ligue en plus du plan plus court. Un gardien compte ses départs attendus.
        Liste à jour à la dernière synchronisation.
      </p>
    </LeagueCard>
  );
}
