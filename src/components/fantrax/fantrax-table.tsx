"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { CellOut, NameCellProps, TableAdapter, TableData } from "@/components/player-table/adapter";
import { PlayerTable } from "@/components/player-table/PlayerTable";
import { SnakeLeagueNote, useSnakeFantraxRows } from "@/components/snake/SnakeVerdicts";
import type { Phase } from "@/lib/dynasty/types";
import { bandOf, dynastyHint, hintSide, keeperOutlook, phaseLabel } from "@/lib/fantrax/dynasty-hints";
import type { DynastyIndex } from "@/lib/fantrax/dynasty-index";
import { mergeSnakeIndex, parseSnakeIndex, type SnakeIndex } from "@/lib/fantrax/extras";
import { fmtOdds, fmtSigned, pickLabel } from "@/lib/fantrax/league-copy";
import type { PoolSnapshot } from "@/lib/fantrax/pool";
import { loadDynasty, loadFantraxPool, peekDynasty, peekFantraxPool } from "@/lib/fantrax/pool-client";
import {
  buildFantraxRows,
  FANTRAX_TABLE,
  syncOwnersOf,
  fantraxDraftOdds,
  fantraxFallbackRows,
  fantraxLabels,
  fantraxRosterRows,
  rowDynastyValue,
  type ColumnKey,
  type FantraxCaps,
  type FantraxCtx,
  type FantraxFilters,
  type FantraxRow,
  type PresetId,
} from "@/lib/fantrax/table";
import {
  DYNASTY_LEGEND,
  fantraxTableNote,
  iconTags,
  nhlDraftLabel,
  numCell,
  oddsCell,
  pctCell,
  seasonLabel,
  statusCopy,
  trendCell,
} from "@/lib/fantrax/table-copy";
import { fmtInt } from "@/lib/player-table/copy";
import { highlightMatch } from "@/lib/player-table/highlight";
import { snakePlayerHref } from "@/lib/snake/url";
import {
  ensureFullSnakeIndex,
  getFullSnakeIndex,
  getFullSnakeStatus,
  subscribeFullSnakeIndex,
  type VerdictStatus,
} from "@/lib/snake/verdicts";
import { DYNASTY_MODE_LABEL } from "@/lib/fantrax/dynasty-mode";
import { DynastyModeSwitch } from "./DynastyModeSwitch";
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

const PHASE_TONE: Record<Phase, string> = {
  prospect: "text-violet-200",
  rising: "text-cyan-200",
  entering_prime: "text-cyan-200",
  prime: "text-emerald-200",
  plateau: "text-slate-300",
  declining: "text-amber-200",
  late_career: "text-rose-200",
};

const rankLabel = (n: number) => (n === 1 ? "1er" : `${n}e`);

// The details row (facts, the dynasty block with the model's sentence and
// the six-season chart, Snake's take): its own chunk, loaded when a row
// opens, not with the tab.
const FantraxDetail = dynamic(() => import("./FantraxDetail").then((m) => m.FantraxDetail), {
  loading: () => <p className="text-slate-400">Chargement des détails…</p>,
});

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
  // The page's mode: its value, and the league rank under it.
  dyn: (r, ctx) => {
    const v = rowDynastyValue(r, ctx.mode);
    const rank = r.dynasty?.rank[ctx.mode];
    return {
      node:
        v === null ? (
          <span title={ctx.dynastyIn ? "Non évalué : absent des données du modèle" : undefined}>—</span>
        ) : (
          <>
            {fmtInt(v)}
            {rank ? (
              <span className="block text-xs font-normal text-slate-400">
                <span className="sr-only">rang </span>
                {rankLabel(rank)}
              </span>
            ) : null}
          </>
        ),
      className: "font-semibold text-cyan-100",
    };
  },
  fp: (r) => ({ node: numCell(r.fp, 0), className: MUTED }),
  fpm: (r) => ({ node: numCell(r.fpg, 2), className: MUTED }),
  age: (r) => ({ node: r.age ?? "—", className: MUTED }),
  ros: (r) => ({ node: numCell(r.ros, 0), className: MUTED }),
  adp: (r) => ({ node: numCell(r.adp, 1), className: MUTED }),
  lnh: (r) => ({ node: nhlDraftLabel(r.nhlDraft), className: MUTED }),
  phase: (r) => ({
    node: r.dynasty ? phaseLabel(r.dynasty) : "—",
    className: `whitespace-nowrap ${r.dynasty ? PHASE_TONE[r.dynasty.phase] : MUTED}`,
  }),
  evol: (r) => {
    const t = r.dynasty?.trend;
    const tone = t != null && t >= 0.005 ? "text-emerald-200" : t != null && t <= -0.005 ? "text-amber-200" : MUTED;
    return { node: trendCell(t), className: `whitespace-nowrap ${tone}` };
  },
  pnhl: (r) => ({ node: pctCell(r.dynasty?.pNhl), className: MUTED }),
  eta: (r) => ({
    node: r.dynasty?.eta != null ? seasonLabel(r.dynasty.eta) : "—",
    className: `whitespace-nowrap ${MUTED}`,
  }),
  // His team's 10 slots on the roster the model saw; else the league's 160 (« ligue »).
  conservation: (r) => {
    if (!r.dynasty) return { node: "—", className: MUTED };
    const k = keeperOutlook(r.dynasty);
    return {
      node: (
        <>
          <Tag tone={k.tone}>{k.label}</Tag>
          {k.detail ? <span className="mt-0.5 block whitespace-nowrap text-xs tabular-nums text-slate-400">{k.detail}</span> : null}
        </>
      ),
    };
  },
  fourchette: (r, ctx) => {
    if (!r.dynasty) return { node: "—", className: MUTED };
    const [p10, , p90] = bandOf(r.dynasty, ctx.mode);
    return { node: `${fmtInt(p10)}–${fmtInt(p90)}`, className: `whitespace-nowrap ${MUTED}` };
  },
  // From the page's team's side: its players, the available ones, the other teams'.
  conseil: (r, ctx) => {
    if (!r.dynasty) return { node: "—", className: MUTED };
    // The sentence behind it is in the details row (loaded when a row opens).
    return { node: dynastyHint(r.dynasty, hintSide(r.owner, ctx.teamId)).short, className: "whitespace-nowrap text-slate-200" };
  },
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
          {r.team || "Sans équipe"}
          {r.groups.length ? ` · ${r.groups.join("/")}` : ""}
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

export const FANTRAX_ADAPTER: TableAdapter<FantraxRow, FantraxFilters, FantraxCaps, FantraxCtx> = {
  spec: FANTRAX_TABLE,
  Filters: FantraxTableFilters,
  NameCell: FantraxNameCell,
  cells: CELLS,
  Detail: FantraxDetail,
  rowClass: (r, ctx) => (r.owner === ctx.teamId ? "bg-cyan-500/[0.04]" : undefined),
};

const PARTIAL_ROSTER_NOTE = {
  loading: "Liste partielle (joueurs retenus par le plan du jour) : effectif complet en chargement…",
  error: "Liste partielle : seulement les joueurs retenus par le plan du jour, pas tout l’effectif.",
};
const serverFull = () => null;
const serverStatus = (): VerdictStatus => "idle";
const settled = (s: VerdictStatus) => s === "ready" || s === "error";

/**
 * dynasty.json for the Captains tabs, when the build published it: fetched
 * once per page view (kept across tab changes), once `wanted`. `settled`
 * turns true when the read is over (or never coming), so views that sort
 * or filter by dynasty data stop waiting.
 */
export function useDynastyIndex(wanted: boolean): { dynasty: DynastyIndex | null; settled: boolean } {
  const { hasDynasty } = useFantraxLeague();
  const [read, setRead] = useState(() => {
    const peek = peekDynasty();
    return { dynasty: peek.value, settled: !hasDynasty || peek.settled };
  });
  useEffect(() => {
    if (!wanted || !hasDynasty || read.settled) return;
    let cancelled = false;
    loadDynasty().then((d) => {
      if (!cancelled) setRead({ dynasty: d, settled: true });
    });
    return () => {
      cancelled = true;
    };
  }, [wanted, hasDynasty, read.settled]);
  return read;
}

export interface FantraxTableSource {
  data: TableData<FantraxRow, FantraxCaps, FantraxCtx>;
  pool: PoolSnapshot | null;
  dynasty: DynastyIndex | null;
  snake: SnakeIndex | null;
}

/**
 * The Captains table's data: the pool (fetched once per page view, kept
 * across tabs), the league provider's live state, draft and dynasty mode,
 * Snake's verdicts (the compact file, loaded with the page; the full index
 * on demand) and dynasty.json (when the build saw it). `fallback` rows come
 * from the plan already on the page (the current draft board, or the
 * team's roster) until the pool is in.
 */
export function useFantraxTableData({
  autoLoad,
  fallback,
}: {
  autoLoad: boolean;
  fallback: "draft" | "team" | null;
}): FantraxTableSource {
  const { plan, bundle, state, teamId, teams, teamName, hasDynasty, mode } = useFantraxLeague();
  // Rosters at the sync the dynasty values saw (the snapshot, before the live read).
  const syncOwners = useMemo(() => syncOwnersOf(bundle?.state), [bundle]);
  const [wanted, setWanted] = useState(autoLoad);
  const [pool, setPool] = useState<PoolSnapshot | null>(peekFantraxPool);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { dynasty, settled: dynastyIn } = useDynastyIndex(wanted);

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
    () =>
      pool ? buildFantraxRows({ pool, state, values: bundle?.values ?? null, baseLineup, draft, dynasty, snake, syncOwners }) : [],
    [pool, state, bundle, baseLineup, draft, dynasty, snake, syncOwners],
  );
  // Mon équipe: the whole roster once the league state is in (the plan
  // alone only holds the players it considered: said so until then).
  const rosterIn = fallback === "team" && !!state && !!bundle;
  const fallbackRows = useMemo(() => {
    if (!fallback) return undefined;
    const extras = { dynasty, snake, syncOwners };
    if (fallback === "team" && state && bundle) {
      return fantraxRosterRows(teamPlan, state.rosters[teamId] ?? [], bundle.values.players, teamId, extras);
    }
    return fantraxFallbackRows(teamPlan, fallback, extras);
  }, [fallback, teamPlan, state, bundle, teamId, dynasty, snake, syncOwners]);
  const fallbackNote = fallback === "team" && !rosterIn ? PARTIAL_ROSTER_NOTE : undefined;

  // ---- what the data can show, and what cells need
  const planDraft = teamPlan?.draft ?? null;
  const draftCap = draft ? !!draft.next : !!planDraft?.next;
  const hasSnake = snakeIn && !!snake;
  const hasOpinions = !!full?.hasOpinions;
  const hasDynastyData = !!dynasty;
  const caps = useMemo<FantraxCaps>(
    () => ({
      draft: draftCap,
      dynasty: hasDynastyData,
      dynastyPublished: hasDynasty,
      snake: hasSnake,
      snakeOpinions: hasOpinions,
    }),
    [draftCap, hasDynastyData, hasDynasty, hasSnake, hasOpinions],
  );
  const teamIds = useMemo(() => teams.map((t) => t.id), [teams]);
  const draftOpen = !!draft || !!planDraft;
  const nextPick = draft?.next?.pick ?? planDraft?.next?.pick ?? null;
  const ctx = useMemo<FantraxCtx>(
    () => ({ teamId, draftOpen, nextPick, teamName, teamIds, mode, dynastyIn: hasDynastyData }),
    [teamId, draftOpen, nextPick, teamName, teamIds, mode, hasDynastyData],
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
 * preset chips and page size, and the dynasty mode switch above its
 * filters (unless the tab shows it elsewhere).
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
  modeSwitch = true,
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
  /** The « Valeur dynastie » mode switch above the filters (off where the tab shows its own). */
  modeSwitch?: boolean;
}) {
  const { hasDynasty } = useFantraxLeague();
  const { data, pool, dynasty, snake } = useFantraxTableData({ autoLoad: true, fallback });
  // Views by dynasty value only where the build published it.
  const chips = useMemo(() => presets.filter((p) => p !== "dynastie" || hasDynasty), [presets, hasDynasty]);
  const note = pool
    ? fantraxTableNote({
        draftOpen: data.ctx.draftOpen,
        nextPick: data.ctx.nextPick,
        poolAsOf: pool.fetchedAt,
        counts: pool.counts,
        recentDrafts: pool.recentDrafts,
        dynasty: !!dynasty,
        mode: data.ctx.mode,
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
      presets={chips}
      perPage={perPage}
      compactFilters={compactFilters}
      showTotal={showTotal}
      lead={
        hasDynasty ? (
          <>
            {modeSwitch ? <DynastyModeSwitch idPrefix={id} /> : null}
            <p className={`text-xs text-slate-400 ${modeSwitch ? "mt-2" : ""}`}>{DYNASTY_LEGEND}</p>
          </>
        ) : null
      }
      announce={hasDynasty ? { key: data.ctx.mode, text: `Valeurs dynastie en mode ${DYNASTY_MODE_LABEL[data.ctx.mode]}.` } : undefined}
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
