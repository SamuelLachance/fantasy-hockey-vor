"use client";

import { BookOpen, Coins, FileSignature } from "lucide-react";
import { useEffect, useState } from "react";
import { salarySchedule, type LeagueContractRules } from "@/lib/dynasty/league-contracts";
import type { CapPlanFile, CapPlanRow } from "@/lib/dynasty/slapshot-client";
import { fantraxPublicFile } from "@/lib/fantrax/config";
import { fmtMoney } from "@/lib/fantrax/money";
import { capSeasonLabel } from "@/lib/fantrax/salary-copy";
import { fetchSnapshotFile } from "@/lib/fantrax/snapshot-fetch";
import { PlayerCardLink } from "@/components/player-card/PlayerCardLink";
import { useFantraxLeague } from "./fantrax-league-context";
import { LeagueCard, Tag } from "./LeagueCard";

type Horizon = "W" | "B" | "L";
const HORIZON_FR: Record<Horizon, string> = { W: "Gagner maintenant", B: "Équilibré", L: "Long terme" };
const STATUS_FR: Record<string, string> = { ACTIVE: "Actif", RESERVE: "Réserve", MINORS: "Mineures", INJURED_RESERVE: "Blessé (IR)" };
/** Seasons the tab shows (a 7-year contract signed now). */
const SHOWN = 7;
const NBSP = " ";

const fmt1 = (x: number) => x.toFixed(1).replace(".", ",");
const ans = (n: number) => `${n}${NBSP}an${n > 1 ? "s" : ""}`;

function storageKey(slug: string, team: string) {
  return `contrats-ligue:${slug}:${team}`;
}
function readChoices(key: string): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}
function writeChoices(key: string, v: Record<string, number>) {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // private window or blocked storage: the choices live for this visit only
  }
}

/** A length's contract as the tab shows it: salaries, extension, surplus. */
interface Choice {
  years: number;
  ext: number;
  start: number;
  base: number;
  salary: number[];
  extBase: number | null;
  end: number;
  total: number;
}

function choiceOf(p: CapPlanRow, f: CapPlanFile, h: Horizon, years: number, rules: LeagueContractRules): Choice {
  const [total, ext] = p.by[h][years - 1] ?? [0, 0];
  const sch = salarySchedule(p.s, p.b, years, ext, p.n, f.min, p.n.length, rules);
  return { years, ext, start: p.s, base: p.b, ...sch, total };
}

/** The recommended length: the largest simulated surplus (ties to the shorter); a confirmed one stays. */
function recommended(p: CapPlanRow, h: Horizon): number {
  if (p.f) return p.y;
  let best = 1;
  p.by[h].forEach(([t], j) => {
    if (t > (p.by[h][best - 1]?.[0] ?? -Infinity) + 1e-9) best = j + 1;
  });
  return best;
}

const PHASE_FR: Record<string, string> = {
  prospect: "Espoir",
  rising: "En progression",
  entering_prime: "Entre dans son prime",
  prime: "Prime",
  plateau: "Plateau",
  declining: "Déclin",
  late_career: "Fin de carrière",
};

interface Row {
  id: string;
  status: string;
  p: CapPlanRow;
  rec: Choice;
  chosen: Choice;
  years: number;
  /** Surplus given up against the recommendation (league points, ≥ 0). */
  loss: number;
}

/**
 * Slapshot · Plafond: the league's contract rules (1-7 seasons on the NHL cap
 * hit of the signing season, raises on that base, one extension, then free
 * agent) applied to the user's roster. For every player: the recommended
 * length (by discounted surplus, src/lib/dynasty/league-contracts.ts), a
 * length to try, the salaries it commits season by season and what it gives
 * up; for the team: the 23 counted salaries against the 105 M$ cap and the
 * 70 M$ floor. The tries stay in this browser (localStorage).
 */
export function SlapshotCapTab() {
  const { config, teamId, state, live, teamName } = useFantraxLeague();
  const [file, setFile] = useState<CapPlanFile | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [horizon, setHorizon] = useState<Horizon>("B");
  const key = storageKey(config.slug, teamId);
  // the tries of the team shown (re-read when the team changes)
  const [store, setStore] = useState<{ key: string; v: Record<string, number> } | null>(null);
  const choices = store && store.key === key ? store.v : readChoices(key);
  const setChoices = (v: Record<string, number>) => setStore({ key, v });

  useEffect(() => {
    let cancelled = false;
    fetchSnapshotFile<CapPlanFile>(fantraxPublicFile(config, "cap-plan.json")).then(
      (f) => {
        if (cancelled) return;
        setFile(f);
        setLoadState("ready");
      },
      () => {
        if (!cancelled) setLoadState("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [config]);

  const choose = (id: string, years: number | null) => {
    const next = { ...choices };
    if (years == null) delete next[id];
    else next[id] = years;
    setChoices(next);
    writeChoices(key, next);
  };

  // (the React Compiler memoizes what follows)
  const rules: LeagueContractRules | null = file
    ? { mult: file.rules.mult, maxYears: file.rules.maxYears, extensions: file.rules.extensions, cap: file.cap, floor: file.floor }
    : null;

  const roster = (live?.rosters ?? state?.rosters)?.[teamId] ?? [];
  const rows: Row[] = (() => {
    if (!file || !rules) return [];
    const out: Row[] = [];
    for (const e of roster) {
      const p = file.players[e.id];
      if (!p) continue;
      const rec = choiceOf(p, file, horizon, recommended(p, horizon), rules);
      const years = p.f ? p.y : (choices[e.id] ?? rec.years);
      const chosen = years === rec.years ? rec : choiceOf(p, file, horizon, years, rules);
      out.push({ id: e.id, status: e.status, p, rec, chosen, years, loss: Math.max(0, rec.total - chosen.total) });
    }
    return out.sort((a, b) => b.p.dv.B - a.p.dv.B);
  })();

  const missing = roster.filter((e) => !file?.players[e.id]).length;

  // ---- the team's counted salaries per season (the 23 best counted today)
  const team = (() => {
    if (!file || !config.salaryCap) return null;
    const spots = config.salaryCap.countedSpots;
    const now = new Set(config.salaryCap.countedStatuses);
    // this season: Active + Reserve (IR and minors are free); from next season
    // the injured are back, so the best 23 of Active + Reserve + IR count
    const countedAt = (t: number) =>
      rows.filter((r) => now.has(r.status) || (t > 0 && r.status === "INJURED_RESERVE")).slice(0, spots);
    const used = Array.from({ length: SHOWN }, (_, t) => countedAt(t).reduce((s, r) => s + (r.chosen.salary[t] ?? 0), 0));
    const confirmed = Array.from({ length: SHOWN }, (_, t) =>
      countedAt(t)
        .filter((r) => r.p.f)
        .reduce((s, r) => s + (r.chosen.salary[t] ?? 0), 0),
    );
    const outNow = rows.filter((r) => !now.has(r.status));
    return { counted: countedAt(0).length, used, confirmed, outNow };
  })();

  if (!config.salaryCap) return null;
  if (loadState === "error") {
    return <p className="text-sm text-rose-200">Le plan des contrats n’a pas pu être lu. Actualisez la page pour réessayer.</p>;
  }
  if (!file || !state) return <p className="text-sm text-slate-400">Chargement du plan des contrats…</p>;

  const y0 = file.firstSeason;
  const seasons = Array.from({ length: SHOWN }, (_, t) => y0 + t);
  const changed = rows.filter((r) => !r.p.f && choices[r.id] != null && choices[r.id] !== r.rec.years).length;

  return (
    <div className="grid gap-6">
      <LeagueCard
        id="plafond-saisons"
        icon={<Coins className="h-5 w-5" />}
        title={`Masse salariale de ${teamName(teamId)} par saison`}
        accentClass="text-amber-300"
        description={`Plafond ${fmtMoney(file.cap)} et plancher ${fmtMoney(file.floor)} chaque saison, sur les ${config.salaryCap.countedSpots} joueurs Actifs + Réserve (mineures et IR ne comptent pas). Salaires selon les durées choisies ci-dessous (ou conseillées).`}
      >
        {team ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">Plafond, plancher, salaires engagés et marge par saison</caption>
              <thead>
                <tr className="text-xs text-slate-400">
                  <th scope="col" className="py-1 text-left font-medium">
                    Saison
                  </th>
                  <th scope="col" className="py-1 text-right font-medium" title="Contrats de ligue confirmés">
                    Confirmé
                  </th>
                  <th scope="col" className="py-1 text-right font-medium" title="Confirmés + durées choisies ou conseillées">
                    Engagé
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Marge sous le plafond
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Au-dessus du plancher
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {seasons.map((y, t) => {
                  const used = team.used[t]!;
                  const room = file.cap - used;
                  const overFloor = used - file.floor;
                  return (
                    <tr key={y} className="border-t border-white/5">
                      <th scope="row" className="py-1 text-left font-normal text-slate-300">
                        {capSeasonLabel(y)}
                      </th>
                      <td className="py-1 text-right text-slate-300">{fmtMoney(team.confirmed[t]!)}</td>
                      <td className="py-1 text-right text-slate-200">{fmtMoney(used)}</td>
                      <td className={`py-1 text-right font-semibold ${room < 0 ? "text-rose-200" : "text-emerald-200"}`}>{fmtMoney(room)}</td>
                      <td className={`py-1 text-right ${overFloor < 0 && t === 0 ? "font-semibold text-rose-200" : "text-slate-300"}`}>
                        {fmtMoney(overFloor)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="mt-2 text-xs text-slate-400">
          {team?.counted ?? 0} joueurs comptés aujourd’hui (Actifs + Réserve). À partir de la saison prochaine, les blessés (IR) reviennent et comptent
          aussi : les {config.salaryCap.countedSpots} meilleurs des Actifs, Réserve et IR. Un joueur dont le contrat (et sa prolongation) finit devient agent
          libre et ne compte plus. Sous le plancher ou au-dessus du plafond, la ligue donne 24 h pour se conformer, sinon défaite
          automatique.
          {team?.outNow.length
            ? ` Hors plafond cette saison : ${[
                team.outNow.filter((r) => r.status === "INJURED_RESERVE").length
                  ? `blessés ${team.outNow
                      .filter((r) => r.status === "INJURED_RESERVE")
                      .map((r) => r.p.nm)
                      .join(", ")} (comptés dès la saison prochaine)`
                  : "",
                team.outNow.filter((r) => r.status === "MINORS").length
                  ? `${team.outNow.filter((r) => r.status === "MINORS").length} joueurs aux mineures`
                  : "",
              ]
                .filter(Boolean)
                .join("; ")}.`
            : ""}
          {missing ? ` ${missing} joueur${missing > 1 ? "s" : ""} de l’effectif sans données de contrat (non comptés).` : ""}
        </p>
      </LeagueCard>

      <LeagueCard
        id="contrats"
        icon={<FileSignature className="h-5 w-5" />}
        title="Durée de contrat à offrir à chaque joueur"
        accentClass="text-cyan-300"
        description="La durée conseillée maximise le surplus du joueur : ses points au-dessus du remplacement, moins le prix du plafond de son salaire, saison par saison, actualisés selon l’horizon. Changez une durée pour voir ce qu’elle coûte; vos essais restent dans ce navigateur."
        headerExtra={
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400">Horizon</span>
            {(["W", "B", "L"] as Horizon[]).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHorizon(h)}
                aria-pressed={horizon === h}
                className={`rounded-full px-2.5 py-1 ring-1 ${horizon === h ? "bg-cyan-500/20 text-cyan-100 ring-cyan-400/50" : "text-slate-300 ring-white/10 hover:bg-white/5"}`}
              >
                {HORIZON_FR[h]}
              </button>
            ))}
            {changed ? (
              <button
                type="button"
                onClick={() => {
                  setChoices({});
                  writeChoices(key, {});
                }}
                className="rounded-full px-2.5 py-1 text-amber-200 ring-1 ring-amber-400/40 hover:bg-amber-500/10"
              >
                Revenir aux conseils ({changed})
              </button>
            ) : null}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] text-sm">
            <caption className="sr-only">Contrats de ligue : durée conseillée, durée choisie, salaires par saison et surplus</caption>
            <thead>
              <tr className="text-xs text-slate-400">
                <th scope="col" className="py-1 pr-2 text-left font-medium">
                  Joueur
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-medium" title="Valeur dynastie (horizon Équilibré)">
                  Valeur dyn.
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-medium" title="Salaire de base : son vrai salaire LNH de la saison où le contrat commence">
                  Base
                </th>
                <th scope="col" className="py-1 pr-2 text-left font-medium">
                  Durée
                </th>
                {seasons.map((y) => (
                  <th key={y} scope="col" className="py-1 pr-2 text-right font-medium">
                    {capSeasonLabel(y)}
                  </th>
                ))}
                <th scope="col" className="py-1 pr-2 text-left font-medium" title="Prolongation conseillée (une seule permise) et agent libre ensuite">
                  Ensuite
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-medium" title="Surplus actualisé de la durée choisie, en points de ligue">
                  Surplus
                </th>
                <th
                  scope="col"
                  className="py-1 text-right font-medium"
                  title="Points au-dessus du remplacement prévus cette saison par M$ de salaire : plus c’est haut, plus le contrat est avantageux"
                >
                  Pts/M$ {capSeasonLabel(y0)}
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((r) => {
                const startYear = y0 + r.p.s;
                const notYet = r.p.s >= SHOWN;
                const perM = r.p.s === 0 && r.chosen.base > 0 ? Math.max(0, r.p.v0) / r.chosen.base : null;
                const end = y0 + r.chosen.end;
                return (
                  <tr key={r.id} className="border-t border-white/5 align-top">
                    <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                      <span className="block font-medium text-white">
                        <PlayerCardLink fx={r.id} league={config.slug}>
                          {r.p.nm}
                        </PlayerCardLink>
                      </span>
                      <span className="text-xs text-slate-400">
                        {r.p.pos.join("/")} · {Math.floor(r.p.age)} ans · {PHASE_FR[r.p.ph] ?? r.p.ph} · {STATUS_FR[r.status] ?? r.status}
                      </span>
                    </th>
                    <td className="py-1.5 pr-2 text-right text-slate-200">{Math.round(r.p.dv.B)}</td>
                    <td className="py-1.5 pr-2 text-right text-slate-300">{r.p.s > 0 ? "—" : fmtMoney(r.chosen.base)}</td>
                    <td className="py-1.5 pr-2 text-left">
                      {r.p.f ? (
                        <Tag tone="emerald">Confirmé · {ans(r.p.y)}</Tag>
                      ) : notYet ? (
                        <span className="text-xs text-slate-400">à son arrivée</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <label className="sr-only" htmlFor={`duree-${r.id}`}>
                            Durée du contrat de {r.p.nm}
                          </label>
                          <select
                            id={`duree-${r.id}`}
                            value={r.years}
                            onChange={(ev) => {
                              const v = Number(ev.target.value);
                              choose(r.id, v === r.rec.years ? null : v);
                            }}
                            className="rounded-md bg-slate-900 px-1.5 py-0.5 text-sm text-white ring-1 ring-white/15"
                          >
                            {Array.from({ length: file.rules.maxYears }, (_, j) => j + 1).map((n) => (
                              <option key={n} value={n}>
                                {ans(n)}
                                {n === r.rec.years ? " (conseil)" : ""}
                              </option>
                            ))}
                          </select>
                          {r.years !== r.rec.years ? <Tag tone="amber">conseil {ans(r.rec.years)}</Tag> : null}
                          {r.p.s > 0 ? <span className="text-xs text-slate-400">dès {capSeasonLabel(startYear)}</span> : null}
                        </div>
                      )}
                    </td>
                    {seasons.map((y, t) => {
                      const s = r.chosen.salary[t] ?? 0;
                      const inExt = t >= r.chosen.start + r.years && t < r.chosen.end;
                      return (
                        <td
                          key={y}
                          className={`py-1.5 pr-2 text-right ${s === 0 ? "text-slate-400" : inExt ? "text-violet-200" : "text-slate-200"}`}
                          title={inExt ? "Prolongation" : undefined}
                        >
                          {s === 0 ? "—" : fmtMoney(s)}
                        </td>
                      );
                    })}
                    <td className="py-1.5 pr-2 text-left text-xs text-slate-300">
                      {r.chosen.extBase != null && r.chosen.end > r.chosen.start + r.years
                        ? `Prolonger ${ans(r.chosen.end - r.chosen.start - r.years)} à ~${fmtMoney(r.chosen.extBase)}`
                        : "Le laisser partir"}
                      <span className="block text-slate-400">agent libre en {capSeasonLabel(end)}</span>
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      <span className="text-slate-200">{Math.round(r.chosen.total)}</span>
                      {r.loss >= 0.5 ? <span className="block text-xs text-rose-200">−{fmt1(r.loss)} vs conseil</span> : null}
                    </td>
                    <td className="py-1.5 text-right text-slate-300">{perM == null ? "—" : fmt1(perM)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </LeagueCard>

      <LeagueCard id="plafond-methode" icon={<BookOpen className="h-5 w-5" />} title="Règles et méthode" accentClass="text-slate-300">
        <div className="space-y-2 text-sm text-slate-300">
          <p>
            <strong className="text-white">Règles de la ligue.</strong> Chaque joueur reçoit un contrat de 1 à {file.rules.maxYears} ans. Le salaire de
            l’an 1 est son vrai salaire LNH de la saison où le contrat commence; chaque année suivante augmente celle d’avant de 10 % (ans 2-3), 15 % (ans 4-6) et 20 % (an 7), hausses cumulées : sur 7 ans, l’an 7 vaut {fmt1(file.rules.mult[6] ?? 0)} fois la base. Une seule prolongation est permise, aux mêmes règles; à la fin, le joueur devient agent libre, peu importe son âge.
            Plafond {fmtMoney(file.cap)}, plancher {fmtMoney(file.floor)}, sur les {config.salaryCap.countedSpots} Actifs + Réserve.
          </p>
          <p>
            <strong className="text-white">Algorithme.</strong> Chaque durée de 1 à {file.rules.maxYears} ans, puis chaque prolongation possible, est
            évaluée sur les milliers de carrières que le modèle dynastie simule pour le joueur : progression des jeunes, entrée dans le prime, plateau,
            déclin et fin de carrière selon son âge et son profil, rôle, blessures, retraite, arrivée des espoirs. Dans chaque carrière et chaque saison,
            on prend sa valeur (points de ligue au-dessus du remplacement à sa position) moins le prix du plafond de son salaire (λ ={" "}
            {fmt1(file.lambda[0] ?? 0)} point par M$ au-dessus du minimum cette saison, {fmt1(file.lambda[1] ?? 0)} ensuite); une saison où il coûte plus
            qu’il ne rapporte vaut 0 (il va aux mineures, qui ne comptent pas). La moyenne sur les carrières est actualisée selon l’horizon (
            {(["W", "B", "L"] as Horizon[]).map((h) => `${HORIZON_FR[h]} ${file.deltas[h]}`).join(", ")} par saison); la durée conseillée est celle qui
            donne le plus gros surplus. Le risque compte donc : un long contrat pour un joueur qui peut décliner ou se blesser coûte des saisons perdues.
          </p>
          <p>
            <strong className="text-white">Ce que ça donne.</strong> Les hausses étant cumulées, l’an 5 coûte 1,6 fois la base et l’an 7, 2,2 fois. Un
            espoir ou un jeune sur contrat d’entrée se signe souvent au plus long (même doublé, un salaire d’entrée reste minime). Un joueur payé au prix
            du marché se signe plutôt 3 à 5 ans puis se prolonge : la prolongation repart de son salaire LNH du moment. Déclin et fin de carrière : 1 à 2
            ans.
          </p>
          <p className="text-xs text-slate-400">
            Hypothèses à confirmer : la prolongation repart du salaire LNH de la saison où elle commence; un espoir sans contrat LNH ne signe son contrat de
            ligue qu’à son arrivée (il reste aux mineures, sans salaire, d’ici là); le plafond et le plancher restent fixes; le prix du plafond λ est celui
            d’une équipe moyenne de la ligue.
          </p>
        </div>
      </LeagueCard>
    </div>
  );
}
