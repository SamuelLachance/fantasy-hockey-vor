import { ChevronRight, Trophy } from "lucide-react";
import type { DailyPlan } from "@/lib/fantrax/daily-plan";
import { DRAFT_GROUPS } from "@/lib/fantrax/draft";
import {
  draftVonaIntro,
  fmtAgo,
  fmtNum,
  fmtOdds,
  fmtSigned,
  fmtTime,
  ordinal,
  pickLabel,
} from "@/lib/fantrax/league-copy";
import type { RecentPick } from "@/lib/fantrax/live";
import { SnakeLeagueNote } from "@/components/snake/SnakeVerdicts";
import { LeagueCard, PlayerName, type PlayerLookup } from "./LeagueCard";

interface DraftPanelProps {
  plan: DailyPlan;
  player: PlayerLookup;
  teamName: (teamId: string) => string;
  /** Latest picks read live from Fantrax (null until the first live read). */
  recent: RecentPick[] | null;
  /** When the live picks were read, ISO. */
  liveAt: string | null;
  nowMs: number | null;
}

/** `Vincent Trocheck` → `Trocheck` (narrow VONA cards). */
const familyName = (n: string) => n.split(" ").slice(1).join(" ") || n;

/**
 * The league draft while it runs: who is on the clock, the user's next
 * picks, value over next available (VONA) by position, then the latest
 * picks (folded, so the best available table right below the panel stays
 * near the top). Picks refresh live from Fantrax in the browser.
 */
export function DraftPanel({ plan, player, teamName, recent, liveAt, nowMs }: DraftPanelProps) {
  const d = plan.draft;
  if (!d) return null;
  const { next, following } = d;
  const myTurn = !!d.current && !!next && d.current.pick === next.pick;

  return (
    <LeagueCard
      id="repechage"
      icon={<Trophy className="h-5 w-5" />}
      title={d.state === "running" ? "Repêchage en cours" : "Repêchage"}
      accentClass="text-violet-300"
      headerExtra={
        <span className="text-xs tabular-nums text-slate-400">
          {d.made}/{d.total} choix faits
        </span>
      }
    >
      <div
        className={`rounded-xl px-4 py-3 text-sm ${
          myTurn
            ? "border border-violet-400/50 bg-violet-500/15 text-violet-50"
            : "border border-white/10 bg-white/[0.03] text-slate-200"
        }`}
      >
        {myTurn && d.next ? (
          <p className="text-base font-semibold">
            {"C'est votre tour"} : choix n° {d.next.pick} ({ordinal(d.next.round)} ronde).
          </p>
        ) : d.current ? (
          <p>
            Au tour de : <span className="font-medium text-white">{teamName(d.current.teamId)}</span>{" "}
            <span className="text-slate-400">
              (choix n° {d.current.pick}, {ordinal(d.current.round)} ronde)
            </span>
          </p>
        ) : null}
        {d.next && !myTurn ? (
          <p className="mt-1">
            Votre prochain choix : <span className="font-semibold text-white">n° {d.next.pick}</span> (
            {ordinal(d.next.round)} ronde), dans {d.picksBefore} choix
            {d.following ? `; ensuite n° ${d.following.pick}` : ""}.
          </p>
        ) : null}
        {!d.next ? <p className="mt-1">Vous n&apos;avez plus de choix.</p> : null}
        {d.remaining.length > 0 ? (
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
            Vos choix restants :
            {d.remaining.map((p) => (
              <span key={p} className="rounded-md bg-white/5 px-1.5 py-0.5 tabular-nums text-slate-200">
                {p}
              </span>
            ))}
          </p>
        ) : null}
      </div>

      {next ? (
        <>
          <h3 className="mt-5 text-sm font-semibold text-white">VONA par position</h3>
          <p className="mt-1 text-xs text-slate-400">{draftVonaIntro(next.pick, following?.pick ?? null)}</p>
          <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {DRAFT_GROUPS.map((g) => {
              const v = d.vona[g];
              // The most likely best one left at each of my next two picks.
              const rows = [
                { pick: next.pick, id: v.bestId, p: v.bestP },
                ...(following ? [{ pick: following.pick, id: v.laterId, p: v.laterP }] : []),
              ];
              return (
                <li key={g} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-400">{g}</span>
                    <span className="text-lg font-semibold tabular-nums text-white">
                      {v.vona == null ? "—" : fmtSigned(v.vona, 1)}
                    </span>
                  </div>
                  <dl className="mt-1 space-y-0.5 text-xs">
                    {rows.map((r) => (
                      <div key={r.pick} className="flex min-w-0 items-baseline gap-1.5">
                        <dt className="shrink-0 tabular-nums text-slate-400">{pickLabel(r.pick)}</dt>
                        {/* The odds never truncate away with a long name. */}
                        <dd className="flex min-w-0 flex-1 items-baseline gap-1">
                          {r.id ? (
                            <>
                              <span className="min-w-0 truncate text-slate-300">
                                {/* Phones show the family name; assistive tech always gets the full one. */}
                                <span aria-hidden="true" className="sm:hidden">
                                  {familyName(player(r.id)?.n ?? "—")}
                                </span>
                                <span className="max-sm:sr-only">{player(r.id)?.n ?? "—"}</span>
                              </span>{" "}
                              <span className="shrink-0 whitespace-nowrap tabular-nums text-slate-400">
                                {fmtOdds(r.p)}
                              </span>
                            </>
                          ) : (
                            <span className="text-slate-300">Personne</span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {following ? (
                    <p className="mt-1 text-xs tabular-nums text-slate-400">
                      Attendu :{" "}
                      <span className="whitespace-nowrap">
                        {fmtNum(v.now, 1)} → {fmtNum(v.later, 1)}
                      </span>
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {recent && recent.length > 0 ? (
        // Folded: the best available table comes right after VONA (the live
        // draft's first need); the latest picks are one tap away.
        <details className="group mt-5 rounded-xl border border-white/10">
          <summary className="flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-xl px-3 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
            <ChevronRight
              className="h-4 w-4 shrink-0 text-slate-400 transition-transform motion-reduce:transition-none group-open:rotate-90"
              aria-hidden="true"
            />
            <span>Derniers choix</span>
            <span className="text-xs font-normal text-slate-400">
              ({recent.length}; dernier : {pickLabel(recent[0]!.pick)} {player(recent[0]!.playerId)?.n ?? "—"})
            </span>
          </summary>
          <ol className="divide-y divide-white/5 border-t border-white/10 text-sm">
            {recent.map((r) => (
              <li key={r.pick} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                <span className="w-12 tabular-nums text-slate-400">n° {r.pick}</span>
                <PlayerName id={r.playerId} player={player} className="mr-auto" />
                <SnakeLeagueNote id={r.playerId} name={player(r.playerId)?.n} />
                <span className="text-xs text-slate-400">
                  {teamName(r.teamId)}
                  {nowMs !== null && r.time > 0 && r.time <= nowMs ? ` · ${fmtAgo(r.time, nowMs)}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {liveAt ? (
        <p className="mt-2 text-xs text-slate-400">
          Choix lus en direct sur Fantrax à {fmtTime(liveAt)}; mise à jour automatique aux 90 secondes pendant le
          repêchage.
        </p>
      ) : null}
    </LeagueCard>
  );
}
