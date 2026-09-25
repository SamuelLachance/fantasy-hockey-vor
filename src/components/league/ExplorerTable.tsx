"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ExternalLink } from "lucide-react";
import { Fragment } from "react";
import {
  columnCopy,
  iconDetails,
  iconTags,
  nhlDraftLabel,
  numCell,
  oddsCell,
  pctCell,
  sortButtonLabel,
  sourceLabel,
  statusCopy,
} from "@/lib/fantrax/explorer-copy";
import { COLUMN_SORT, type ColumnKey, type ExplorerRow, type SortDir, type SortKey } from "@/lib/fantrax/explorer";
import { fmtCalendarDay, fmtNum, fmtSigned } from "@/lib/fantrax/league-copy";
import { snakePlayerHref } from "@/lib/site";
import { Tag } from "./LeagueCard";

export interface ExplorerTableProps {
  rows: ExplorerRow[];
  columns: ColumnKey[];
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  nextPick: number | null;
  teamId: string;
  draftOpen: boolean;
  teamName: (id: string) => string;
  expanded: string | null;
  onToggle: (id: string) => void;
  caption: string;
}

const NUM_TD = "whitespace-nowrap px-2 py-2 text-right tabular-nums";

const VERDICT_TONE: Record<string, string> = {
  "très positif": "text-emerald-200",
  positif: "text-emerald-300/90",
  neutre: "text-slate-300",
  mitigé: "text-amber-200",
  négatif: "text-rose-300",
  "très négatif": "text-rose-200",
};

function SortGlyph({ active, dir }: { active: boolean; dir: SortDir }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  if (!active) return <ArrowUpDown className={`${cls} opacity-40`} aria-hidden="true" />;
  return dir === "asc" ? <ArrowUp className={cls} aria-hidden="true" /> : <ArrowDown className={cls} aria-hidden="true" />;
}

function Cell({ col, row, ctx }: { col: ColumnKey; row: ExplorerRow; ctx: Pick<ExplorerTableProps, "teamId" | "draftOpen" | "teamName"> }) {
  switch (col) {
    case "statut": {
      const s = statusCopy(row, ctx);
      return (
        <td className="px-2 py-2 text-left">
          <Tag tone={s.tone}>{s.text}</Tag>
          {s.detail ? <span className="mt-0.5 block whitespace-nowrap text-xs text-slate-500">{s.detail}</span> : null}
        </td>
      );
    }
    case "valeur":
      return <td className={`${NUM_TD} font-semibold text-white`}>{numCell(row.value, 0)}</td>;
    case "vona":
      return (
        <td className={`${NUM_TD} ${row.vona !== null && row.vona < 0 ? "text-slate-400" : "text-violet-200"}`}>
          {row.vona === null ? "—" : fmtSigned(row.vona, 1)}
        </td>
      );
    case "dispo":
      return (
        <td className={`${NUM_TD} ${row.available !== null && row.available < 0.5 ? "font-medium text-amber-200" : "text-slate-300"}`}>
          {oddsCell(row.available)}
        </td>
      );
    case "fp":
      return <td className={`${NUM_TD} text-slate-300`}>{numCell(row.fp, 0)}</td>;
    case "fpm":
      return <td className={`${NUM_TD} text-slate-300`}>{numCell(row.fpg, 2)}</td>;
    case "age":
      return <td className={`${NUM_TD} text-slate-300`}>{row.age ?? "—"}</td>;
    case "ros":
      return <td className={`${NUM_TD} text-slate-300`}>{numCell(row.ros, 0)}</td>;
    case "adp":
      return <td className={`${NUM_TD} text-slate-300`}>{numCell(row.adp, 1)}</td>;
    case "lnh":
      return <td className={`${NUM_TD} text-slate-300`}>{nhlDraftLabel(row.nhlDraft)}</td>;
    case "dyn":
      return <td className={`${NUM_TD} font-medium text-white`}>{numCell(row.dynasty?.value, 1)}</td>;
    case "phase":
      return <td className="whitespace-nowrap px-2 py-2 text-left text-slate-300">{row.dynasty?.phase ?? "—"}</td>;
    case "pnhl":
      return <td className={`${NUM_TD} text-slate-300`}>{pctCell(row.dynasty?.pNhl)}</td>;
    case "eta":
      return <td className={`${NUM_TD} text-slate-300`}>{row.dynasty?.eta ?? "—"}</td>;
    case "fourchette": {
      const d = row.dynasty;
      return (
        <td className={`${NUM_TD} text-slate-300`}>
          {d?.p10 !== undefined || d?.p90 !== undefined ? `${numCell(d?.p10, 0)}–${numCell(d?.p90, 0)}` : "—"}
        </td>
      );
    }
    case "verdict": {
      const s = row.snake;
      if (!s?.verdict) return <td className="px-2 py-2 text-left text-slate-500">—</td>;
      return (
        <td className="whitespace-nowrap px-2 py-2 text-left">
          <a
            href={snakePlayerHref(s.key)}
            className={`inline-flex min-h-11 items-center gap-1 rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${VERDICT_TONE[s.verdict] ?? "text-slate-300"}`}
          >
            {s.verdict}
            <span className="sr-only"> : fiche Snake de {row.name}</span>
          </a>
        </td>
      );
    }
    case "tendance":
      return <td className="whitespace-nowrap px-2 py-2 text-left text-slate-300">{row.snake?.trend ?? "—"}</td>;
    case "opinions":
      return <td className={`${NUM_TD} text-slate-300`}>{row.snake?.opinions ?? "—"}</td>;
  }
}

function Details({ row, colSpan, id }: { row: ExplorerRow; colSpan: number; id: string }) {
  const icons = iconDetails(row.icons);
  const d = row.dynasty;
  const items: Array<[string, string]> = [["Type", sourceLabel(row.src)]];
  if (row.birthDate) {
    items.push(["Naissance", `${fmtCalendarDay(row.birthDate).replace(/^\S+ /, "")} ${row.birthDate.slice(0, 4)}`]);
  }
  items.push(
    ["Repêchage LNH", row.nhlDraft ? nhlDraftLabel(row.nhlDraft) : "non repêché ou inconnu"],
    ["Mineures", row.minorsEligible ? "admissible aux postes des mineures de la ligue" : "non admissible"],
  );
  if (row.gp !== null) items.push(["Matchs projetés", fmtNum(row.gp, 0)]);
  if (icons.length) items.push(["Fantrax", icons.join(", ")]);
  if (d) {
    if (d.value !== undefined) items.push(["Valeur dynastie", fmtNum(d.value, 1)]);
    if (d.p10 !== undefined || d.p50 !== undefined || d.p90 !== undefined) {
      items.push(["p10 / p50 / p90", `${numCell(d.p10, 0)} / ${numCell(d.p50, 0)} / ${numCell(d.p90, 0)}`]);
    }
    if (d.phase) items.push(["Phase", d.phase]);
    if (d.eta !== undefined) items.push(["ETA", String(d.eta)]);
    if (d.pNhl !== undefined) items.push(["P(LNH)", pctCell(d.pNhl)]);
  }
  const s = row.snake;
  return (
    <tr id={id} className="bg-white/[0.02]">
      <td colSpan={colSpan} className="px-3 pb-4 pt-1 text-sm">
        {/* Sticky and no wider than the screen: the details stay in view
            however far the table is scrolled sideways. */}
        <div className="sticky left-3 w-[min(48rem,calc(100vw-3.5rem))]">
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {items.map(([k, v]) => (
              <div key={k} className="flex min-w-0 gap-2">
                <dt className="shrink-0 text-slate-500">{k} :</dt>
                <dd className="min-w-0 text-slate-200">{v}</dd>
              </div>
            ))}
          </dl>
          {s ? (
            <div className="mt-3 max-w-3xl rounded-xl border border-white/10 bg-slate-950/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Snake{s.verdict ? ` · ${s.verdict}` : ""}
                {s.trend ? ` · ${s.trend}` : ""}
                {s.opinions !== undefined ? ` · ${s.opinions} opinion${s.opinions > 1 ? "s" : ""}` : ""}
              </p>
              {s.projection ? (
                <p className="mt-1 text-slate-200">
                  <span className="text-slate-500">Projection : </span>
                  {s.projection}
                </p>
              ) : null}
              {s.summary ? <p className="mt-1 text-slate-300">{s.summary}</p> : null}
              <a
                href={snakePlayerHref(s.key)}
                className="mt-1 inline-flex min-h-11 items-center gap-1 rounded-sm text-cyan-300 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                Fiche Snake complète
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

/**
 * The explorer's result table: row headers are the players (name, club and
 * positions only; the details button has its own leading cell), every
 * number column sorts from its header, and a row expands for the details
 * (birth date, draft, flags, dynasty range, Snake's synthesis).
 */
export function ExplorerTable({
  rows,
  columns,
  sort,
  onSort,
  nextPick,
  teamId,
  draftOpen,
  teamName,
  expanded,
  onToggle,
  caption,
}: ExplorerTableProps) {
  const ctx = { teamId, draftOpen, teamName };
  const nameActive = sort.key === "nom";
  // Without the Statut column (views of available players), the few on waivers get a tag.
  const statusShown = columns.includes("statut");
  return (
    // `relative` keeps the absolutely positioned sr-only text inside the
    // scroller: without it the page itself scrolls sideways on phones.
    <div className="relative -mx-4 overflow-x-auto sm:mx-0 sm:rounded-xl sm:border sm:border-white/10">
      <table className="min-w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate-900 text-left text-xs uppercase tracking-wider text-slate-400">
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-11 min-w-11 bg-slate-900 p-0">
              <span className="sr-only">Détails</span>
            </th>
            <th
              scope="col"
              aria-sort={nameActive ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
              className="sticky left-11 z-10 bg-slate-900 px-2 py-1 font-medium"
            >
              <button
                type="button"
                onClick={() => onSort("nom")}
                aria-label={sortButtonLabel("Joueur", nameActive, sort.dir)}
                className="inline-flex min-h-11 items-center gap-1 rounded-md uppercase tracking-wider hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                Joueur
                <SortGlyph active={nameActive} dir={sort.dir} />
              </button>
            </th>
            {columns.map((c) => {
              const copy = columnCopy(c, nextPick);
              const key = COLUMN_SORT[c];
              const active = key !== null && sort.key === key;
              const align = c === "statut" || c === "phase" || c === "verdict" || c === "tendance" ? "text-left" : "text-right";
              return (
                <th
                  key={c}
                  scope="col"
                  title={copy.title}
                  aria-sort={key === null ? undefined : active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  className={`whitespace-nowrap px-2 py-1 font-medium ${align}`}
                >
                  {key === null ? (
                    <span className="inline-flex min-h-11 items-center">{copy.label}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSort(key)}
                      aria-label={sortButtonLabel(copy.label, active, sort.dir)}
                      className={`inline-flex min-h-11 items-center gap-1 rounded-md uppercase tracking-wider hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                        active ? "text-cyan-200" : ""
                      } ${align === "text-right" ? "flex-row-reverse" : ""} ${
                        // « Dispo. au n° 27 » wraps on phones so the odds sit next to VONA.
                        c === "dispo" ? "max-w-[6.5rem] whitespace-normal text-right sm:max-w-none sm:whitespace-nowrap" : ""
                      }`}
                    >
                      <span>{copy.label}</span>
                      <SortGlyph active={active} dir={sort.dir} />
                    </button>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((r) => {
            const open = expanded === r.id;
            const detailsId = `explorateur-details-${r.id}`;
            const tags = iconTags(r.icons);
            return (
              <Fragment key={r.id}>
                <tr className={r.owner === teamId ? "bg-cyan-500/[0.04]" : undefined}>
                  {/* Its own cell, so the row header (read with every cell) is just the player. */}
                  <td className="sticky left-0 z-10 w-11 min-w-11 bg-slate-950 py-1.5 pl-2 pr-0 align-top">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={open ? detailsId : undefined}
                      onClick={() => onToggle(r.id)}
                      className="inline-flex h-11 w-9 items-center justify-center rounded-md text-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                    >
                      <ChevronDown
                        className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
                        aria-hidden="true"
                      />
                      <span className="sr-only">{open ? `Masquer les détails de ${r.name}` : `Détails de ${r.name}`}</span>
                    </button>
                  </td>
                  <th scope="row" className="sticky left-11 z-10 bg-slate-950 px-2 py-2.5 text-left align-top font-normal">
                    <span className="block max-w-[9rem] break-words font-medium text-white sm:max-w-[16rem] sm:truncate" title={r.name}>
                      {r.name}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-400">
                      <span className="whitespace-nowrap">
                        {r.team || "Sans équipe"} · {r.groups.join("/")}
                      </span>
                      {r.src === "e" ? <span className="text-violet-300">Espoir</span> : null}
                      {!statusShown && !r.owner && r.free === "WW" ? (
                        <span className="text-amber-200" title="Au ballottage : il ne joue pour vous qu'à partir du lendemain">
                          Ballottage
                        </span>
                      ) : null}
                      {tags.map((t) => (
                        <span
                          key={t.text}
                          title={t.title}
                          className={t.tone === "rose" ? "text-rose-300" : t.tone === "amber" ? "text-amber-200" : "text-slate-400"}
                        >
                          {t.text}
                        </span>
                      ))}
                    </span>
                  </th>
                  {columns.map((c) => (
                    <Cell key={c} col={c} row={r} ctx={ctx} />
                  ))}
                </tr>
                {open ? <Details row={r} colSpan={columns.length + 2} id={detailsId} /> : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
