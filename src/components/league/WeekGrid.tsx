import { CalendarDays } from "lucide-react";
import type { DailyPlan } from "@/lib/fantrax/daily-plan";
import { fmtCalendarDay, gridDay, statusLabel } from "@/lib/fantrax/league-copy";
import { SnakeLeagueMini } from "@/components/snake/SnakeLeague";
import { LeagueCard, Tag, type PlayerLookup } from "./LeagueCard";

interface WeekGridProps {
  plan: DailyPlan;
  player: PlayerLookup;
}

/**
 * Games left this scoring period, one row per player who can dress (counted
 * players plus playable Minors / healthy IR). The table scrolls inside its
 * card on phones; the page itself never scrolls sideways — the scroller is
 * `relative` so the absolutely positioned `sr-only` cell labels are clipped
 * by it instead of widening the document.
 */
export function WeekGrid({ plan, player }: WeekGridProps) {
  const week = plan.week;
  const dead = new Set(plan.legality.dead.map((d) => d.id));
  // Plain code-unit order for ties: localeCompare can differ between the
  // build (Node ICU) and the browser, which would break hydration.
  const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const rows = week
    ? [...week.rows].sort(
        (a, b) => b.total - a.total || byName(player(a.id)?.n ?? "", player(b.id)?.n ?? ""),
      )
    : [];
  // Players who can't score (dead in an active slot) don't make a day busy.
  const scorers = rows.filter((r) => !dead.has(r.id));
  const perDay = week ? week.days.map((_, i) => scorers.reduce((s, r) => s + (r.games[i] ?? 0), 0)) : [];

  return (
    <LeagueCard
      id="calendrier"
      icon={<CalendarDays className="h-5 w-5" />}
      title="Matchs restants"
      description={
        plan.scoringPeriod
          ? `Période de pointage ${plan.scoringPeriod.number}, d'aujourd'hui au dernier jour d'alignement. Les jours creux sont les meilleurs pour ajouter un joueur.`
          : undefined
      }
    >
      {week && rows.length > 0 ? (
        <div className="relative -mx-4 overflow-x-auto sm:mx-0 sm:rounded-xl sm:border sm:border-white/10">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <caption className="sr-only">Matchs restants par joueur et par jour</caption>
            <thead className="text-xs text-slate-400">
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 bg-slate-950 px-3 py-2 text-left font-medium uppercase tracking-wider"
                >
                  Joueur
                </th>
                {week.days.map((d) => {
                  const g = gridDay(d);
                  return (
                    <th key={d} scope="col" className="px-1 py-2 text-center font-medium" title={fmtCalendarDay(d)}>
                      <span className="block">{g.day}</span>
                      <span className="block tabular-nums text-slate-500">{g.date}</span>
                    </th>
                  );
                })}
                <th scope="col" className="px-3 py-2 text-right font-medium uppercase tracking-wider">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = player(r.id);
                const st = p?.st ?? "";
                const tag = dead.has(r.id)
                  ? { text: "ne peut pas marquer", tone: "rose" as const }
                  : st && st !== "ACTIVE"
                    ? { text: statusLabel(st).toLowerCase(), tone: "slate" as const }
                    : null;
                return (
                  <tr key={r.id} className="hover:bg-white/[0.03]">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 max-w-[11rem] border-t border-white/5 bg-slate-950 px-3 py-1.5 text-left font-normal sm:max-w-none"
                    >
                      <span className="block truncate font-medium text-white">{p?.n ?? "Nouveau joueur"}</span>
                      <span className="flex items-center gap-1.5 text-xs text-slate-400">
                        {p?.t ?? ""}
                        {tag ? <Tag tone={tag.tone}>{tag.text}</Tag> : null}
                        <SnakeLeagueMini id={r.id} decorative />
                      </span>
                    </th>
                    {r.games.map((g, i) => (
                      <td key={week.days[i]} className="border-t border-white/5 px-1 py-1.5 text-center">
                        {g ? (
                          <>
                            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-cyan-400" />
                            <span className="sr-only">match</span>
                          </>
                        ) : (
                          <>
                            <span aria-hidden="true" className="text-slate-700">·</span>
                            <span className="sr-only">aucun match</span>
                          </>
                        )}
                      </td>
                    ))}
                    <td className="border-t border-white/5 px-3 py-1.5 text-right font-semibold tabular-nums text-white">
                      {r.total}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="text-xs text-slate-400">
              <tr>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-t border-white/10 bg-slate-950 px-3 py-2 text-left font-medium"
                >
                  Joueurs qui jouent
                </th>
                {perDay.map((n, i) => (
                  <td key={week.days[i]} className="border-t border-white/10 px-1 py-2 text-center tabular-nums">
                    {n}
                  </td>
                ))}
                <td className="border-t border-white/10 px-3 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-400">Aucun match à venir dans cette période.</p>
      )}
    </LeagueCard>
  );
}
