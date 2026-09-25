import { Trophy } from "lucide-react";
import type { DailyPlan } from "@/lib/fantrax/daily-plan";
import { DRAFT_GROUPS } from "@/lib/fantrax/draft";
import { fmtAgo, fmtNum, fmtSigned, fmtTime, ordinal, positionsLabel } from "@/lib/fantrax/league-copy";
import type { RecentPick } from "@/lib/fantrax/live";
import { LeagueCard, PlayerName, Tag, type PlayerLookup } from "./LeagueCard";

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

/**
 * The league draft while it runs: who is on the clock, the user's next
 * picks, value over next available (VONA) by position and the best
 * available board. Picks refresh live from Fantrax in the browser.
 */
export function DraftPanel({ plan, player, teamName, recent, liveAt, nowMs }: DraftPanelProps) {
  const d = plan.draft;
  if (!d) return null;
  const myTurn = !!d.current && !!d.next && d.current.pick === d.next.pick;

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

      {d.next ? (
        <>
          <h3 className="mt-5 text-sm font-semibold text-white">VONA par position</h3>
          <p className="mt-1 text-xs text-slate-400">
            {d.following
              ? `Valeur du meilleur disponible à votre choix n° ${d.next.pick} moins celle attendue au n° ${d.following.pick}, en retirant les joueurs pris entre-temps selon l'ADP Fantrax. Plus c'est haut, plus il faut prendre cette position maintenant.`
              : "Dernier choix : prenez simplement la meilleure valeur."}
          </p>
          <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {DRAFT_GROUPS.map((g) => {
              const v = d.vona[g];
              return (
                <li key={g} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-400">{g}</span>
                    <span className="text-lg font-semibold text-white">
                      {v.vona == null ? "—" : fmtSigned(v.vona, 1)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-300">
                    {v.bestId ? (player(v.bestId)?.n ?? "—") : "Personne"}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      <h3 className="mt-5 text-sm font-semibold text-white">Meilleurs disponibles</h3>
      <div className="relative -mx-4 mt-2 overflow-x-auto sm:mx-0 sm:rounded-xl sm:border sm:border-white/10">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Meilleurs joueurs disponibles au repêchage</caption>
          <thead className="bg-white/5 text-left text-xs uppercase tracking-wider text-slate-400">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Joueur
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium" title="Points projetés sur la saison">
                Pts saison
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Valeur
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                VONA
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Âge
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium" title="Part des ligues Fantrax où il est pris">
                % Fantrax
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {d.board.map((b) => {
              const p = player(b.id);
              return (
                <tr key={b.id}>
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <span className="font-medium text-white">{p?.n ?? "—"}</span>{" "}
                    <span className="whitespace-nowrap text-xs text-slate-400">
                      {p?.t} · {p ? positionsLabel(p.e) : ""}
                    </span>
                    {b.likelyGone ? (
                      <span className="mt-0.5 block">
                        <Tag tone="amber">{"risque d'être pris avant votre tour"}</Tag>
                      </span>
                    ) : null}
                  </th>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-300">{fmtNum(b.seasonFp, 0)}</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums text-white">{fmtNum(b.value, 0)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-violet-200">
                    {b.vona == null ? "—" : fmtNum(b.vona, 1)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-300">{p?.age ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                    {p?.ros !== undefined ? fmtNum(p.ros, 0) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {
          "Valeur = points projetés sur la saison, jusqu'à +50 % si vos postes D ou G sont vides. L'âge et le % Fantrax servent d'indices dynastie. Les espoirs sans projection ne sont pas classés."
        }
      </p>

      {recent && recent.length > 0 ? (
        <>
          <h3 className="mt-5 text-sm font-semibold text-white">Derniers choix</h3>
          <ol className="mt-2 divide-y divide-white/5 rounded-xl border border-white/10 text-sm">
            {recent.map((r) => (
              <li key={r.pick} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                <span className="w-12 tabular-nums text-slate-500">n° {r.pick}</span>
                <PlayerName id={r.playerId} player={player} className="mr-auto" />
                <span className="text-xs text-slate-400">
                  {teamName(r.teamId)}
                  {nowMs !== null && r.time > 0 && r.time <= nowMs ? ` · ${fmtAgo(r.time, nowMs)}` : ""}
                </span>
              </li>
            ))}
          </ol>
          {liveAt ? (
            <p className="mt-2 text-xs text-slate-500">
              Choix lus en direct sur Fantrax à {fmtTime(liveAt)}; mise à jour automatique aux 90 secondes pendant le
              repêchage.
            </p>
          ) : null}
        </>
      ) : null}
    </LeagueCard>
  );
}
