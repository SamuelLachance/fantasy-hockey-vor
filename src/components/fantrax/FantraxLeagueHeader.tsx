"use client";

import { RefreshCw } from "lucide-react";
import { SnakeDisclaimerShort } from "@/components/snake/SnakeDisclaimer";
import { fmtDateTime, fmtTime } from "@/lib/fantrax/league-copy";
import { useFantraxLeague } from "./fantrax-league-context";

/**
 * The Captains Dynasty block of the league header, on every tab: the team
 * picker, « Actualiser », the data status (one polite live region with the
 * status words only), the read-only notice and the Snake disclaimer. The
 * user's own team is marked in the picker, with a way back to it while
 * another team is shown. On phones the picker and the button share a row
 * and the notices shrink to one short line each (still before the first
 * « Snake : … » chip), so each tab starts near the top.
 */
export function FantraxLeagueHeader() {
  const { teams, teamId, defaultTeamId, chooseTeam, plan, bundleState, live, liveState, busy, refresh, teamName } =
    useFantraxLeague();
  const mine = teamId === defaultTeamId;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        {/* Phones: the picker below shows the team already. */}
        <p className="hidden min-w-0 text-sm text-slate-400 sm:block">
          Équipe affichée :{" "}
          <span className="break-words text-base font-semibold text-white">{teamName(teamId)}</span>
          {mine ? <span className="text-slate-400"> (mon équipe)</span> : null}
        </p>
        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium uppercase tracking-wider text-slate-400 sm:flex-none">
            Équipe
            <select
              value={teamId}
              onChange={(e) => chooseTeam(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-white/15 bg-slate-900 px-3 text-sm normal-case tracking-normal text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 sm:w-64"
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id === defaultTeamId ? `${t.name} (mon équipe)` : t.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={refresh}
            aria-busy={busy}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 text-sm font-semibold text-cyan-200 transition motion-reduce:transition-none hover:border-cyan-400/60 hover:bg-cyan-500/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            <RefreshCw
              className={`h-4 w-4 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
              aria-hidden="true"
            />
            Actualiser
          </button>
        </div>
      </div>
      {mine ? null : (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-sm text-amber-50">
          <span>
            Vous consultez <span className="font-semibold">{teamName(teamId)}</span>, pas votre équipe.
          </span>
          <button
            type="button"
            onClick={() => chooseTeam(defaultTeamId)}
            className="inline-flex min-h-11 items-center rounded-md font-semibold text-amber-200 underline underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            Revenir à mon équipe ({teamName(defaultTeamId)})
          </button>
        </p>
      )}

      {/* Only the status words are live: the read times sit outside the
          region, so the 90 s draft polling never re-announces them. */}
      <p className="text-sm text-slate-400">
        {plan ? (
          <>
            Données synchronisées : <time dateTime={plan.dataAsOf}>{fmtDateTime(plan.dataAsOf)}</time>
            <span className="mx-2 text-slate-600" aria-hidden="true">
              ·
            </span>
          </>
        ) : null}
        <span aria-live="polite">
          {bundleState === "error" ? (
            <span className="text-amber-200">
              {"Données détaillées indisponibles : plan de la dernière synchronisation (Actualiser pour réessayer)."}
            </span>
          ) : liveState === "ready" && live ? (
            <span className="text-cyan-300">Effectifs et repêchage en direct de Fantrax</span>
          ) : liveState === "error" ? (
            <span className="text-amber-200">
              {live
                ? "Fantrax injoignable : effectifs de la dernière lecture en direct"
                : "Fantrax injoignable : effectifs de la dernière synchronisation."}
            </span>
          ) : (
            <span>Lecture des effectifs en direct…</span>
          )}
        </span>
        {bundleState !== "error" && live && (liveState === "ready" || liveState === "error") ? (
          <span className={liveState === "ready" ? "text-cyan-300" : "text-amber-200"}>
            {liveState === "ready" ? " : " : ", "}
            <time dateTime={live.fetchedAt}>{fmtTime(live.fetchedAt)}</time>
            {liveState === "error" ? "." : null}
          </span>
        ) : null}
      </p>
      {/* Every width, before the first « Snake : … » chip (lineup, waivers, draft), not after them. */}
      <p className="text-xs text-slate-400">
        <span className="sm:hidden">Outil non officiel, en lecture seule : il ne modifie jamais votre équipe.</span>
        <span className="max-sm:hidden">
          {
            "Outil non officiel, en lecture seule : il ne se connecte jamais à votre compte et ne modifie jamais votre équipe. Faites les changements vous-même dans Fantrax."
          }
        </span>
      </p>
      <SnakeDisclaimerShort className="max-w-3xl" />
    </div>
  );
}
