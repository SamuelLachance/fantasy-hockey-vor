import { ArrowRight, Crown, ListOrdered } from "lucide-react";
import type { DailyPlan, PlanLineup } from "@/lib/fantrax/daily-plan";
import {
  fmtCalendarDay,
  fmtCountdown,
  fmtDay,
  fmtNum,
  fmtSigned,
  fmtTime,
  fmtZone,
  gameLabel,
  moveEndLabel,
} from "@/lib/fantrax/league-copy";
import { SnakeLeagueNote } from "@/components/snake/SnakeVerdicts";
import { LeagueCard, PlayerName, SlotBadge, Tag, type PlayerLookup } from "./LeagueCard";

interface LineupCardProps {
  plan: DailyPlan;
  player: PlayerLookup;
  /** Null until mounted (the countdown is client-only). */
  nowMs: number | null;
}

function LineupTable({
  lineup,
  player,
  caption,
  withGames,
}: {
  lineup: PlanLineup;
  player: PlayerLookup;
  caption: string;
  withGames: boolean;
}) {
  const moved = new Map(lineup.moves.map((m) => [m.id, m.from]));
  const captainId = lineup.captain?.id;
  return (
    // Scrolls rather than clips if a row is ever wider than a phone.
    <div className="relative overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-white/5 text-left text-xs uppercase tracking-wider text-slate-400">
          <tr>
            <th scope="col" className="w-14 px-3 py-2 font-medium">
              Poste
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Joueur
            </th>
            {withGames ? (
              <th scope="col" className="hidden px-2 py-2 font-medium sm:table-cell">
                Match
              </th>
            ) : null}
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Pts prévus
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {lineup.slots.map((s, i) => {
            const isCaptain = s.slot === "Skt" && !!s.id && s.id === captainId;
            const from = s.id ? moved.get(s.id) : undefined;
            return (
              <tr key={`${s.slot}-${i}`} className={isCaptain ? "bg-amber-500/[0.06]" : undefined}>
                <td className="px-3 py-2 align-top">
                  <SlotBadge slot={s.slot} />
                </td>
                <td className="px-2 py-2 align-top">
                  {s.id ? (
                    <div className="flex flex-col gap-1">
                      <PlayerName id={s.id} player={player} />
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isCaptain && lineup.captain ? (
                          <Tag tone="amber" wrap>
                            <Crown className="h-3 w-3 shrink-0" aria-hidden="true" />
                            Capitaine · {fmtSigned(lineup.captain.gain)} vs son meilleur autre poste
                          </Tag>
                        ) : null}
                        {from ? <Tag>depuis {moveEndLabel(from)}</Tag> : null}
                        {withGames ? (
                          <span className="text-xs text-slate-400 sm:hidden">{gameLabel(s.game)}</span>
                        ) : null}
                      </div>
                      <SnakeLeagueNote id={s.id} name={player(s.id)?.n} line />
                    </div>
                  ) : (
                    <span className="text-slate-400">— poste vide</span>
                  )}
                </td>
                {withGames ? (
                  <td className="hidden px-2 py-2 align-top text-slate-300 sm:table-cell">
                    {s.id ? gameLabel(s.game) : ""}
                  </td>
                ) : null}
                <td className="px-3 py-2 text-right align-top tabular-nums text-slate-200">
                  {fmtNum(s.value)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t border-white/10 bg-white/[0.03]">
          <tr>
            <th scope="row" colSpan={2} className="px-3 py-2 text-left text-sm font-semibold text-white">
              Total prévu
            </th>
            {/* The game column is hidden on phones; a colSpan would misalign it. */}
            {withGames ? <td className="hidden sm:table-cell" /> : null}
            <td className="px-3 py-2 text-right font-semibold tabular-nums text-white">
              {fmtNum(lineup.total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function MovesList({ lineup, player }: { lineup: PlanLineup; player: PlayerLookup }) {
  if (lineup.moves.length === 0) {
    return (
      <p className="mt-3 text-sm text-emerald-200">
        Aucun mouvement : votre alignement actuel est déjà optimal.
      </p>
    );
  }
  return (
    <ol className="mt-2 space-y-1.5 text-sm">
      {lineup.moves.map((m) => (
        <li key={`${m.id}-${m.to}`} className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-white">{player(m.id)?.n ?? "Nouveau joueur"}</span>
          <span className="inline-flex items-center gap-1 text-slate-300">
            <Tag>{moveEndLabel(m.from)}</Tag>
            <ArrowRight className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            <span className="sr-only">vers</span>
            <Tag tone={m.to === "RESERVE" ? "slate" : "emerald"}>{moveEndLabel(m.to)}</Tag>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The lineup that locks next (optimal for that day's games), the moves to
 * make in Fantrax, the captain pick, and the schedule-free per-game lineup.
 * The captain advice compares whole per-game lineups (each candidate forced
 * into Skt, the other slots re-filled), so it always matches the optimizer.
 */
export function LineupCard({ plan, player, nowMs }: LineupCardProps) {
  const t = plan.target;
  const best = plan.captains[0];
  const current = plan.currentCaptain;
  const lockMs = t ? Date.parse(t.start) : null;

  return (
    <LeagueCard
      id="alignement"
      icon={<ListOrdered className="h-5 w-5" />}
      title={t ? `Alignement optimal · ${fmtCalendarDay(t.date)}` : "Alignement optimal"}
      description={
        t ? (
          <>
            Verrouillage :{" "}
            <time dateTime={t.start} className="text-slate-200">
              {fmtDay(t.start)} à {fmtTime(t.start)} ({fmtZone(t.start)})
            </time>
            {nowMs !== null && lockMs !== null ? (
              <span className="text-cyan-300"> ({fmtCountdown(lockMs, nowMs)})</span>
            ) : null}
            . Reproduisez cet alignement dans Fantrax avant le premier match.
          </>
        ) : (
          "Aucune période d'alignement à venir cette saison."
        )
      }
    >
      {plan.lineup ? (
        <>
          <LineupTable
            lineup={plan.lineup}
            player={player}
            withGames
            caption={t ? `Alignement optimal du ${fmtCalendarDay(t.date)}` : "Alignement optimal"}
          />
          <h3 className="mt-5 text-sm font-semibold text-white">Mouvements à faire dans Fantrax</h3>
          <MovesList lineup={plan.lineup} player={player} />
        </>
      ) : null}

      <div className="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-200">
          <Crown className="h-4 w-4" aria-hidden="true" />
          Capitaine (poste Skt)
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          {
            "Le poste Skt compte l'attaque ×1,5 (buts, passes, tirs, mises en échec). Un défenseur y perd ses points de tirs bloqués et de revirements provoqués : le capitaine devrait presque toujours être un attaquant."
          }
        </p>
        {current ? (
          <p className="mt-3 text-sm text-slate-200">
            Capitaine actuel : <span className="font-medium text-white">{player(current.id)?.n ?? "—"}</span>.{" "}
            {best && best.id !== current.id && current.delta < 0 ? (
              <>
                Nommer <span className="font-medium text-amber-200">{player(best.id)?.n}</span> capitaine
                (et replacer les autres) ajoute{" "}
                <span className="font-semibold tabular-nums text-amber-200">{fmtSigned(-current.delta)} pt</span>{" "}
                par match à l&apos;alignement par match.
              </>
            ) : (
              <>{"C'est déjà le meilleur choix."}</>
            )}
          </p>
        ) : (
          <p className="mt-3 text-sm text-slate-200">
            Poste Skt vide
            {best ? (
              <>
                {" "}: placez-y <span className="font-medium text-amber-200">{player(best.id)?.n}</span>.
              </>
            ) : (
              "."
            )}
          </p>
        )}
        {plan.captains.length > 0 ? (
          <>
            <h4 className="mt-3 text-xs font-medium uppercase tracking-wider text-slate-400">
              Meilleurs capitaines (écart par match avec le meilleur choix)
            </h4>
            <ol className="mt-1 flex flex-wrap gap-2 text-sm">
              {plan.captains.map((c, i) => (
                <li key={c.id} className="rounded-lg bg-white/5 px-2.5 py-1 text-slate-200">
                  <span className="text-slate-400">{i + 1}.</span> {player(c.id)?.n ?? "—"}{" "}
                  <span className="tabular-nums text-amber-200">
                    {c.delta < 0 ? fmtSigned(c.delta) : "meilleur"}
                  </span>
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </div>

      <details className="mt-6 rounded-xl border border-white/10 bg-white/[0.02]">
        <summary className="flex min-h-11 cursor-pointer items-center px-4 py-2 text-sm font-medium text-slate-200 hover:text-white">
          Alignement par match (calendrier ignoré)
        </summary>
        <div className="space-y-3 px-3 pb-4 sm:px-4">
          <p className="text-xs text-slate-400">
            Qui mérite les postes actifs à long terme, selon les points prévus par match, peu importe
            qui joue ce soir.
          </p>
          <LineupTable
            lineup={plan.baseLineup}
            player={player}
            withGames={false}
            caption="Alignement optimal par match, calendrier ignoré"
          />
          <MovesList lineup={plan.baseLineup} player={player} />
        </div>
      </details>
    </LeagueCard>
  );
}
