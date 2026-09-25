"use client";

import { Users } from "lucide-react";
import { legalitySummary } from "@/lib/fantrax/league-copy";
import { FantraxPlanGate } from "./FantraxPlanGate";
import { useFantraxLeague } from "./fantrax-league-context";
import { FantraxPlayerTable } from "./fantrax-table";
import { LeagueCard } from "./LeagueCard";

/**
 * Captains · Mon équipe: roster counts against the league limits, then the
 * team's players with their values (the whole roster from the league
 * state until the pool is in). Another team picked in the header is named
 * as such.
 */
export function FantraxTeamTab() {
  const { limits, teamName, teamId, defaultTeamId } = useFantraxLeague();
  // Another team picked in the header: say so here too (the tab is « Mon équipe »).
  const heading = teamId === defaultTeamId ? `Effectif de ${teamName(teamId)}` : `Équipe consultée : ${teamName(teamId)}`;
  return (
    <div className="space-y-6">
      <FantraxPlanGate>
        {(plan) => {
          const c = plan.legality.counts;
          const tiles = [
            { label: "Actifs", n: c.active, max: limits.maxActive },
            { label: "Réserve", n: c.reserve, max: limits.maxReserve },
            { label: "Blessés", n: c.ir, max: limits.maxIr },
            { label: "Mineures", n: c.minors, max: limits.maxMinors },
          ];
          return (
            <LeagueCard
              id="effectif"
              icon={<Users className="h-5 w-5" />}
              title={heading}
              description={legalitySummary(plan.legality)}
            >
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {tiles.map((t) => (
                  <div
                    key={t.label}
                    className={`flex flex-col-reverse rounded-2xl border px-4 py-3 text-center ${
                      t.n > t.max ? "border-rose-500/40 bg-rose-500/10" : "border-white/10 bg-white/5"
                    }`}
                  >
                    <dt className="text-xs uppercase tracking-wider text-slate-400">{t.label}</dt>
                    <dd className="text-2xl font-bold tabular-nums text-white">
                      {t.n}
                      <span className="text-base font-medium text-slate-400">
                        {" "}
                        / {t.max}
                        <span className="sr-only"> au maximum</span>
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </LeagueCard>
          );
        }}
      </FantraxPlanGate>
      <FantraxPlayerTable
        id="effectif-joueurs"
        title={`Joueurs de ${teamName(teamId)}`}
        description="Tout l’effectif, mineures comprises, avec les valeurs projetées et l’avis de Snake."
        base="equipe"
        presets={[]}
        perPage={50}
        fallback="team"
      />
    </div>
  );
}
