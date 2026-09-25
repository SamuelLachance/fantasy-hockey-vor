"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { CellOut, NameCellProps, TableAdapter, TableData } from "@/components/player-table/adapter";
import { PlayerTable } from "@/components/player-table/PlayerTable";
import { SnakeDetail } from "@/components/player-table/SnakeDetail";
import { SnakeLeagueNote, useSnakeFantraxRows } from "@/components/snake/SnakeVerdicts";
import { mergeSnakeIndex, parseSnakeIndex, type DynastyIndex, type SnakeIndex } from "@/lib/fantrax/extras";
import { fmtCalendarDay, fmtNum, fmtOdds, fmtSigned, pickLabel } from "@/lib/fantrax/league-copy";
import type { PoolSnapshot } from "@/lib/fantrax/pool";
import { loadDynasty, loadFantraxPool, peekFantraxPool } from "@/lib/fantrax/pool-client";
import {
  buildFantraxRows,
  FANTRAX_TABLE,
  fantraxDraftOdds,
  fantraxFallbackRows,
  fantraxLabels,
  fantraxRosterRows,
  type ColumnKey,
  type FantraxCaps,
  type FantraxCtx,
  type FantraxFilters,
  type FantraxRow,
  type PresetId,
} from "@/lib/fantrax/table";
import {
  fantraxTableNote,
  iconDetails,
  iconTags,
  nhlDraftLabel,
  numCell,
  oddsCell,
  pctCell,
  sourceLabel,
  statusCopy,
} from "@/lib/fantrax/table-copy";
import { highlightMatch } from "@/lib/player-table/highlight";
import { snakePlayerHref } from "@/lib/snake/url";
import {
  ensureFullSnakeIndex,
  getFullSnakeIndex,
  getFullSnakeStatus,
  subscribeFullSnakeIndex,
  type VerdictStatus,
} from "@/lib/snake/verdicts";
import { FantraxTableFilters } from "./FantraxTableFilters";
import { useFantraxLeague } from "./fantrax-league-context";
import { Tag } from "./LeagueCard";

const VERDICT_TONE: Record<string, string> = {
  "très positif": "text-emerald-200",
  positif: "text-emerald-300/90",
  neutre: "text-slate-300",
  mitigé: "text-amber-200",
  négatif: "text-rose-300",
  "très négatif": "text-rose-200",
};

const MUTED = "text-slate-300";
const oddsTone = (x: number | null) => (x !== null && x < 0.5 ? "font-medium text-amber-200" : MUTED);

const CELLS: Record<ColumnKey, (r: FantraxRow, ctx: FantraxCtx) => CellOut> = {
  statut: (r, ctx) => {
    const s = statusCopy(r, ctx);
    return {
      node: (
        <>
          <Tag tone={s.tone}>{s.text}</Tag>
          {s.detail ? <span className="mt-0.5 block whitespace-nowrap text-xs text-slate-400">{s.detail}</span> : null}
        </>
      ),
    };
  },
  valeur: (r) => ({ node: numCell(r.value, 0), className: "font-semibold text-white" }),
  vona: (r) => ({
    node: r.vona === null ? "—" : fmtSigned(r.vona, 1),
    className: r.vona !== null && r.vona < 0 ? "text-slate-400" : "text-violet-200",
  }),
  dispo: (r) => ({ node: oddsCell(r.available), className: oddsTone(r.available) }),
  fp: (r) => ({ node: numCell(r.fp, 0), className: MUTED }),
  fpm: (r) => ({ node: numCell(r.fpg, 2), className: MUTED }),
  age: (r) => ({ node: r.age ?? "—", className: MUTED }),
  ros: (r) => ({ node: numCell(r.ros, 0), className: MUTED }),
  adp: (r) => ({ node: numCell(r.adp, 1), className: MUTED }),
  lnh: (r) => ({ node: nhlDraftLabel(r.nhlDraft), className: MUTED }),
  dyn: (r) => ({ node: numCell(r.dynasty?.value, 1), className: "font-medium text-white" }),
  phase: (r) => ({ node: r.dynasty?.phase ?? "—", className: `whitespace-nowrap ${MUTED}` }),
  pnhl: (r) => ({ node: pctCell(r.dynasty?.pNhl), className: MUTED }),
  eta: (r) => ({ node: r.dynasty?.eta ?? "—", className: MUTED }),
  fourchette: (r) => {
    const d = r.dynasty;
    return {
      node: d?.p10 !== undefined || d?.p90 !== undefined ? `${numCell(d?.p10, 0)}–${numCell(d?.p90, 0)}` : "—",
      className: MUTED,
    };
  },
  conseil: (r) => ({ node: r.hint ?? "—", className: "whitespace-nowrap text-slate-200" }),
  verdict: (r) => {
    const s = r.snake;
    if (!s?.verdict) return { node: "—", className: "text-slate-400" };
    return {
      className: "whitespace-nowrap",
      node: (
        <Link
          href={snakePlayerHref(s.key)}
          prefetch={false}
          className={`inline-flex min-h-11 items-center gap-1 rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${VERDICT_TONE[s.verdict] ?? MUTED}`}
        >
          {s.verdict}
          <span className="sr-only"> : fiche Snake de {r.name}</span>
        </Link>
      ),
    };
  },
  tendance: (r) => ({ node: r.snake?.trend ?? "—", className: `whitespace-nowrap ${MUTED}` }),
  // Its own cell: in the row header it would be read again on every column move.
  synthese: (r) => ({
    node: <SnakeLeagueNote id={r.id} name={r.name} line className="min-w-[12rem] max-w-[18rem]" />,
    className: "align-top",
  }),
  opinions: (r) => ({ node: r.snake?.opinions ?? "—", className: MUTED }),
};

/** Name, club and positions (the row header), with the few flags worth a glance. */
function FantraxNameCell({ row: r, ctx, query, visible }: NameCellProps<FantraxRow, FantraxCtx>) {
  const tags = iconTags(r.icons);
  // Without the Statut column (views of available players), the few on waivers get a tag.
  const statusShown = visible.includes("statut");
  return (
    <>
      <span className="block max-w-[9rem] break-words font-medium text-white sm:max-w-[16rem] sm:truncate" title={r.name}>
        {highlightMatch(r.name, query)}
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
      {/* Phones: the odds sit under the name (the column hides below sm). */}
      {visible.includes("dispo") && r.available !== null && ctx.nextPick !== null ? (
        <span className={`mt-0.5 block whitespace-nowrap text-xs tabular-nums sm:hidden ${oddsTone(r.available)}`}>
          Dispo. au {pickLabel(ctx.nextPick)} : {fmtOdds(r.available)}
        </span>
      ) : null}
    </>
  );
}

/** Details row: facts (birth, NHL draft, minors, flags, dynasty), then Snake's take. */
function FantraxDetail({ row, idPrefix }: { row: FantraxRow; ctx: FantraxCtx; idPrefix: string }) {
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
  if (row.hint) items.push(["Conseil (automatique, à vérifier)", row.hint]);
  const s = row.snake;
  return (
    <>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {items.map(([k, v]) => (
          <div key={k} className="flex min-w-0 gap-2">
            <dt className="shrink-0 text-slate-400">{k} :</dt>
            <dd className="min-w-0 text-slate-200">{v}</dd>
          </div>
        ))}
      </dl>
      {s ? <SnakeDetail snakeKey={s.key} verdict={s.verdict} trend={s.trend} probable={s.probable} idPrefix={idPrefix} /> : null}
    </>
  );
}

export const FANTRAX_ADAPTER: TableAdapter<FantraxRow, FantraxFilters, FantraxCaps, FantraxCtx> = {
  spec: FANTRAX_TABLE,
  Filters: FantraxTableFilters,
  NameCell: FantraxNameCell,
  cells: CELLS,
  Detail: FantraxDetail,
  rowClass: (r, ctx) => (r.owner === ctx.teamId ? "bg-cyan-500/[0.04]" : undefined),
};

const EMPTY_FIELDS: ReadonlySet<string> = new Set();
const PARTIAL_ROSTER_NOTE = {
  loading: "Liste partielle (joueurs retenus par le plan du jour) : effectif complet en chargement…",
  error: "Liste partielle : seulement les joueurs retenus par le plan du jour, pas tout l’effectif.",
};
const serverFull = () => null;
const serverStatus = (): VerdictStatus => "idle";
const settled = (s: VerdictStatus) => s === "ready" || s === "error";

export interface FantraxTableSource {
  data: TableData<FantraxRow, FantraxCaps, FantraxCtx>;
  pool: PoolSnapshot | null;
  dynasty: DynastyIndex | null;
  snake: SnakeIndex | null;
}

/**
 * The Captains table's data: the pool (fetched once per page view, kept
 * across tabs), the league provider's live state and draft, Snake's
 * verdicts (the compact file, loaded with the page; the full index on
 * demand) and, when the build saw it, the dynasty file. `fallback` rows
 * come from the plan already on the page (the current draft board, or the
 * team's roster) until the pool is in.
 */
export function useFantraxTableData({
  autoLoad,
  fallback,
}: {
  autoLoad: boolean;
  fallback: "draft" | "team" | null;
}): FantraxTableSource {
  const { plan, bundle, state, teamId, teams, teamName, hasDynasty } = useFantraxLeague();
  const [wanted, setWanted] = useState(autoLoad);
  const [pool, setPool] = useState<PoolSnapshot | null>(peekFantraxPool);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [dynasty, setDynasty] = useState<DynastyIndex | null>(null);
  const [dynastyIn, setDynastyIn] = useState(!hasDynasty);

  useEffect(() => {
    if (!wanted || pool) return;
    let cancelled = false;
    loadFantraxPool().then(
      (p) => {
        if (cancelled) return;
        setPool(p);
        setFailed(false);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [wanted, attempt, pool]);

  useEffect(() => {
    if (!wanted || !hasDynasty) return;
    let cancelled = false;
    loadDynasty().then((d) => {
      if (cancelled) return;
      setDynasty(d);
      setDynastyIn(true);
    });
    return () => {
      cancelled = true;
    };
  }, [wanted, hasDynasty]);

  // ---- Snake: the compact verdicts (seed first), the full index when asked for
  const { rows: fxRows, status: fxStatus } = useSnakeFantraxRows();
  const compact = useMemo(() => (fxRows ? parseSnakeIndex({ rows: fxRows }) : null), [fxRows]);
  const full = useSyncExternalStore(subscribeFullSnakeIndex, getFullSnakeIndex, serverFull);
  const fullStatus = useSyncExternalStore(subscribeFullSnakeIndex, getFullSnakeStatus, serverStatus);
  const snake = useMemo(() => mergeSnakeIndex(full, compact), [full, compact]);
  const snakeIn = settled(fxStatus);

  // ---- rows (rosters and picks: the provider's live state)
  const teamPlan = plan?.teamId === teamId ? plan : null;
  const baseLineup = teamPlan?.baseLineup ?? null;
  const draft = useMemo(
    () => (pool && state && bundle ? fantraxDraftOdds(state, bundle.values, teamId, baseLineup) : null),
    [pool, state, bundle, teamId, baseLineup],
  );
  const rows = useMemo(
    () => (pool ? buildFantraxRows({ pool, state, values: bundle?.values ?? null, baseLineup, draft, dynasty, snake }) : []),
    [pool, state, bundle, baseLineup, draft, dynasty, snake],
  );
  // Mon équipe: the whole roster once the league state is in (the plan
  // alone only holds the players it considered: said so until then).
  const rosterIn = fallback === "team" && !!state && !!bundle;
  const fallbackRows = useMemo(() => {
    if (!fallback) return undefined;
    if (fallback === "team" && state && bundle) {
      return fantraxRosterRows(teamPlan, state.rosters[teamId] ?? [], bundle.values.players, teamId, snake);
    }
    return fantraxFallbackRows(teamPlan, fallback, snake);
  }, [fallback, teamPlan, state, bundle, teamId, snake]);
  const fallbackNote = fallback === "team" && !rosterIn ? PARTIAL_ROSTER_NOTE : undefined;

  // ---- what the data can show, and what cells need
  const planDraft = teamPlan?.draft ?? null;
  const draftCap = draft ? !!draft.next : !!planDraft?.next;
  const hasSnake = snakeIn && !!snake;
  const hasOpinions = !!full?.hasOpinions;
  const caps = useMemo<FantraxCaps>(
    () => ({ draft: draftCap, dynasty: dynasty?.fields ?? EMPTY_FIELDS, snake: hasSnake, snakeOpinions: hasOpinions }),
    [draftCap, dynasty, hasSnake, hasOpinions],
  );
  const teamIds = useMemo(() => teams.map((t) => t.id), [teams]);
  const draftOpen = !!draft || !!planDraft;
  const nextPick = draft?.next?.pick ?? planDraft?.next?.pick ?? null;
  const ctx = useMemo<FantraxCtx>(
    () => ({ teamId, draftOpen, nextPick, teamName, teamIds }),
    [teamId, draftOpen, nextPick, teamName, teamIds],
  );
  const labels = useMemo(() => fantraxLabels(rows, dynasty, snake), [rows, dynasty, snake]);

  const want = useCallback(() => setWanted(true), []);
  const retry = useCallback(() => {
    setFailed(false);
    setWanted(true);
    setAttempt((n) => n + 1);
  }, []);
  const status = pool ? "ready" : failed ? "error" : wanted ? "loading" : "idle";

  const data = useMemo<TableData<FantraxRow, FantraxCaps, FantraxCtx>>(
    () => ({
      rows,
      fallbackRows,
      fallbackNote,
      status,
      extras: { snake: snakeIn, dynasty: dynastyIn, snakeFull: settled(fullStatus) },
      caps,
      ctx,
      labels,
      total: pool?.counts.total ?? null,
      want,
      wantFullSnake: ensureFullSnakeIndex,
      retry,
    }),
    [rows, fallbackRows, fallbackNote, status, snakeIn, dynastyIn, fullStatus, caps, ctx, labels, pool, want, retry],
  );
  return { data, pool, dynasty, snake };
}

/**
 * A Captains Dynasty tab's player table: the unified PlayerTable with the
 * Fantrax adapter, starting from the tab's view (`base`), with the tab's
 * preset chips and page size.
 */
export function FantraxPlayerTable({
  id,
  title,
  description,
  base,
  presets,
  perPage,
  fallback = null,
  footer,
  compactFilters = false,
  showTotal = false,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  base: PresetId;
  presets: readonly PresetId[];
  perPage: number;
  fallback?: "draft" | "team" | null;
  /** The tab's own note (it then explains value, VONA and odds: the table's note skips them). */
  footer?: ReactNode;
  compactFilters?: boolean;
  showTotal?: boolean;
}) {
  const { data, pool, dynasty, snake } = useFantraxTableData({ autoLoad: true, fallback });
  const note = pool
    ? fantraxTableNote({
        draftOpen: data.ctx.draftOpen,
        nextPick: data.ctx.nextPick,
        poolAsOf: pool.fetchedAt,
        counts: pool.counts,
        recentDrafts: pool.recentDrafts,
        dynasty: !!dynasty,
        snake: !!snake,
        brief: !!footer,
      })
    : null;
  return (
    <PlayerTable
      id={id}
      title={title}
      description={description}
      adapter={FANTRAX_ADAPTER}
      data={data}
      base={base}
      presets={presets}
      perPage={perPage}
      compactFilters={compactFilters}
      showTotal={showTotal}
      footer={
        footer || note ? (
          <>
            {footer ? <p>{footer}</p> : null}
            {note ? <p className={footer ? "mt-1" : undefined}>{note}</p> : null}
          </>
        ) : null
      }
    />
  );
}
