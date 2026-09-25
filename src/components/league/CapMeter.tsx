import { CircleCheck, Gauge, TriangleAlert } from "lucide-react";
import type { DailyPlan } from "@/lib/fantrax/daily-plan";
import { fmtNum, fmtPct, fmtShortCalendarDate, plural } from "@/lib/fantrax/league-copy";
import { LeagueCard } from "./LeagueCard";

interface MeterProps {
  label: string;
  used: number;
  max: number | null;
  projected: number;
  /** Reached at the start of a remaining day (crossing it on the last day is free). */
  binds: boolean;
}

/**
 * One cap as a meter: solid fill = used so far, lighter fill = projected by
 * period end (same ramp), turning amber when the projection reaches the cap
 * before the period's last day. The numbers are always printed; the bar
 * only repeats them.
 */
function Meter({ label, used, max, projected, binds }: MeterProps) {
  const pct = (x: number) => (max && max > 0 ? Math.min(100, (x / max) * 100) : 0);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="font-semibold tabular-nums text-white">
          {used} / {max ?? "?"}
        </span>
      </div>
      <div className="relative mt-1.5 h-2.5 overflow-hidden rounded-full bg-cyan-950/70" aria-hidden="true">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${binds ? "bg-amber-400/45" : "bg-cyan-400/35"}`}
          style={{ width: `${pct(projected)}%` }}
        />
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${binds ? "bg-amber-400" : "bg-cyan-400"}`}
          style={{ width: `${pct(used)}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Projection fin de période :{" "}
        <span className={`tabular-nums ${binds ? "text-amber-200" : "text-slate-200"}`}>
          {fmtNum(projected, 1)}
        </span>
        {max ? <span className="tabular-nums"> ({fmtPct(projected / max)})</span> : null}
      </p>
    </div>
  );
}

/**
 * Games-cap monitor for the current scoring period. Monitor only: the
 * day-by-day cap planner lands later (in period 1 the caps cannot bind
 * without streaming).
 */
export function CapMeter({ plan }: { plan: DailyPlan }) {
  const sp = plan.scoringPeriod;
  const cap = plan.cap;
  return (
    <LeagueCard
      id="plafonds"
      icon={<Gauge className="h-5 w-5" />}
      title="Plafonds de matchs"
      description={
        sp
          ? `Période de pointage ${sp.number} : ${fmtShortCalendarDate(sp.firstDay)} → ${fmtShortCalendarDate(sp.lastDay)} · ${sp.daysLeft} ${plural(sp.daysLeft, "jour", "jours")} d'alignement ${plural(sp.daysLeft, "restant", "restants")}`
          : undefined
      }
    >
      {cap ? (
        <div className="space-y-4">
          <Meter
            label="Patineurs (PJ)"
            used={cap.gp}
            max={cap.gpMax}
            projected={cap.projectedGp}
            binds={cap.gpBinds}
          />
          <Meter
            label="Gardiens (départs)"
            used={cap.gs}
            max={cap.gsMax}
            projected={cap.projectedGs}
            binds={cap.gsBinds}
          />
          {cap.gpBinds || cap.gsBinds ? (
            <p className="flex gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
              <span>
                {
                  "Un plafond sera atteint avant le dernier jour à ce rythme. Dès qu'il l'est au début d'une journée, toute l'équipe cesse de marquer jusqu'à la fin de la période : gardez des joueurs sur le banc les derniers jours."
                }
              </span>
            </p>
          ) : (
            <p className="flex gap-2 text-sm text-emerald-200">
              <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {(cap.gpMax !== null && cap.projectedGp >= cap.gpMax) ||
                (cap.gsMax !== null && cap.projectedGs >= cap.gsMax)
                  ? "Un plafond ne serait franchi que le dernier jour : sans conséquence, cette journée compte au complet."
                  : "Les plafonds ne seront pas atteints à ce rythme."}
              </span>
            </p>
          )}
          {!cap.known ? (
            <p className="text-xs text-amber-200/80">
              Utilisation actuelle inconnue (données fxpa indisponibles) : la projection part de zéro.
            </p>
          ) : null}
          <p className="text-xs text-slate-500">
            {
              "Si un plafond est atteint au début d'une journée, toute l'équipe cesse de marquer pour le reste de la période; la journée où on le franchit compte au complet."
            }
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-400">Aucune période de pointage à venir.</p>
      )}
    </LeagueCard>
  );
}
