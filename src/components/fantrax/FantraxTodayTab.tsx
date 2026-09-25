"use client";

import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import { useTabSearch } from "@/components/league-shell/tab-search";
import { ordinal, pickLabel } from "@/lib/fantrax/league-copy";
import { leagueTabPath } from "@/lib/leagues/routes";
import { CapMeter } from "./CapMeter";
import { FantraxPlanGate } from "./FantraxPlanGate";
import { useFantraxLeague } from "./fantrax-league-context";
import { GoalieStarts } from "./GoalieStarts";
import { LineupCard } from "./LineupCard";
import { RosterAlerts } from "./RosterAlerts";
import { WeekGrid } from "./WeekGrid";

const SECTIONS = [
  { id: "alertes", label: "Légalité" },
  { id: "alignement", label: "Alignement" },
  { id: "gardiens", label: "Gardiens" },
  { id: "plafonds", label: "Plafonds" },
  { id: "calendrier", label: "Calendrier" },
];

/** Captains · Aujourd'hui: roster legality, best lineup and captain, goalies, caps, the week. */
export function FantraxTodayTab({ slug }: { slug: string }) {
  const { player, nowMs } = useFantraxLeague();
  const tabSearch = useTabSearch();
  return (
    <div className="space-y-6">
      <nav aria-label="Sections de la page">
        <ul className="flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="inline-flex min-h-11 items-center rounded-full border border-white/10 bg-white/5 px-3 text-sm text-slate-300 transition motion-reduce:transition-none hover:border-cyan-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <FantraxPlanGate>
        {(plan) => {
          const d = plan.draft;
          const myTurn = !!d?.current && !!d?.next && d.current.pick === d.next.pick;
          return (
            <>
              {d && d.state === "running" ? (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-violet-400/40 bg-violet-500/10 px-4 py-3 text-sm text-violet-50">
                  <Trophy className="h-4 w-4 shrink-0 text-violet-300" aria-hidden="true" />
                  <span>
                    {!d.next
                      ? "Repêchage en cours : vous n’avez plus de choix."
                      : myTurn
                        ? `Repêchage en cours : c’est votre tour (choix ${pickLabel(d.next.pick)}, ${ordinal(d.next.round)} ronde).`
                        : `Repêchage en cours : votre choix ${pickLabel(d.next.pick)} dans ${d.picksBefore} choix.`}
                  </span>
                  <Link
                    href={leagueTabPath(slug, "repechage", tabSearch)}
                    prefetch={false}
                    className="inline-flex min-h-11 items-center gap-1 rounded-md font-semibold text-violet-200 underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                  >
                    Ouvrir le repêchage
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </p>
              ) : null}
              <RosterAlerts plan={plan} player={player} />
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <LineupCard plan={plan} player={player} nowMs={nowMs} />
                <div className="min-w-0 space-y-6">
                  <GoalieStarts plan={plan} player={player} />
                  <CapMeter plan={plan} />
                </div>
              </div>
              <WeekGrid plan={plan} player={player} />
            </>
          );
        }}
      </FantraxPlanGate>
    </div>
  );
}
