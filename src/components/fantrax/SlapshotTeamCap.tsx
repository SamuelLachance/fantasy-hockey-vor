"use client";

import { ArrowDownToLine, Coins } from "lucide-react";
import { useMemo } from "react";
import { capSeasonLabel, fmtMoney, salaryLine } from "@/lib/fantrax/salary-copy";
import { stashCandidates } from "@/lib/fantrax/slapshot-draft";
import { useFantraxLeague } from "./fantrax-league-context";
import { useFantraxTableData } from "./fantrax-table";
import { LeagueCard, Tag } from "./LeagueCard";

const STATUS_SHORT: Record<string, string> = { ACTIVE: "Actif", RESERVE: "Réserve" };

/**
 * Slapshot · Mon équipe: the cap use of the counted players (Active +
 * Reserve) season by season — cap, committed (signed, then projected next
 * contracts), room — and who to send to the minors to free cap at the lowest
 * cost in points (IR and Minors do not count against the cap).
 */
export function SlapshotTeamCap() {
  const { config, plan, teamId, state, bundle, contractsState } = useFantraxLeague();
  const { data } = useFantraxTableData({ autoLoad: true, fallback: "team" });
  const s = plan?.teamId === teamId ? (plan.salary ?? null) : null;
  const stash = useMemo(() => {
    const contracts = bundle?.contracts;
    const rules = config.salaryCap;
    if (!contracts || !rules || !state) return [];
    const rows = data.rows.length ? data.rows : (data.fallbackRows ?? []);
    return stashCandidates(rows, state.rosters[teamId] ?? [], rules, contracts);
  }, [bundle, config, state, data.rows, data.fallbackRows, teamId]);
  if (!config.salaryCap) return null;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <LeagueCard
        id="masse-salariale"
        icon={<Coins className="h-5 w-5" />}
        title="Masse salariale par saison"
        accentClass={s?.over ? "text-rose-400" : "text-amber-300"}
        description={
          s
            ? salaryLine(s)
            : contractsState === "error"
              ? "Salaires indisponibles : le fichier des contrats n’a pas pu être lu (Actualiser pour réessayer)."
              : "Salaires en chargement…"
        }
      >
        {s ? (
          <table className="w-full text-sm">
            <caption className="sr-only">Plafond, salaires engagés et marge par saison des joueurs comptés</caption>
            <thead>
              <tr className="text-xs text-slate-400">
                <th scope="col" className="py-1 text-left font-medium">
                  Saison
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Plafond
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Signé
                </th>
                <th scope="col" className="py-1 text-right font-medium" title="Contrats signés et prochains contrats projetés">
                  Engagé
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Marge
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {s.seasons.map((y, t) => (
                <tr key={y} className="border-t border-white/5">
                  <th scope="row" className="py-1 text-left font-normal text-slate-300">
                    {capSeasonLabel(y)}
                  </th>
                  <td className="py-1 text-right text-slate-300">{fmtMoney(s.cap[t]!)}</td>
                  <td className="py-1 text-right text-slate-300">{fmtMoney(s.signed[t]!)}</td>
                  <td className="py-1 text-right text-slate-200">{fmtMoney(s.used[t]!)}</td>
                  <td className={`py-1 text-right font-semibold ${s.room[t]! < 0 ? "text-rose-200" : "text-emerald-200"}`}>
                    {fmtMoney(s.room[t]!)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <p className="mt-2 text-xs text-slate-400">
          Comptés : les joueurs Actifs et en Réserve aujourd’hui ({config.salaryCap.countedSpots} places). Les saisons suivantes gardent les
          mêmes joueurs; « Engagé » ajoute aux contrats signés les prochains contrats projetés.
        </p>
      </LeagueCard>

      <LeagueCard
        id="mineures-plafond"
        icon={<ArrowDownToLine className="h-5 w-5" />}
        title="Libérer de la masse salariale"
        accentClass="text-cyan-300"
        description="Envoyer un joueur aux mineures (ou sur la liste des blessés s’il est blessé) retire son salaire du plafond. Les moins coûteux en points d’abord : ses points de la saison au-dessus du remplacement par M$ libéré."
      >
        {stash.length ? (
          <ul className="divide-y divide-white/5 text-sm">
            {stash.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
                <span className="min-w-0 flex-1 truncate font-medium text-white" title={c.name}>
                  {c.name}
                </span>
                <Tag>{STATUS_SHORT[c.status] ?? c.status}</Tag>
                <span className="tabular-nums text-slate-200">{fmtMoney(c.cap)} libérés</span>
                <span className="tabular-nums text-slate-400">
                  {c.points} pts ({c.perM.toFixed(1).replace(".", ",")}/M$)
                </span>
                {c.netNegative ? <Tag tone="amber">coûte plus qu’il ne rapporte</Tag> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">Aucun joueur compté avec un salaire connu.</p>
        )}
      </LeagueCard>
    </div>
  );
}
