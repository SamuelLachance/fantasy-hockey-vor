"use client";

import { explainFr } from "@/lib/dynasty/explain";
import { NBSP } from "@/lib/dynasty/keeper-view";
import { freeStashFr } from "@/lib/dynasty/roster-hint";
import type { DynastyRecord } from "@/lib/dynasty/types";
import { bandOf, keeperOutlook, phaseLabel } from "@/lib/fantrax/dynasty-hints";
import type { DynastyHintText } from "@/lib/fantrax/dynasty-hint-text";
import { DYNASTY_MODE_LABEL, DYNASTY_MODES, type DynastyMode } from "@/lib/fantrax/dynasty-mode";
import { fmtNum, pickLabel } from "@/lib/fantrax/league-copy";
import { pctCell, seasonLabel, trendCell } from "@/lib/fantrax/table-copy";
import { fmtInt } from "@/lib/player-table/copy";

const FIRST_SEASON = 2026;
/** Seasons the chart shows (2026-27 … 2031-32). */
const SPARK_SEASONS = 6;

const rankLabel = (n: number) => (n === 1 ? "1er" : `${n}e`);
/** The model's clause list as a sentence (a cut one keeps its ellipsis). */
const sentence = (s: string) => (s.endsWith("…") ? s : `${s}.`);

/**
 * Expected gain per season (eG) for the next six seasons: one series of
 * columns (4px rounded caps, square on a hairline baseline), every value
 * printed above its bar (a phone has no hover), and the same values in the
 * list read by screen readers.
 */
export function SeasonGains({ eG, idPrefix }: { eG: readonly number[]; idPrefix: string }) {
  const vals = eG.slice(0, SPARK_SEASONS).map((x) => Math.max(0, x));
  const max = Math.max(...vals, 0);
  const slot = 34;
  const bar = 18;
  const top = 14;
  const plot = 46;
  const width = slot * vals.length;
  const captionId = `${idPrefix}-gains`;
  return (
    <figure className="min-w-0" aria-labelledby={captionId}>
      <figcaption id={captionId} className="text-xs text-slate-400">
        Gain attendu par saison (points au-dessus du remplacement)
      </figcaption>
      <svg
        width={width}
        height={top + plot + 16}
        viewBox={`0 0 ${width} ${top + plot + 16}`}
        aria-hidden="true"
        className="mt-1 block max-w-full overflow-visible"
      >
        <line x1={0} x2={width} y1={top + plot + 0.5} y2={top + plot + 0.5} className="stroke-slate-700" strokeWidth={1} />
        {vals.map((v, i) => {
          const h = max > 0 ? Math.max(v > 0 ? 2 : 0, (v / max) * plot) : 0;
          const x = i * slot + (slot - bar) / 2;
          const y = top + plot - h;
          const r = Math.min(4, h);
          const season = seasonLabel(FIRST_SEASON + i);
          return (
            <g key={i}>
              <title>{`${season}${NBSP}: ${fmtInt(eG[i] ?? 0)}`}</title>
              {/* Hit target: the whole slot, not only the bar. */}
              <rect x={i * slot} y={0} width={slot} height={top + plot} fill="transparent" />
              {h > 0 ? (
                <path
                  d={`M${x},${top + plot} V${y + r} Q${x},${y} ${x + r},${y} H${x + bar - r} Q${x + bar},${y} ${x + bar},${y + r} V${top + plot} Z`}
                  className="fill-cyan-600"
                />
              ) : null}
              <text x={x + bar / 2} y={y - 4} textAnchor="middle" className="fill-slate-200 text-[10px] tabular-nums">
                {fmtInt(v)}
              </text>
              <text x={i * slot + slot / 2} y={top + plot + 13} textAnchor="middle" className="fill-slate-400 text-[10px]">
                {`${String((FIRST_SEASON + i) % 100).padStart(2, "0")}-${String((FIRST_SEASON + i + 1) % 100).padStart(2, "0")}`}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="sr-only">
        {vals.map((_, i) => (
          <li key={i}>{`${seasonLabel(FIRST_SEASON + i)}${NBSP}: ${fmtInt(eG[i] ?? 0)}`}</li>
        ))}
      </ul>
    </figure>
  );
}

/**
 * The dynasty part of a player's details row: the model's one-line
 * explanation, the next six seasons, then the numbers behind the columns
 * (every mode's value and rank, range, phase, cutdown, eligibility,
 * market) and the « Conseil » from the page's team's side.
 */
export function DynastyDetail({
  d,
  zero,
  hint,
  mode,
  idPrefix,
}: {
  d: DynastyRecord | null;
  zero: boolean;
  hint: DynastyHintText | null;
  mode: DynastyMode;
  idPrefix: string;
}) {
  if (!d) {
    if (!zero) return null;
    return (
      <p className="mt-3 border-t border-white/10 pt-3 text-slate-300">
        {`Valeur dynastie${NBSP}: 0 (évalué, sous le seuil de la liste publiée).`}
      </p>
    );
  }
  const k = keeperOutlook(d);
  const [p10, , p90] = bandOf(d, mode);
  const items: Array<[string, string]> = [
    [
      "Valeur dynastie",
      DYNASTY_MODES.map((m) => `${DYNASTY_MODE_LABEL[m]} ${fmtInt(d.dv[m])} (rang ${rankLabel(d.rank[m])})`).join(" · "),
    ],
    [
      mode === "winNow" ? "Fourchette (mode Équilibré)" : "Fourchette",
      `${fmtInt(p10)} à ${fmtInt(p90)}, 8 chances sur 10`,
    ],
    ["Phase", `${phaseLabel(d)}${d.trend != null ? ` · ${trendCell(d.trend)}` : ""}`],
  ];
  if (d.path !== "nhl") {
    items.push(["Chances LNH", `${pctCell(d.pNhl)}${d.eta != null ? ` · arrivée ${seasonLabel(d.eta)}` : ""}`]);
  }
  const bar = k.team ? "parmi les 10 protégés de son équipe" : "parmi les 160 protégés de la ligue";
  const free = k.status === "free" ? freeStashFr(d) : null;
  items.push([
    "Écrémage 2027",
    free
      ? `${free.charAt(0).toUpperCase()}${free.slice(1)}`
      : `${k.label}${k.p != null ? ` · ${pctCell(k.p)} de chances d’être ${bar}` : ""}`,
  ]);
  items.push([
    "Mineures",
    d.elig.now
      ? d.elig.freeThrough != null
        ? `admissible jusqu’à la saison ${seasonLabel(d.elig.freeThrough)}${d.elig.uncertain ? " (incertain)" : ""}`
        : "admissible cette saison"
      : "non admissible",
  ]);
  const market: string[] = [];
  if (d.market.ros != null) market.push(`pris dans ${pctCell(d.market.ros / 100)} des ligues Fantrax`);
  if (d.market.adp != null) market.push(`ADP ${fmtNum(d.market.adp, 1)}`);
  if (d.market.leaguePick != null) market.push(`choix ${pickLabel(d.market.leaguePick)} de la ligue`);
  if (market.length) items.push(["Marché", market.join(" · ")]);
  if (hint) items.push(["Conseil (automatique, à vérifier)", hint.long]);
  return (
    <section aria-labelledby={`${idPrefix}-dyn`} className="mt-3 border-t border-white/10 pt-3">
      <h3 id={`${idPrefix}-dyn`} className="text-sm font-semibold text-white">
        Dynastie <span className="font-normal text-slate-400">· mode {DYNASTY_MODE_LABEL[mode]}</span>
      </h3>
      <p className="mt-1 text-slate-200">{sentence(explainFr(d))}</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
        <SeasonGains eG={d.eG} idPrefix={idPrefix} />
        <dl className="grid gap-y-1">
          {items.map(([key, v]) => (
            <div key={key} className="flex min-w-0 gap-2">
              <dt className="shrink-0 text-slate-400">{`${key}${NBSP}:`}</dt>
              <dd className="min-w-0 text-slate-200">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
