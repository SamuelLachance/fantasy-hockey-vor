import { UserPlus } from "lucide-react";
import type { DailyPlan } from "@/lib/fantrax/daily-plan";
import { claimsText, fmtNum, fmtSigned, plural } from "@/lib/fantrax/league-copy";
import { SnakeLeagueNote } from "@/components/snake/SnakeVerdicts";
import { LeagueCard, PlayerName, Tag, type PlayerLookup } from "./LeagueCard";

interface WaiverTargetsProps {
  plan: DailyPlan;
  player: PlayerLookup;
}

/** Free agents / waiver players ranked by points added over the rest of the season. */
export function WaiverTargets({ plan, player }: WaiverTargetsProps) {
  const w = plan.waivers;
  // An older baked plan has no league threshold: Captains' 3 points.
  const minDelta = fmtNum(w.minDelta ?? 3, w.minDelta !== undefined && w.minDelta < 3 ? 1 : 0);
  return (
    <LeagueCard
      id="ballottage"
      icon={<UserPlus className="h-5 w-5" />}
      title="Ajouts recommandés d’ici la fin de la période"
      accentClass="text-emerald-300"
      description={claimsText(w.claimsUsed, w.claimsLeft)}
    >
      {w.targets.length === 0 ? (
        <p className="text-sm text-slate-400">
          {`Aucun ajout ne rapporte ${minDelta} pt${(w.minDelta ?? 3) >= 2 ? "s" : ""} ou plus d’ici la fin de la période sans en coûter sur le reste de la saison.`}
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {w.targets.map((t) => (
            <li key={t.id} className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <PlayerName id={t.id} player={player} className="mr-auto" />
                {t.status === "FA" ? (
                  <Tag tone="emerald">Joueur autonome</Tag>
                ) : (
                  <Tag tone="amber">Au ballottage</Tag>
                )}
              </div>
              <SnakeLeagueNote id={t.id} name={player(t.id)?.n} line />
              <p className="text-sm text-slate-300">
                <span className="text-base font-semibold tabular-nums text-emerald-300">
                  {fmtSigned(t.delta, 1)} pts
                </span>{" "}
                sur {t.days} {plural(t.days, "match", "matchs")}{" "}
                <span className="tabular-nums text-slate-400">({fmtNum(t.fpg)} pts/match)</span>
              </p>
              <p className="text-xs text-slate-400">
                {t.rental ? (
                  <Tag tone="amber">Location courte</Tag>
                ) : null}{" "}
                Reste de la saison après la période{" "}:{" "}
                <span className={`tabular-nums ${t.ros < 0 ? "text-amber-300" : "text-slate-300"}`}>{fmtSigned(t.ros, 1)} pts</span>
                {t.rental ? " : il vous en coûte après cette période." : null}
              </p>
              <p className="text-xs text-slate-400">
                {t.drop
                  ? t.drop.action === "minors"
                    ? `Envoyer ${player(t.drop.id)?.n ?? "un joueur"} aux mineures pour faire de la place.`
                    : `Libérer ${player(t.drop.id)?.n ?? "un joueur"} pour faire de la place.`
                  : "Aucun joueur à libérer : il reste de la place."}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-400">
        {
          `Gain = points ajoutés à votre alignement optimal, jour par jour, d’ici la fin de la période de pointage (${minDelta} pt${(w.minDelta ?? 3) >= 2 ? "s" : ""} ou plus; les 3 meilleurs par position). Reste de la saison = la même chose pour les jours suivants, jusqu’à la fin de la saison régulière de la ligue (sur un échantillon de journées); la liste est classée sur le total des deux, et un ajout qui fait perdre des points sur l’ensemble de la saison n’y figure pas. Un joueur au ballottage ne joue qu’à partir du lendemain.${w.capLimited ? " Votre limite de matchs de la période sera atteinte : les gains ne comptent que jusqu’à ce qu’elle le soit." : ""} Liste à jour à la dernière synchronisation.`
        }
      </p>
    </LeagueCard>
  );
}
