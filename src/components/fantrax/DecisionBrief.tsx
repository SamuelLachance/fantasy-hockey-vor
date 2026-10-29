"use client";

import Link from "next/link";
import { ArrowDown, ArrowUpRight, CalendarClock, Crosshair, Database, ShieldCheck } from "lucide-react";
import { useTabSearch } from "@/components/league-shell/tab-search";
import { decisionBrief, type BriefSource } from "@/lib/fantrax/decision-brief";
import type { DailyPlan } from "@/lib/fantrax/daily-plan";
import { fmtAgo, fmtCalendarDay, fmtCountdown, fmtDateTime, fmtNum, fmtTime, fmtZone } from "@/lib/fantrax/league-copy";
import { leagueTabPath } from "@/lib/leagues/routes";
import { useFantraxLeague } from "./fantrax-league-context";

const SOURCE_LABEL: Record<BriefSource["id"], string> = {
  rosters: "Effectifs",
  injuries: "Blessures et statuts",
  waivers: "Ballottage et réclamations",
  caps: "Compteurs de matchs",
  projections: "Projections",
  schedule: "Calendrier LNH",
};
const STATUS = {
  fresh: { text: "Lecture récente", cls: "text-emerald-300", dot: "bg-emerald-400" },
  stale: { text: "À actualiser", cls: "text-amber-200", dot: "bg-amber-400" },
  unknown: { text: "À vérifier", cls: "text-slate-300", dot: "bg-slate-500" },
};

function SourceLine({ source }: { source: BriefSource }) {
  const s = STATUS[source.status];
  const age = source.ageMs !== null ? fmtAgo(0, source.ageMs) : null;
  return (
    <li className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-white/5 py-2.5 last:border-0">
      <span className="inline-flex items-center gap-2 text-sm text-slate-200">
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
        {SOURCE_LABEL[source.id]}
      </span>
      <span className={`text-xs ${s.cls}`}>
        {source.availability === "not-published" ? "Non publié pour cette ligue" : !source.available ? "Lecture indisponible" : source.live && source.status === "fresh" ? "Effectif lu en direct" : s.text}
        {source.available && source.at ? <time dateTime={source.at} title={fmtDateTime(source.at)}>{age ? ` · ${age}` : " · date disponible"}</time> : null}
      </span>
    </li>
  );
}

/** An operational briefing, grounded in the same plan as the detailed cards. */
export function DecisionBrief({ plan }: { plan: DailyPlan }) {
  const { config, bundle, live, nowMs, refresh, busy } = useFantraxLeague();
  const search = useTabSearch();
  const brief = decisionBrief({ plan, config, bundle, live, nowMs });
  const lock = brief.nextLock;
  const sourcesNeedWork = brief.stale + brief.unknown;
  const metrics = [
    { label: "Points projetés", value: brief.lineupPoints === null ? "—" : fmtNum(brief.lineupPoints, 1), detail: "Alignement du prochain jour de jeu" },
    { label: "Mouvements proposés", value: brief.moves === null ? "—" : String(brief.moves), detail: "À effectuer dans Fantrax" },
    { label: "Postes avec un match", value: brief.targetCurrent ? `${brief.playing} / ${brief.seats}` : "—", detail: brief.targetCurrent ? `${brief.occupied} postes occupés · départs non garantis` : "Aucune période actuelle calculée" },
    { label: "Prochain verrouillage", value: lock ? fmtTime(lock) : "—", detail: lock && nowMs !== null ? `${fmtCountdown(Date.parse(lock), nowMs)} · ${fmtZone(lock)}` : "Aucun verrou à venir dans le plan" },
  ];
  return (
    <section id="bureau-du-dg" aria-labelledby="bureau-du-dg-titre" className="relative isolate overflow-hidden rounded-3xl border border-cyan-400/20 bg-slate-950 p-5 shadow-xl shadow-black/10 sm:p-7">
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-40 -z-10 h-96 w-96 rounded-full bg-cyan-400/[0.07] blur-3xl" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300"><Crosshair className="h-3.5 w-3.5" aria-hidden="true" /> Bureau du DG</p>
          <h2 id="bureau-du-dg-titre" className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Votre plan de match.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            {brief.targetCurrent && plan.target ? `${fmtCalendarDay(plan.target.date)} · ${plan.teamName}. Les priorités avant de modifier votre équipe.` : "Le scénario de la dernière synchronisation est disponible. La période et les sources doivent être vérifiées pour décider aujourd’hui."}
          </p>
        </div>
        <a href="#fiabilite" className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-xs font-medium ${sourcesNeedWork ? "border-amber-400/25 bg-amber-400/5 text-amber-200" : "border-emerald-400/25 bg-emerald-400/5 text-emerald-200"}`}>
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          {sourcesNeedWork ? `${sourcesNeedWork} source${sourcesNeedWork > 1 ? "s" : ""} à vérifier` : "Sources récentes"}
          <ArrowDown className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="min-w-0 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-4">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{m.label}</dt>
            <dd className="mt-2 text-3xl font-semibold tracking-tight text-white tabular-nums sm:text-4xl">{m.value}</dd>
            <dd className="mt-2 text-xs leading-relaxed text-slate-400">{m.detail}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><CalendarClock className="h-4 w-4 text-cyan-300" aria-hidden="true" /> Dans l’ordre des priorités</h3>
          {brief.actions.length ? (
            <ol className="grid gap-2">
              {brief.actions.slice(0, 5).map((action, i) => {
                const href = action.tab ? `${leagueTabPath(config.slug, action.tab, search)}${action.hash ? `#${action.hash}` : ""}` : `#${action.hash}`;
                const cls = action.tone === "rose" ? "border-rose-400/20 bg-rose-400/5 text-rose-200" : action.tone === "amber" ? "border-amber-400/15 bg-amber-400/[0.03] text-amber-200" : "border-white/10 bg-white/[0.02] text-cyan-200";
                return (
                  <li key={action.id} className={`rounded-xl border ${cls}`}>
                    <Link href={href} prefetch={false} className="group flex min-h-11 items-start gap-3 rounded-xl p-3 focus-visible:ring-2 focus-visible:ring-cyan-400">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current/20 text-[10px] font-semibold">{i + 1}</span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-white group-hover:text-cyan-100">{action.title}</span><span className="mt-1 block text-xs leading-relaxed text-slate-400">{action.detail}</span></span>
                      <ArrowUpRight className="mt-1 h-3.5 w-3.5 shrink-0 opacity-60 group-hover:opacity-100" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ol>
          ) : <p className="rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-4 text-sm text-emerald-200">Aucune priorité détectée dans le plan actuel. Confirmez les nouvelles et les partants avant le verrouillage.</p>}
          {brief.actions.length > 5 ? <p className="mt-2 text-xs text-slate-400">Les autres points sont détaillés dans les sections ci-dessous.</p> : null}
          <Link href={`${leagueTabPath(config.slug, "mon-equipe", search)}#carnet`} prefetch={false} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg text-xs font-medium text-cyan-300 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-400">Consigner une décision dans mon carnet <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
        </div>
        <div id="fiabilite" className="min-w-0 scroll-mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Database className="h-4 w-4 text-cyan-300" aria-hidden="true" /> Ce que sait le modèle</h3>
          <ul className="mt-2">{brief.sources.map((source) => <SourceLine key={source.id} source={source} />)}</ul>
          <div className="mt-4 border-t border-white/10 pt-3">
            <p className="text-xs font-medium text-slate-200">Couverture de votre effectif</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{brief.coverage.projected} avec projection · {brief.coverage.prior} avec valeur de repli · {brief.coverage.unknown} sans valeur connue.</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">« Récent » décrit la date de lecture, pas une garantie d’exactitude. Seuils : effectifs 15 min, statuts et compteurs 24 h, calendrier 48 h, projections 14 j.</p>
            {plan.waivers.claimsLeft === null ? <p className="mt-2 text-xs leading-relaxed text-slate-400">Réclamations restantes inconnues : vérifiez la limite et l’utilisation dans Fantrax.</p> : null}
          </div>
          <button type="button" onClick={refresh} aria-busy={busy} className="mt-3 inline-flex min-h-11 items-center rounded-lg text-xs font-semibold text-cyan-300 underline-offset-4 hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-cyan-400">{busy ? "Lecture des effectifs…" : "Relire les effectifs Fantrax"}</button>
          <p className="text-[11px] leading-relaxed text-slate-400">Les autres sources dépendent de la synchronisation du site.</p>
        </div>
      </div>
    </section>
  );
}
