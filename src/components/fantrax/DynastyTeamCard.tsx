"use client";

import { ShieldCheck } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { NBSP } from "@/lib/dynasty/keeper-view";
import type { DynastyRecord } from "@/lib/dynasty/types";
import { currentRecord, FIRST_CUTDOWN, keeperOutlook, teamDynastySummary } from "@/lib/fantrax/dynasty-hints";
import { fmtDateTime } from "@/lib/fantrax/league-copy";
import { syncOwnersOf } from "@/lib/fantrax/table";
import { pctCell } from "@/lib/fantrax/table-copy";
import { DynastyModeSwitch } from "./DynastyModeSwitch";
import { useFantraxLeague } from "./fantrax-league-context";
import { useDynastyIndex } from "./fantrax-table";
import { LeagueCard } from "./LeagueCard";

/** Keeper slots per team at the offseason cutdown. */
const SLOTS = 10;

type Entry = { id: string; name: string; r: DynastyRecord | null; zero: boolean };

/**
 * Captains · Mon équipe: the 2027 cutdown against the team's own 10
 * keeper slots (dynasty.json's team view), in one line (« 5 à protéger,
 * 6 à décider, 6 en location, 28 gratuits (mineures) »), the players to
 * decide on and the rentals to trade before then, with the dynasty mode
 * switch that also orders the table below. The team view holds on the
 * roster the model saw at the sync: players drafted, claimed or traded in
 * since are listed apart with the league's odds, out of the counts.
 */
export function DynastyTeamCard() {
  const { state, bundle, teamId, teamName, defaultTeamId, mode, plan, player } = useFantraxLeague();
  const { dynasty, settled } = useDynastyIndex(true);
  const roster = useMemo(() => state?.rosters[teamId] ?? null, [state, teamId]);
  const syncOwners = useMemo(() => syncOwnersOf(bundle?.state), [bundle]);
  const view = useMemo(() => {
    if (!dynasty || !roster) return null;
    const recs: Entry[] = roster.map((e) => {
      const rec = dynasty.byFantrax.get(e.id);
      const r = rec ? currentRecord(rec, e.id, teamId, syncOwners) : null;
      return { id: e.id, name: r?.n ?? player(e.id)?.n ?? e.id, r, zero: !r && dynasty.zero.has(e.id) };
    });
    const summary = teamDynastySummary(recs.map((x) => x.r));
    const byValue = (a: Entry, b: Entry) => (b.r?.dv[mode] ?? 0) - (a.r?.dv[mode] ?? 0);
    const counted = recs.filter((x): x is Entry & { r: DynastyRecord } => !!x.r?.keeper.team);
    const of = (status: string) => counted.filter((x) => x.r.keeper.team!.status === status);
    const decide = of("bubble").sort((a, b) => (keeperOutlook(b.r).p ?? 0) - (keeperOutlook(a.r).p ?? 0));
    const trade = of("rental")
      .filter((x) => x.r.dv.winNow >= 30)
      .sort(byValue);
    const core = of("core").sort(byValue);
    const arrived = recs.filter((x) => !x.r?.keeper.team).sort(byValue);
    return { summary, decide, trade, core, arrived };
  }, [dynasty, roster, mode, teamId, syncOwners, player]);

  const mine = teamId === defaultTeamId;
  const draftRunning = plan?.draft?.state === "running";
  let body: ReactNode;
  if (!settled || (dynasty && !roster)) {
    body = (
      <p role="status" className="text-sm text-slate-400">
        Chargement des valeurs dynastie…
      </p>
    );
  } else if (!view || !dynasty) {
    body = <p className="text-sm text-amber-200">Valeurs dynastie indisponibles pour le moment.</p>;
  } else {
    const { summary, decide, trade, core, arrived } = view;
    const left = Math.max(0, SLOTS - summary.core);
    const rows: Array<[string, string]> = [];
    if (core.length) rows.push([`À protéger (${core.length})`, core.map((x) => x.name).join(", ")]);
    if (decide.length) {
      rows.push([
        `À décider (${decide.length} pour ${left} ${left > 1 ? "places" : "place"})`,
        decide.map((x) => `${x.name} (${pctCell(keeperOutlook(x.r).p)})`).join(", "),
      ]);
    }
    if (trade.length) rows.push([`Location à échanger avant ${FIRST_CUTDOWN} (${trade.length})`, trade.map((x) => x.name).join(", ")]);
    if (arrived.length) {
      rows.push([
        `Arrivés depuis la synchro, hors décompte (${arrived.length})`,
        arrived
          .map((x) => {
            if (!x.r) return `${x.name} (${x.zero ? "valeur dynastie 0" : "non évalué"})`;
            const k = keeperOutlook(x.r);
            return `${x.name} (${k.label.toLowerCase()}${k.p != null ? `, ${pctCell(k.p)} ligue` : ""})`;
          })
          .join(", "),
      ]);
    }
    body = (
      <>
        <p className="text-base font-semibold text-white">{summary.text}.</p>
        {rows.length ? (
          <dl className="mt-3 grid gap-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-slate-400">{k}</dt>
                <dd className="text-slate-200">{v}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <p className="mt-3 text-xs text-slate-400">
          {`Chances d’être parmi les ${SLOTS} protégés de l’équipe en ${FIRST_CUTDOWN}, sur des milliers de saisons simulées, calculées sur l’effectif de la synchro${
            dynasty.builtAt ? ` du ${fmtDateTime(dynasty.builtAt)}` : ""
          }${draftRunning ? " (complété par le reste du repêchage selon le marché)" : ""}. Les joueurs arrivés depuis ont les chances de la ligue («${NBSP}ligue${NBSP}», 160 protégés) jusqu’à la prochaine synchro. Les joueurs encore admissibles aux mineures restent gratuits. Modèle automatique${NBSP}: à vérifier.`}
        </p>
      </>
    );
  }
  return (
    <LeagueCard
      id="ecremage"
      icon={<ShieldCheck className="h-5 w-5" />}
      title={`Écrémage ${FIRST_CUTDOWN}${NBSP}: ${SLOTS} protégés`}
      description={
        mine
          ? `Vos ${SLOTS} places de protection à l’écrémage de septembre ${FIRST_CUTDOWN}, d’après la valeur dynastie.`
          : `Les ${SLOTS} places de protection de ${teamName(teamId)} à l’écrémage de septembre ${FIRST_CUTDOWN}.`
      }
    >
      <DynastyModeSwitch idPrefix="ecremage" className="mb-4" />
      {body}
    </LeagueCard>
  );
}
