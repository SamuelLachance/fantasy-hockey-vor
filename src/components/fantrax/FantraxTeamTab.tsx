"use client";

import { ShieldCheck, Users } from "lucide-react";
import dynamic from "next/dynamic";
import { legalitySummary } from "@/lib/fantrax/league-copy";
import { FantraxPlanGate } from "./FantraxPlanGate";
import { useFantraxLeague } from "./fantrax-league-context";
import { FantraxPlayerTable } from "./fantrax-table";
import { LeagueCard } from "./LeagueCard";

// The 2027 cutdown card reads dynasty.json (fetched after the page loads):
// its own chunk, with the same frame (and `#ecremage` anchor) until then.
const DynastyTeamCard = dynamic(() => import("./DynastyTeamCard").then((m) => m.DynastyTeamCard), {
  ssr: false,
  loading: () => (
    <LeagueCard id="ecremage" icon={<ShieldCheck className="h-5 w-5" />} title={"Écrémage 2027 : 10 protégés"}>
      <p role="status" className="text-sm text-slate-400">
        Chargement des valeurs dynastie…
      </p>
    </LeagueCard>
  ),
});

/**
 * Captains · Mon équipe: roster counts against the league limits, the 2027
 * cutdown outlook against the team's 10 keeper slots (with the dynasty mode
 * switch), then the team's players ranked by dynasty value, with phase,
 * cutdown outlook and keep / trade hint (the whole roster from the league
 * state until the pool is in). Another team picked in the header is named
 * as such.
 */
export function FantraxTeamTab() {
  const { limits, teamName, teamId, defaultTeamId, hasDynasty } = useFantraxLeague();
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
      {hasDynasty ? <DynastyTeamCard /> : null}
      <FantraxPlayerTable
        id="effectif-joueurs"
        title={`Joueurs de ${teamName(teamId)}`}
        description={
          hasDynasty
            ? "Tout l’effectif, mineures comprises, classé par valeur dynastie : phase, écrémage 2027, conseil, avec la valeur de la saison et l’avis de Snake."
            : "Tout l’effectif, mineures comprises, avec les valeurs projetées et l’avis de Snake."
        }
        base="equipe"
        presets={[]}
        perPage={50}
        fallback="team"
        modeSwitch={false}
      />
    </div>
  );
}
