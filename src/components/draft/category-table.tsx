"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { CellOut, NameCellProps, TableAdapter, TableData } from "@/components/player-table/adapter";
import { PlayerTable } from "@/components/player-table/PlayerTable";
import { SnakeDetail } from "@/components/player-table/SnakeDetail";
import { SnakeVerdictsProvider, useSnakeNhlRows } from "@/components/snake/SnakeVerdicts";
import { availabilityBand } from "@/lib/draft/availability";
import { displayRank } from "@/lib/draft/board-filter";
import type { DraftBoard } from "@/lib/draft/board-types";
import {
  CATEGORY_FR,
  CATEGORY_SHORT,
  formatFr,
  formatPercentFr,
  formatSignedFr,
  formatStat,
  pickLabel,
  yearsLabel,
} from "@/lib/draft/draft-copy";
import { getDraftStore } from "@/lib/draft/draft-store";
import { draftTimeline } from "@/lib/draft/suggestions";
import {
  boardCategories,
  buildCategoryRows,
  categoryCell,
  categoryColumnKey,
  categoryLabels,
  categoryStatusText,
  categoryTable,
  draftDone,
  oddsPickOf,
  type CategoryCaps,
  type CategoryCtx,
  type CategoryFilters,
  type CategoryPresetId,
  type CategoryRow,
} from "@/lib/draft/table";
import { LEAGUES } from "@/lib/leagues/registry";
import { leaguePlayerPath } from "@/lib/leagues/routes";
import { highlightMatch } from "@/lib/player-table/highlight";
import type { SnakeNhlFile, SnakeRow } from "@/lib/snake/types";
import { snakePlayerHref } from "@/lib/snake/url";
import { CategoryMiniBars } from "./CategoryMiniBars";
import { CategoryTableFilters } from "./CategoryTableFilters";
import { DraftPositionBadges } from "./DraftPositionBadges";

const MUTED = "text-slate-300";

const VERDICT_TONE: Record<string, string> = {
  "très positif": "text-emerald-200",
  positif: "text-emerald-300/90",
  neutre: "text-slate-300",
  mitigé: "text-amber-200",
  négatif: "text-rose-300",
  "très négatif": "text-rose-200",
};

const BAND_TONE = { yes: "text-emerald-300", maybe: "text-amber-300", no: "text-rose-300" } as const;
const oddsTone = (x: number | null) => (x === null ? "text-slate-400" : BAND_TONE[availabilityBand(x)]);

/** A category cell's color from its z: the league's scale, not the player's peers. */
function zTone(z: number): string {
  if (z >= 1) return "font-semibold text-cyan-200";
  if (z >= 0.25) return "text-cyan-100/90";
  if (z <= -1) return "text-rose-300";
  if (z <= -0.25) return "text-rose-200/80";
  return "text-slate-400";
}

/** The Fantrax league (the same players' ids live in Snake's records). */
const fantraxLeague = LEAGUES.find((l) => l.kind === "fantrax-points");

/** Snake's record knows his Fantrax id: the Captains Dynasty table opens on him. */
function elsewhere(row: SnakeRow): Array<{ href: string; label: string }> {
  return row.fx && fantraxLeague
    ? [{ href: leaguePlayerPath(fantraxLeague.slug, row.fx), label: `${fantraxLeague.shortName} › Joueurs` }]
    : [];
}

function cellsFor(board: DraftBoard): Record<string, (r: CategoryRow, ctx: CategoryCtx) => CellOut> {
  const out: Record<string, (r: CategoryRow, ctx: CategoryCtx) => CellOut> = {
    rang: (r, ctx) => ({ node: displayRank(r, ctx.rankPos), className: "text-slate-400" }),
    vor: (r) => ({ node: formatFr(r.vor, 1), className: "font-semibold text-cyan-200" }),
    valeur: (r) => ({ node: formatFr(r.value, 1), className: MUTED }),
    cats: (r, ctx) => ({
      node: (
        <CategoryMiniBars categories={r.goalie ? ctx.goalieCategories : ctx.skaterCategories} z={r.zRel} proj={r.proj} />
      ),
      className: "py-1",
    }),
    adp: (r) => ({ node: r.adp !== null ? formatFr(r.adp, 0) : "—", className: MUTED }),
    dispo: (r) => ({ node: r.available !== null ? formatPercentFr(r.available) : "—", className: oddsTone(r.available) }),
    statut: (r, ctx) => ({
      node: categoryStatusText(r, ctx.done),
      className: `whitespace-nowrap ${r.pick ? (r.pick.mine ? "font-medium text-cyan-200" : "text-slate-400") : "text-emerald-200/90"}`,
    }),
    gp: (r) => ({ node: r.gp, className: MUTED }),
    age: (r) => ({ node: r.age ?? "—", className: MUTED }),
    verdict: (r) => {
      const s = r.snake;
      if (!s) return { node: "—", className: "text-slate-400" };
      return {
        className: "whitespace-nowrap",
        node: (
          <Link
            href={snakePlayerHref(s.key)}
            prefetch={false}
            className={`inline-flex min-h-11 items-center gap-1 rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${VERDICT_TONE[s.verdict] ?? MUTED}`}
          >
            {s.verdict}
            {s.probable ? <span aria-hidden="true">?</span> : null}
            <span className="sr-only">
              {s.probable ? " (attribution probable)" : ""} : fiche Snake de {r.name}
            </span>
          </Link>
        ),
      };
    },
    tendance: (r) => ({ node: r.snake?.trend ?? "—", className: `whitespace-nowrap ${MUTED}` }),
  };
  for (const c of boardCategories(board)) {
    out[categoryColumnKey(c)] = (r) => {
      const v = categoryCell(board, r, c);
      if (!v) return { node: "—", className: "text-slate-400" };
      return {
        node: (
          <span title={`Cote z ${formatSignedFr(v.z)}`}>
            {formatStat(c, v.proj)}
            <span className="sr-only">, cote z {formatSignedFr(v.z)}</span>
          </span>
        ),
        className: zTone(v.z),
      };
    };
  }
  return out;
}

/** Name, club and positions (the row header), the pick when « Statut » is hidden, the odds on phones. */
function CategoryNameCell({ row: r, ctx, query, visible }: NameCellProps<CategoryRow, CategoryCtx>) {
  return (
    <>
      <span className="block max-w-[9rem] break-words font-medium text-white sm:max-w-[16rem] sm:truncate" title={r.name}>
        {highlightMatch(r.name, query)}
      </span>
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-400">
        <span className="whitespace-nowrap">{r.team}</span>
        <DraftPositionBadges positions={r.pos} vorPos={r.vorPos} />
        {!visible.includes("statut") && r.pick ? (
          <span className={r.pick.mine ? "text-cyan-300" : "text-slate-400"}>{categoryStatusText(r, ctx.done)}</span>
        ) : null}
      </span>
      {/* Phones: the odds sit under the name (the column hides below sm). */}
      {visible.includes("dispo") && r.available !== null && ctx.oddsPick !== null ? (
        <span className={`mt-0.5 block whitespace-nowrap text-xs tabular-nums sm:hidden ${oddsTone(r.available)}`}>
          Dispo. au {pickLabel(ctx.oddsPick)} : {formatPercentFr(r.available)}
        </span>
      ) : null}
    </>
  );
}

function ordinal(n: number): string {
  return n === 1 ? "1er" : `${n}e`;
}

/** Details row: league facts, the projected line category by category, then Snake's take. */
function detailFor(board: DraftBoard) {
  return function CategoryDetail({ row: r, ctx, idPrefix }: { row: CategoryRow; ctx: CategoryCtx; idPrefix: string }) {
    const cats = r.goalie ? board.categories.goalie : board.categories.skater;
    const posRanks = Object.entries(r.posRank)
      .map(([p, n]) => `${p} ${ordinal(n)}`)
      .join(" · ");
    const items: Array<[string, string]> = [
      ["Équipe", r.team || "—"],
      ["Positions Yahoo", `${r.pos.join(", ")}${r.pos.length > 1 ? ` (VOR mesurée à ${r.vorPos})` : ""}`],
      ["Rang", `${ordinal(r.rank)} dans la ligue${posRanks ? ` · ${posRanks}` : ""}`],
      ["Valeur · VOR", `${formatFr(r.value, 2)} · ${formatFr(r.vor, 2)}`],
      ["ADP (Fantrax)", r.adp !== null ? formatFr(r.adp, 1) : "aucune (les chances utilisent son rang)"],
      ["Matchs projetés", String(r.gp)],
    ];
    if (r.age !== null) items.push(["Âge", yearsLabel(r.age)]);
    items.push(["Repêchage (cet appareil)", categoryStatusText(r, ctx.done)]);
    if (r.available !== null && ctx.oddsPick !== null) {
      items.push([`Dispo. au ${pickLabel(ctx.oddsPick)}`, formatPercentFr(r.available)]);
    }
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
        <h3 className="mt-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Projection par catégorie</h3>
        <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {cats.map((c, i) => (
            <li key={c} className="flex min-w-0 items-baseline gap-2">
              <abbr title={CATEGORY_FR[c]} className="w-10 shrink-0 text-xs text-slate-400 no-underline">
                {CATEGORY_SHORT[c]}
              </abbr>
              <span className="tabular-nums text-slate-100">{formatStat(c, r.proj[i] ?? 0)}</span>
              <span className={`text-xs tabular-nums ${zTone(r.zRel[i] ?? 0)}`}>
                {formatSignedFr(r.zRel[i] ?? 0)} z<span className="sr-only"> par rapport à ses pairs</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-slate-400">z : écart avec ses pairs (attaquants, défenseurs ou gardiens), comme les barres.</p>
        {r.snake ? (
          <SnakeDetail
            snakeKey={r.snake.key}
            verdict={r.snake.verdict}
            trend={r.snake.trend}
            probable={r.snake.probable}
            idPrefix={idPrefix}
            elsewhere={elsewhere}
          />
        ) : null}
      </>
    );
  };
}

type Adapter = TableAdapter<CategoryRow, CategoryFilters, CategoryCaps, CategoryCtx>;
const adapters = new WeakMap<DraftBoard, Adapter>();

/** The category adapter of a board (its category columns follow the league). */
export function categoryAdapter(board: DraftBoard): Adapter {
  let a = adapters.get(board);
  if (!a) {
    a = {
      spec: categoryTable(board),
      Filters: CategoryTableFilters,
      NameCell: CategoryNameCell,
      cells: cellsFor(board),
      Detail: detailFor(board),
      rowClass: (r) => (r.pick?.mine ? "bg-cyan-500/[0.05]" : undefined),
    };
    adapters.set(board, a);
  }
  return a;
}

const TICK_MS = 60_000;

/** "Now", from effects only (React purity): null until mounted. */
function useNowMs(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, TICK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);
  return now;
}

const noop = () => {};

export interface CategoryTableSource {
  data: TableData<CategoryRow, CategoryCaps, CategoryCtx>;
  done: boolean;
  mine: number;
}

/**
 * The table's data: the board inlined in the page, the draft marked on
 * this device (the draft helper's store and storage key, read only, kept
 * in sync with the other tabs) and Snake's verdicts from the page's seed.
 * Nothing is fetched.
 */
export function useCategoryTableData(board: DraftBoard): CategoryTableSource {
  const store = getDraftStore(board.slug, board.league.teams);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const nowMs = useNowMs();
  const timeline = useMemo(() => draftTimeline(board, state), [board, state]);
  const done = draftDone(board.league, state, nowMs);
  const oddsPick = oddsPickOf(timeline, done);
  const { rows: snake } = useSnakeNhlRows();
  const rows = useMemo(
    () => buildCategoryRows(board, { state, currentPick: timeline.currentPick, oddsPick, snake }),
    [board, state, timeline.currentPick, oddsPick, snake],
  );
  const hasSnake = !!snake && Object.keys(snake).length > 0;
  const caps = useMemo<CategoryCaps>(() => ({ odds: oddsPick !== null, done, snake: hasSnake }), [oddsPick, done, hasSnake]);
  const ctx = useMemo<CategoryCtx>(
    () => ({
      rankPos: "ALL",
      done,
      oddsPick,
      skaterCategories: board.categories.skater,
      goalieCategories: board.categories.goalie,
    }),
    [done, oddsPick, board],
  );
  const labels = useMemo(() => categoryLabels(snake), [snake]);
  const data = useMemo<TableData<CategoryRow, CategoryCaps, CategoryCtx>>(
    () => ({
      rows,
      status: "ready",
      extras: { snake: true, dynasty: true, snakeFull: true },
      caps,
      ctx,
      labels,
      total: board.players.length,
      want: noop,
      wantFullSnake: noop,
      retry: noop,
    }),
    [rows, caps, ctx, labels, board],
  );
  const mine = useMemo(() => rows.filter((r) => r.pick?.mine).length, [rows]);
  return { data, done, mine };
}

export interface CategoryPlayerTableProps {
  board: DraftBoard;
  id: string;
  title: string;
  description?: ReactNode;
  base: CategoryPresetId;
  presets: readonly CategoryPresetId[];
  perPage: number;
  footer?: ReactNode;
  /** The pool size next to the title (only where the title names the whole list). */
  showTotal?: boolean;
  /** From `useCategoryTableData` when the tab reads it too. */
  source?: CategoryTableSource;
}

function TableWithData({ source, ...p }: CategoryPlayerTableProps & { source: CategoryTableSource }) {
  return (
    <PlayerTable
      id={p.id}
      title={p.title}
      description={p.description}
      adapter={categoryAdapter(p.board)}
      data={source.data}
      base={p.base}
      presets={p.presets}
      perPage={p.perPage}
      footer={p.footer}
      showTotal={p.showTotal}
    />
  );
}

function TableOwnData(p: CategoryPlayerTableProps) {
  const source = useCategoryTableData(p.board);
  return <TableWithData {...p} source={source} />;
}

/**
 * A categories league tab's player table: the unified PlayerTable with the
 * category adapter, starting from the tab's view (`base`). Needs a
 * `SnakeVerdictsProvider kind="nhl"` above it.
 */
export function CategoryPlayerTable(p: CategoryPlayerTableProps) {
  return p.source ? <TableWithData {...p} source={p.source} /> : <TableOwnData {...p} />;
}

/** Light the Lamp · Joueurs: the whole board, valued for the league (the Snake seed covers it: no fetch). */
export function CategoryPlayersTable({ board, seed }: { board: DraftBoard; seed: SnakeNhlFile["rows"] }) {
  return (
    <SnakeVerdictsProvider kind="nhl" seed={seed} complete>
      <CategoryPlayerTable
        board={board}
        id="joueurs"
        title="Liste des joueurs"
        description="Une colonne par catégorie au besoin (Colonnes). La vue (filtres, tri, colonnes) est gardée dans l’adresse de la page."
        base="tous"
        presets={["tous", "disponibles", "equipe"]}
        perPage={50}
        showTotal
      />
    </SnakeVerdictsProvider>
  );
}
