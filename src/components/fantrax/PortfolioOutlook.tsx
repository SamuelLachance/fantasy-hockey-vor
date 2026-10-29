"use client";

import { ChartNoAxesCombined, RefreshCw, Shield, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PlayerCardLink } from "@/components/player-card/PlayerCardLink";
import { fantraxPublicFile } from "@/lib/fantrax/config";
import { DYNASTY_MODE_LABEL } from "@/lib/fantrax/dynasty-mode";
import { buildPortfolioOutlook, parsePortfolioSnapshot, type PortfolioSnapshot, type PortfolioSeason } from "@/lib/fantrax/portfolio";
import { fetchSnapshotFile } from "@/lib/fantrax/snapshot-fetch";
import { DynastyModeSwitch } from "./DynastyModeSwitch";
import { useFantraxLeague } from "./fantrax-league-context";
import { LeagueCard } from "./LeagueCard";

const number = (n: number) => n.toLocaleString("fr-CA", { maximumFractionDigits: 0 });
const percent = (n: number | null) => n === null ? "—" : `${Math.round(n * 100)} %`;
const GROUP = { F: "Attaquants", D: "Défenseurs", G: "Gardiens" };
const GROUP_COLOR = { F: "bg-cyan-400", D: "bg-amber-400", G: "bg-violet-400" };
const sourceDate = (iso: string) => new Intl.DateTimeFormat("fr-CA", { dateStyle: "medium", timeZone: "America/Toronto" }).format(new Date(iso));

type Resource = { key: string; snapshot: PortfolioSnapshot | null; failed: boolean };

/** Native SVG: the seasonal buttons and data table provide the keyboard/AT interface. */
function PortfolioChart({ seasons, selected }: { seasons: PortfolioSeason[]; selected: number }) {
  const width = 720;
  const height = 228;
  const left = 48;
  const right = 16;
  const top = 18;
  const bottom = 28;
  const values = seasons.flatMap((s) => [s.gain, ...(s.median === null ? [] : [s.median])]);
  const low = Math.min(0, ...values);
  const high = Math.max(1, ...values);
  const span = high - low;
  const x = (i: number) => left + i * (width - left - right) / Math.max(1, seasons.length - 1);
  const y = (v: number) => top + (high - v) * (height - top - bottom) / span;
  const path = (key: "gain" | "median") => seasons.map((s, i) => `${i ? "L" : "M"}${x(i)},${y(s[key] ?? 0)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible" role="img" aria-labelledby="portfolio-courbe-titre portfolio-courbe-description">
      <title id="portfolio-courbe-titre">Gains attendus de votre effectif actuel par saison</title>
      <desc id="portfolio-courbe-description">La ligne cyan représente votre équipe et la ligne ambre en tirets la médiane des équipes entièrement couvertes. Les chiffres complets se trouvent dans le tableau sous le graphique.</desc>
      {[0, 1, 2, 3].map((tick) => {
        const value = low + span * tick / 3;
        return <g key={tick}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="currentColor" className="text-white/10" /><text x={left - 8} y={y(value) + 4} textAnchor="end" className="fill-slate-400 text-[10px]">{number(value)}</text></g>;
      })}
      <line x1={x(selected)} x2={x(selected)} y1={top} y2={height - bottom} stroke="currentColor" className="text-cyan-300/30" strokeDasharray="3 5" />
      {seasons.every((s) => s.median !== null) ? <path d={path("median")} fill="none" stroke="#fbbf24" strokeWidth="2" strokeDasharray="6 6" /> : null}
      <path d={path("gain")} fill="none" stroke="#22d3ee" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      {seasons.map((s, i) => <g key={s.season}><circle cx={x(i)} cy={y(s.gain)} r={i === selected ? 5 : 3} fill={i === selected ? "#ecfeff" : "#22d3ee"} /><text x={x(i)} y={height - 6} textAnchor="middle" className="fill-slate-400 text-[10px]">{s.label}</text></g>)}
    </svg>
  );
}

/** A reusable, league-scoped long-term view for the team's current players. */
export function PortfolioOutlook() {
  const { config, state, teamId, teams, mode, hasDynasty, nowMs, bundleState, refresh } = useFantraxLeague();
  const [attempt, setAttempt] = useState(0);
  const [resource, setResource] = useState<Resource | null>(null);
  const [selectedSeason, setSelectedSeason] = useState(0);
  const [range, setRange] = useState(6);
  const requestKey = `${config.slug}:${attempt}`;
  useEffect(() => {
    if (!hasDynasty) return;
    let cancelled = false;
    fetchSnapshotFile<unknown>(fantraxPublicFile(config, "dynasty-table.json")).then((raw) => {
      if (cancelled) return;
      const snapshot = parsePortfolioSnapshot(raw);
      setResource({ key: requestKey, snapshot, failed: !snapshot });
    }, () => {
      if (!cancelled) setResource({ key: requestKey, snapshot: null, failed: true });
    });
    return () => { cancelled = true; };
  }, [config, hasDynasty, requestKey]);
  const settled = resource?.key === requestKey;
  const snapshot = settled ? resource.snapshot : null;
  const model = useMemo(() => {
    if (!snapshot || !state) return null;
    return buildPortfolioOutlook({ snapshot, rosters: Object.fromEntries(Object.entries(state.rosters).map(([id, roster]) => [id, roster.map((p) => p.id)])), teamId, teamIds: teams.map((t) => t.id), mode });
  }, [snapshot, state, teamId, teams, mode]);
  if (!hasDynasty) return null;

  const retry = () => { setAttempt((n) => n + 1); if (bundleState === "error") refresh(); };
  const frame = (children: ReactNode) => <LeagueCard id="portefeuille" title="Votre fenêtre de compétition" icon={<ChartNoAxesCombined className="h-5 w-5" />} description="Suivez la valeur de votre effectif dans le temps et préparez la relève avant d'en avoir besoin.">{children}</LeagueCard>;
  if ((settled && resource.failed) || bundleState === "error") return frame(
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-500/5 p-4 text-sm text-amber-100">
      <p>Le portrait à long terme est indisponible. Vos autres outils restent accessibles.</p>
      <button type="button" onClick={retry} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-amber-400/30 px-3 font-semibold hover:bg-amber-500/10 focus-visible:ring-2 focus-visible:ring-amber-300"><RefreshCw className="h-4 w-4" aria-hidden="true" />Réessayer</button>
    </div>,
  );
  if (!snapshot || !state) return frame(<p role="status" className="py-6 text-sm text-slate-400">Chargement du portrait de votre effectif…</p>);
  if (!model) return frame(<p className="text-sm text-slate-400">L’effectif de cette équipe n’est pas disponible dans les données actuelles.</p>);
  if (!model.coverage.total) return frame(<p className="text-sm text-slate-400">Aucun joueur dans l’effectif consulté. Le portrait se remplira avec vos acquisitions.</p>);

  const shown = model.seasons.slice(0, range);
  const selected = Math.min(selectedSeason, shown.length - 1);
  const season = shown[selected]!;
  const first = model.seasons[0]!;
  const last = model.seasons[model.seasons.length - 1]!;
  const stale = nowMs !== null && nowMs - Date.parse(snapshot.builtAt) > 7 * 86400_000;
  const partial = model.coverage.missing.length > 0;
  const gap = season.median === null ? null : season.gain - season.median;
  return frame(
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <DynastyModeSwitch idPrefix="portfolio" />
        <p className={`max-w-sm text-xs ${stale ? "text-amber-200" : "text-slate-400"}`}>
          Valeurs du <time dateTime={snapshot.builtAt}>{sourceDate(snapshot.builtAt)}</time>.<br />
          {stale ? "Réévaluez les nouvelles blessures et transactions avant de conclure un échange." : "Effectif consulté appliqué aux dernières valeurs publiées."}
        </p>
      </div>
      {partial ? <p role="status" className="rounded-xl border border-amber-400/25 bg-amber-500/5 px-4 py-3 text-sm text-amber-100"><TriangleAlert className="mr-2 inline h-4 w-4" aria-hidden="true" />Portrait partiel : {model.coverage.missing.length} joueur{model.coverage.missing.length > 1 ? "s" : ""} sans valeur publiée. Les totaux connus ne sont pas un total complet; aucun rang n’est attribué.</p> : null}
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4"><dt className="text-xs text-slate-400">Valeur {DYNASTY_MODE_LABEL[mode].toLowerCase()}{partial ? " · partielle" : ""}</dt><dd className="mt-2 text-3xl font-semibold tabular-nums text-cyan-100">{number(model.total)}<span className="ml-2 text-xs font-normal text-slate-400">pts de dynastie</span></dd></div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4"><dt className="text-xs text-slate-400">Part des trois principaux actifs</dt><dd className="mt-2 text-3xl font-semibold tabular-nums text-white">{percent(model.topThreeShare)}</dd><dd className="mt-1 text-xs text-slate-400">de la valeur positive selon cet horizon</dd></div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4"><dt className="text-xs text-slate-400">Gains dans les deux premières saisons</dt><dd className="mt-2 text-3xl font-semibold tabular-nums text-white">{percent(model.nearShare)}</dd><dd className="mt-1 text-xs text-slate-400">des gains positifs sur {model.seasons.length} saisons</dd></div>
      </dl>
      <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="text-sm font-semibold text-white">Trajectoire de l’effectif actuel</h3><p className="mt-1 text-xs text-slate-400">Gains attendus par saison, sans pondération d’horizon.</p></div>
          {model.seasons.length > 6 ? <fieldset className="flex gap-1 rounded-lg border border-white/10 p-1"><legend className="sr-only">Saisons affichées</legend>{[6, model.seasons.length].map((n) => <label key={n} className={`flex min-h-11 cursor-pointer items-center rounded-md px-3 text-xs focus-within:ring-2 focus-within:ring-cyan-300 ${range === n ? "bg-cyan-400/15 text-cyan-100" : "text-slate-400"}`}><input type="radio" name="portfolio-range" checked={range === n} onChange={() => setRange(n)} className="sr-only" />{n} saisons</label>)}</fieldset> : null}
        </div>
        <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-400"><span className="inline-flex items-center gap-2"><span className="h-0.5 w-6 bg-cyan-400" aria-hidden="true" />Votre effectif</span><span className="inline-flex items-center gap-2"><span className="w-6 border-t-2 border-dashed border-amber-400" aria-hidden="true" />Médiane · {model.comparisonTeams}/{model.teamCount} équipes couvertes</span></div>
        <PortfolioChart seasons={shown} selected={selected} />
        <fieldset className="mt-3"><legend className="sr-only">Saison à examiner</legend><div className="flex flex-wrap gap-1">{shown.map((s, i) => <label key={s.season} className={`flex min-h-11 cursor-pointer items-center rounded-lg border px-2.5 text-xs tabular-nums focus-within:ring-2 focus-within:ring-cyan-300 ${i === selected ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100" : "border-transparent text-slate-400 hover:text-white"}`}><input type="radio" name="portfolio-season" checked={i === selected} onChange={() => setSelectedSeason(i)} className="sr-only" />{s.label}</label>)}</div></fieldset>
        <p aria-live="polite" className="mt-3 border-t border-white/10 pt-3 text-sm text-slate-300"><strong className="text-white">{season.label}</strong> : {number(season.gain)} points de gains attendus{gap === null ? "; médiane indisponible" : ` · ${gap >= 0 ? "+" : ""}${number(gap)} face à la médiane`}{season.rank === null ? "." : ` · rang ${season.rank}/${model.comparisonTeams}.`}</p>
        <details className="mt-2 text-xs text-slate-400"><summary className="flex min-h-11 cursor-pointer items-center font-medium text-slate-300 underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-cyan-300">Consulter tous les chiffres</summary><div className="overflow-x-auto"><table className="w-full text-left tabular-nums"><caption className="sr-only">Gains attendus en points de dynastie par saison, médiane et rang de l’équipe consultée</caption><thead><tr className="border-b border-white/10 text-slate-300"><th scope="col" className="py-2">Saison</th><th scope="col" className="px-3 py-2">Effectif{partial ? " (partiel)" : ""}</th><th scope="col" className="px-3 py-2">Médiane</th><th scope="col" className="py-2">Rang</th></tr></thead><tbody>{model.seasons.map((s) => <tr key={s.season} className="border-b border-white/5"><th scope="row" className="py-2 font-normal">{s.label}</th><td className="px-3 py-2 text-cyan-100">{number(s.gain)}</td><td className="px-3 py-2">{s.median === null ? "—" : number(s.median)}</td><td className="py-2">{s.rank === null ? "—" : `${s.rank}/${model.comparisonTeams}`}</td></tr>)}</tbody></table></div></details>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 p-4"><h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Shield className="h-4 w-4 text-cyan-300" aria-hidden="true" />Noyau durable</h3><p className="mt-1 text-xs text-slate-400">Principales contributions attendues de {model.seasons[2]?.label ?? first.label} à {last.label}, avant pondération d’horizon.</p>{model.core.length ? <ol className="mt-3 divide-y divide-white/5">{model.core.map((p) => <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm"><PlayerCardLink fx={p.id} league={config.slug}>{p.name}</PlayerCardLink><span className="shrink-0 tabular-nums text-cyan-200">{number(p.laterGain)} <span className="text-xs text-slate-400">pts</span></span></li>)}</ol> : <p className="mt-3 text-sm text-slate-400">Aucune contribution positive publiée au-delà des deux premières saisons.</p>}</div>
        <div className="rounded-xl border border-white/10 p-4"><h3 className="text-sm font-semibold text-white">Répartition et points de vigilance</h3><div className="mt-4 flex h-2 overflow-hidden rounded-full bg-white/5" aria-hidden="true">{model.groups.map((g) => <span key={g.group} className={GROUP_COLOR[g.group]} style={{ width: `${g.share * 100}%` }} />)}</div><ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">{model.groups.map((g) => <li key={g.group} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${GROUP_COLOR[g.group]}`} aria-hidden="true" />{GROUP[g.group]} : {percent(g.share)}</li>)}</ul><ul className="mt-4 space-y-3 text-sm leading-relaxed text-slate-300">{model.topThreeShare !== null && model.topThreeShare >= 0.5 ? <li>Les trois principaux actifs portent {percent(model.topThreeShare)} de la valeur connue : mesurez l’effet d’un départ avant de les échanger.</li> : <li>Vérifiez la relève par position avant de céder une pièce importante de votre effectif.</li>}{first.gain > 0 && last.gain < first.gain ? <li>Le gain attendu passe de {number(first.gain)} en {first.label} à {number(last.gain)} en {last.label}. Préparez le renouvellement avec les outils Actifs et Échanges.</li> : <li>La courbe décrit les joueurs détenus aujourd’hui; les futurs choix, ajouts et échanges peuvent la modifier.</li>}</ul></div>
      </div>
      <p className="text-xs leading-relaxed text-slate-400">{model.coverage.known}/{model.coverage.total} joueurs couverts{model.coverage.zero ? `, dont ${model.coverage.zero} à valeur nulle publiée` : ""}. Les courbes additionnent les gains attendus du modèle de cette ligue, avec ses règles de protection ou de salaire. Ce ne sont ni des points de classement ni une probabilité de championnat. Les choix futurs et acquisitions sont exclus; la médiane ne comprend que les effectifs entièrement couverts. L’horizon modifie la valeur des actifs, pas les gains bruts du graphique.</p>
    </div>,
  );
}
