import { Shield } from "lucide-react";
import type { DailyPlan } from "@/lib/fantrax/daily-plan";
import { fmtCalendarDay, fmtNum, fmtPct, gameLabel } from "@/lib/fantrax/league-copy";
import { SnakeLeagueNote } from "@/components/snake/SnakeLeague";
import { LeagueCard, PlayerName, Tag, type PlayerLookup } from "./LeagueCard";

interface GoalieStartsProps {
  plan: DailyPlan;
  player: PlayerLookup;
}

/** Each playable goalie's start odds × points per start for the next lineup. */
export function GoalieStarts({ plan, player }: GoalieStartsProps) {
  const goalies = [...plan.goalies].sort((a, b) => b.value - a.value);
  return (
    <LeagueCard
      id="gardiens"
      icon={<Shield className="h-5 w-5" />}
      title="Gardiens"
      accentClass="text-violet-300"
      description={plan.target ? `Départs probables · ${fmtCalendarDay(plan.target.date)}` : undefined}
    >
      {goalies.length === 0 ? (
        <p className="text-sm text-amber-100">{"Aucun gardien jouable dans l'effectif."}</p>
      ) : (
        <ul className="space-y-3">
          {goalies.map((g) => (
            <li key={g.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <PlayerName id={g.id} player={player} className="mr-auto" />
                {g.b2b ? <Tag tone="amber">2e soir de suite</Tag> : null}
              </div>
              <SnakeLeagueNote id={g.id} name={player(g.id)?.n} className="mt-1" />
              <p className="mt-1 text-xs text-slate-400">{gameLabel(g.game)}</p>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-white/5 px-2 py-1.5">
                  <dt className="text-[0.7rem] uppercase tracking-wider text-slate-400">Départ</dt>
                  <dd className="font-semibold tabular-nums text-white">{fmtPct(g.pStart)}</dd>
                </div>
                <div className="rounded-lg bg-white/5 px-2 py-1.5">
                  <dt className="text-[0.7rem] uppercase tracking-wider text-slate-400">Pts/départ</dt>
                  <dd className="font-semibold tabular-nums text-white">{fmtNum(g.perStart)}</dd>
                </div>
                <div className="rounded-lg bg-white/5 px-2 py-1.5">
                  <dt className="text-[0.7rem] uppercase tracking-wider text-slate-400">Prévus</dt>
                  <dd className="font-semibold tabular-nums text-violet-200">{fmtNum(g.value)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500">
        {
          "Probabilité de départ : part projetée des départs de son équipe (gardiens blessés exclus), réduite le 2e soir de deux matchs consécutifs. Aucune confirmation officielle : vérifiez les gardiens annoncés avant le verrouillage."
        }
      </p>
    </LeagueCard>
  );
}
