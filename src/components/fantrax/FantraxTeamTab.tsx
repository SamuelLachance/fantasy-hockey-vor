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
 * Mon équipe: roster counts against the league limits, then — only in a league
 * whose config has the keeper model — the 2027 cutdown outlook against the
 * team's 10 keeper slots (with the dynasty mode switch) and the team's players
 * ranked by dynasty value with phase, cutdown outlook and keep / trade hint.
 * The whole roster comes from the league state until the pool is in. Another
 * team picked in the header is named as such.
 *
 * The tiles follow the league: a league with no Minors slot, whose IR and
 * Minors caps fxea does not publish, would otherwise be shown against a
 * maximum nobody ever read.
 */
export function FantraxTeamTab({ slug }: { slug: string }) {
  const { config, pack, limits, teamName, teamId, defaultTeamId, hasDynasty } = useFantraxLeague();
  const parts = pack?.parts;
  // The tile counts the INJURED_RESERVE status that fxea's rosters carry, so
  // it is a known IR count even without fxpa; only the injury icons (who is
  // hurt but still Active) are unread there, which the lineup advice says.
  const irLabel = config.features.fxpa ? "Blessés" : "Blessés (IR)";
  const irHint = config.features.fxpa
    ? undefined
    : "Joueurs placés sur la liste des blessés (IR) dans Fantrax. Cette ligue ne publie pas ses détails joueur : un joueur blessé qui n'a pas été placé en IR n'est pas signalé.";
  // Another team picked in the header: say so here too (the tab is « Mon équipe »).
  const heading = teamId === defaultTeamId ? `Effectif de ${teamName(teamId)}` : `Équipe consultée : ${teamName(teamId)}`;
  return (
    <div className="space-y-6">
      <FantraxPlanGate>
        {(plan) => {
          const c = plan.legality.counts;
          const tiles: Array<{ label: string; n: number; max: number | null; hint?: string }> = [
            // A league that publishes its total (Slapshot: 40, IR apart) shows it first.
            ...(limits.maxTotal !== undefined
              ? [{ label: "Total hors IR", n: c.counted + c.minors, max: limits.maxTotal, hint: "Actifs + Réserve + Mineures" }]
              : []),
            { label: "Actifs", n: c.active, max: limits.maxActive },
            { label: "Réserve", n: c.reserve, max: limits.maxReserve },
            // fxea publishes neither an IR cap nor a Minors cap. Where the
            // league's own rules page has not been read either, the count is
            // shown without a maximum rather than against an invented one.
            ...(config.features.minors
              ? [
                  { label: irLabel, n: c.ir, max: limits.maxIr, hint: irHint },
                  { label: "Mineures", n: c.minors, max: limits.maxMinors },
                ]
              : [{ label: irLabel, n: c.ir, max: null, hint: irHint }]),
          ];
          return (
            <LeagueCard
              id="effectif"
              icon={<Users className="h-5 w-5" />}
              title={heading}
              description={legalitySummary(plan.legality, config.features.minors, limits)}
            >
              <dl className={`grid grid-cols-2 gap-3 ${tiles.length > 4 ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
                {tiles.map((t) => (
                  <div
                    key={t.label}
                    className={`flex flex-col-reverse rounded-2xl border px-4 py-3 text-center ${
                      t.max !== null && t.n > t.max ? "border-rose-500/40 bg-rose-500/10" : "border-white/10 bg-white/5"
                    }`}
                  >
                    <dt className="text-xs uppercase tracking-wider text-slate-400" title={t.hint}>
                      {t.label}
                    </dt>
                    <dd className="text-2xl font-bold tabular-nums text-white">
                      {t.n}
                      {t.max !== null ? (
                        <span className="text-base font-medium text-slate-400">
                          {" "}
                          / {t.max}
                          <span className="sr-only"> au maximum</span>
                        </span>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </LeagueCard>
          );
        }}
      </FantraxPlanGate>
      {hasDynasty && config.features.keeperCutdown ? <DynastyTeamCard /> : null}
      {/* A salary-cap league's cap card and method note come with its league pack. */}
      {parts ? <parts.TeamCap /> : null}
      <FantraxPlayerTable
        id="effectif-joueurs"
        title={`Joueurs de ${teamName(teamId)}`}
        description={
          hasDynasty && config.salaryCap
            ? "Tout l’effectif par statut (actifs, réserve, blessés, mineures), classé par valeur dynastie : phase, salaire cette saison et la suivante, fin de contrat, avec la valeur de la saison et l’avis de Snake."
            : hasDynasty
            ? "Tout l’effectif, mineures comprises, classé par valeur dynastie : phase, écrémage 2027, conseil, avec la valeur de la saison et l’avis de Snake."
            : config.features.minors
              ? "Tout l’effectif, mineures comprises, avec les valeurs projetées et l’avis de Snake."
              : "Tout l’effectif, réserve comprise, avec les valeurs projetées et l’avis de Snake."
        }
        base="equipe"
        presets={[]}
        perPage={50}
        fallback="team"
        modeSwitch={false}
        key={slug}
      />
      {parts ? <parts.MethodNote /> : null}
    </div>
  );
}
