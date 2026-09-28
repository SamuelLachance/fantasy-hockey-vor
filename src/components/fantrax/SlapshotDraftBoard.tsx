"use client";

import { BellRing, Coins, LayoutGrid, ListChecks, Users } from "lucide-react";
import { useMemo } from "react";
import { fmtTime, ordinal, pickLabel } from "@/lib/fantrax/league-copy";
import { capSeasonLabel, fmtMoney } from "@/lib/fantrax/salary-copy";
import { wingSentence, type SeatCount } from "@/lib/fantrax/seat-needs";
import { draftBoardView } from "@/lib/fantrax/slapshot-draft";
import { contractEndLabel, salaryCell } from "@/lib/fantrax/contract-copy";
import { rowDynastyValue, rowSalary } from "@/lib/fantrax/table";
import { DYNASTY_MODE_LABEL } from "@/lib/fantrax/dynasty-mode";
import { fmtInt } from "@/lib/player-table/copy";
import { TurnAlertToggle } from "./DraftTurnWatcher";
import { useFantraxLeague } from "./fantrax-league-context";
import { useFantraxTableData } from "./fantrax-table";
import { LeagueCard, Tag } from "./LeagueCard";

const rankLabel = (n: number) => (n === 1 ? "1er" : `${n}e`);
const STATUS_SHORT: Record<string, string> = {
  ACTIVE: "Actif",
  RESERVE: "Réserve",
  MINORS: "Mineures",
  INJURED_RESERVE: "Blessés",
  PICK: "Choisi",
};

/**
 * « C’EST À TOI » while a LIVE read says the chosen team is on the clock (a
 * loud banner; never from the draft baked into the build, and dated when the
 * last read's draft half failed). The browser tab's title carries the same
 * cue on every tab of the league (`DraftTurnWatcher`).
 */
export function SlapshotTurnCue() {
  const { teamId, defaultTeamId, teamName, plan, draftLive } = useFantraxLeague();
  const d = plan?.teamId === teamId ? plan.draft : null;
  const myTurn = draftLive.cue && !!d?.current && !!d?.next && d.current.pick === d.next.pick;
  const mine = teamId === defaultTeamId;
  return (
    <>
      {myTurn && d?.next ? (
        <p
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-amber-300/70 bg-amber-400/20 px-4 py-4 text-amber-50 shadow-lg shadow-amber-500/10"
        >
          <BellRing className="h-7 w-7 shrink-0 text-amber-200 motion-safe:animate-bounce" aria-hidden="true" />
          <span className="text-2xl font-black tracking-wide sm:text-3xl">{mine ? "C’EST À TOI !" : `Au tour de ${teamName(teamId)}`}</span>
          <span className="text-sm sm:text-base">
            Choix {pickLabel(d.next.pick)} ({ordinal(d.next.round)} ronde)
            {d.following ? `; ensuite ${pickLabel(d.following.pick)}` : ""}.
            {!draftLive.current && draftLive.at ? ` (Données du dernier succès à ${fmtTime(draftLive.at)}.)` : ""}
          </span>
        </p>
      ) : null}
      {mine && d?.state === "running" ? <TurnAlertToggle /> : null}
    </>
  );
}

/** One tile of the needs card. */
function NeedTile({ label, title, c, sub }: { label: string; title?: string; c: SeatCount; sub?: string | null }) {
  return (
    <li
      className={`rounded-xl border px-2 py-2 text-center ${
        c.empty > 0 ? "border-amber-400/40 bg-amber-500/10" : "border-emerald-500/30 bg-emerald-500/10"
      }`}
    >
      <span className="block text-xs font-semibold text-slate-300" title={title}>
        {label}
      </span>
      <span className="block text-lg font-bold tabular-nums text-white">
        {c.filled}/{c.max}
      </span>
      <span className={`block text-xs ${c.empty > 0 ? "text-amber-200" : "text-emerald-200"}`}>
        {c.empty > 0 ? `${c.empty} à combler` : "complet"}
      </span>
      {sub ? <span className="mt-0.5 block text-xs tabular-nums text-slate-300">{sub}</span> : null}
    </li>
  );
}

/**
 * Slapshot · Repêchage, below the draft panel: my roster so far with its cap use over the 23 counted
 * spots (Active + Reserve) and the room per season, the empty starting seats
 * against C4 LW4 RW4 D6 G2 (the wings as one pool: a LW/RW player sits on
 * either side; the same fill as the stand-alone page), and the best available
 * at each position by dynasty value in the page's mode. Everything follows
 * the live read of rosters and picks (every 20 s while the draft runs).
 */
export function SlapshotDraftBoard() {
  const { config, teamId, defaultTeamId, teamName, state, bundle, contractsState, mode } = useFantraxLeague();
  const { data } = useFantraxTableData({ autoLoad: true, fallback: "draft" });
  const mine = teamId === defaultTeamId;

  const view = useMemo(() => {
    // The whole pool once it is in; the plan's board until then.
    const rows = data.rows.length ? data.rows : (data.fallbackRows ?? []);
    const roster = state?.rosters[teamId] ?? [];
    const myPicks = (state?.draft?.picks ?? []).filter((p) => p.teamId === teamId && p.playerId).map((p) => p.playerId!);
    return draftBoardView({
      rows,
      roster,
      myPicks,
      mode,
      order: config.slots.order,
      counts: config.slots.counts,
      groups: config.eligibility.groups,
      contracts: bundle?.contracts ?? null,
      rules: config.salaryCap,
    });
  }, [data.rows, data.fallbackRows, state, teamId, mode, config, bundle]);

  const s = view.salary;
  const slots = Object.values(view.needs.slots);
  const seats = slots.reduce((n, x) => n + x.max, 0);
  const filled = slots.reduce((n, x) => n + x.filled, 0);
  const w = view.needs.wing;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        <LeagueCard
          id="masse-salariale"
          icon={<Coins className="h-5 w-5" />}
          title="Masse salariale"
          accentClass={s?.over ? "text-rose-400" : "text-amber-300"}
          description={
            s ? (
              <>
                {`${fmtMoney(s.used[0]!)} sur ${fmtMoney(s.cap[0]!)} : marge `}
                <strong className={s.room[0]! < 0 ? "text-rose-200" : "text-white"}>{fmtMoney(s.room[0]!)}</strong>
                {` (${s.counted} joueurs comptés sur ${s.spots}; mineures et blessés hors plafond).`}
              </>
            ) : contractsState === "error" ? (
              <span className="text-amber-200">Salaires indisponibles : le fichier des contrats n’a pas pu être lu (Actualiser pour réessayer).</span>
            ) : (
              "Salaires en chargement…"
            )
          }
        >
          {s ? (
            <>
              {view.roomPerSpot !== null ? (
                <p className="text-sm text-slate-300">
                  Marge moyenne par poste compté encore libre ({s.spots - s.counted}) :{" "}
                  <span className="font-semibold tabular-nums text-white">{fmtMoney(view.roomPerSpot)}</span>
                </p>
              ) : s.surplus.length ? (
                <p className="text-sm text-amber-200">
                  {s.listed} joueurs Actifs + Réserve pour {s.spots} places comptées : la masse compte les {s.spots} meilleurs cette
                  saison; les {s.surplus.length} autres iront aux mineures (hors plafond).
                </p>
              ) : null}
              <table className="mt-2 w-full text-sm">
                <caption className="sr-only">Masse salariale par saison des joueurs comptés</caption>
                <thead>
                  <tr className="text-xs text-slate-400">
                    <th scope="col" className="py-1 text-left font-medium">
                      Saison
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      Plafond
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
                      <td className="py-1 text-right text-slate-200" title={`Dont signé : ${fmtMoney(s.signed[t]!)}`}>
                        {fmtMoney(s.used[t]!)}
                      </td>
                      <td className={`py-1 text-right font-semibold ${s.room[t]! < 0 ? "text-rose-200" : "text-emerald-200"}`}>
                        {fmtMoney(s.room[t]!)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {s.unknown.length ? (
                <p className="mt-1 text-xs text-slate-400">
                  {s.unknown.length} joueur{s.unknown.length > 1 ? "s" : ""} sans salaire connu (compté{s.unknown.length > 1 ? "s" : ""} 0).
                </p>
              ) : null}
            </>
          ) : null}
        </LeagueCard>

        <LeagueCard
          id="besoins"
          icon={<LayoutGrid className="h-5 w-5" />}
          title="Besoins par position"
          accentClass="text-cyan-300"
          description={`${filled} des ${seats} postes partants remplis par les Actifs, la Réserve et les choix (C4 LW4 RW4 D6 G2; mineures et blessés à part).`}
        >
          <ul className="grid grid-cols-4 gap-2">
            {view.needs.slots.C ? <NeedTile label="C" c={view.needs.slots.C} /> : null}
            {w ? (
              <NeedTile
                label="Ailiers"
                title="4 LW et 4 RW : un joueur LW/RW compte d’un côté ou de l’autre"
                c={w}
                sub={w.empty > 0 ? `LW ≤ ${w.lw} · RW ≤ ${w.rw}` : null}
              />
            ) : null}
            {view.needs.slots.D ? <NeedTile label="D" c={view.needs.slots.D} /> : null}
            {view.needs.slots.G ? <NeedTile label="G" c={view.needs.slots.G} /> : null}
          </ul>
          {w ? (
            <p className="mt-2 text-xs text-slate-400">{wingSentence(w)}</p>
          ) : null}
        </LeagueCard>

        <LeagueCard
          id="mon-equipe-repechage"
          icon={<Users className="h-5 w-5" />}
          title={mine ? `Mon équipe jusqu’ici (${view.mine.length})` : `${teamName(teamId)} (${view.mine.length})`}
          accentClass="text-violet-300"
          description={`Valeur dynastie (mode ${DYNASTY_MODE_LABEL[mode]}) et salaires ${capSeasonLabel(config.salaryCap?.firstSeason ?? 2026)} / ${capSeasonLabel((config.salaryCap?.firstSeason ?? 2026) + 1)}, M$.`}
        >
          {view.mine.length ? (
            <ul className="divide-y divide-white/5 text-sm">
              {view.mine.map((p) => (
                <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5">
                  {/* Phones: the whole name on its own line (no hover to read a cut one). */}
                  <span className="min-w-0 basis-full break-words font-medium text-white sm:basis-auto sm:flex-1 sm:truncate" title={p.name}>
                    {p.name}
                  </span>
                  <span className="text-xs text-slate-400">{p.groups.join("/") || "—"}</span>
                  <Tag tone={p.status === "MINORS" || p.status === "INJURED_RESERVE" ? "slate" : "cyan"}>{STATUS_SHORT[p.status] ?? p.status}</Tag>
                  <span className="ml-auto w-16 text-right tabular-nums text-cyan-100 sm:ml-0" title="Valeur dynastie et rang">
                    {p.dyn === null ? "—" : fmtInt(p.dyn)}
                    {p.rank ? <span className="block text-xs text-slate-400">{rankLabel(p.rank)}</span> : null}
                  </span>
                  <span className="w-20 text-right tabular-nums text-slate-200" title="Salaire cette saison / la suivante (M$)">
                    {p.cap.map((m, t) => (
                      <span key={t} className={t >= p.signed ? "italic text-slate-400" : undefined}>
                        {t > 0 ? " / " : ""}
                        {salaryCell(m)}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">Aucun joueur pour l’instant.</p>
          )}
        </LeagueCard>

        <LeagueCard
          id="meilleurs-par-position"
          icon={<ListChecks className="h-5 w-5" />}
          title="Meilleurs disponibles par position"
          accentClass="text-emerald-300"
          description={`Par valeur dynastie, mode ${DYNASTY_MODE_LABEL[mode]} (salaire ${capSeasonLabel(config.salaryCap?.firstSeason ?? 2026)} en M$, fin de contrat).`}
        >
          <div className="space-y-2">
            {view.best.map((b) => (
              <div key={b.group}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{b.group}</h3>
                <ol className="mt-0.5 space-y-0.5 text-sm">
                  {b.rows.map((r) => {
                    const v = rowDynastyValue(r, mode);
                    const c = r.dynasty?.contract;
                    return (
                      <li key={r.id} className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 break-words text-slate-100 sm:truncate" title={r.name}>
                          {r.name}
                          {r.src === "e" ? <span className="ml-1 text-xs text-violet-300">Espoir</span> : null}
                        </span>
                        <span className="tabular-nums text-cyan-100">{v === null ? "—" : fmtInt(v)}</span>
                        <span className="w-12 text-right tabular-nums text-slate-300">{salaryCell(rowSalary(r, 0))}</span>
                        <span className="hidden w-24 text-right text-xs text-slate-400 sm:inline">
                          {c ? contractEndLabel(c, config.salaryCap?.firstSeason ?? 2026) : "—"}
                        </span>
                      </li>
                    );
                  })}
                  {b.rows.length === 0 ? <li className="text-slate-400">Personne</li> : null}
                </ol>
              </div>
            ))}
          </div>
        </LeagueCard>
      </div>
    </div>
  );
}
