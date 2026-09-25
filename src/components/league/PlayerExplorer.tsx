"use client";

import { ChevronLeft, ChevronRight, ListFilter } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DailyPlan } from "@/lib/fantrax/daily-plan";
import {
  buildExplorerRows,
  clampPage,
  DEFAULT_VIEW,
  effectiveView,
  explorerDraft,
  explorerPresets,
  explorerSearch,
  filterRows,
  hasExplorerParams,
  matchesPreset,
  needsExtras,
  nextSort,
  pageCount,
  parseExplorerParams,
  PER_PAGE_OPTIONS,
  presetFromSearch,
  presetView,
  sameExplorerSearch,
  sortRows,
  type ColumnKey,
  type ExplorerCapabilities,
  type ExplorerFilters as Filters,
  type ExplorerPreset,
  type ExplorerView,
  type PresetId,
  type SortKey,
} from "@/lib/fantrax/explorer";
import { counterText, explorerNote, fmtInt } from "@/lib/fantrax/explorer-copy";
import type { DynastyIndex, SnakeIndex } from "@/lib/fantrax/explorer-extras";
import { loadExplorerExtras, loadExplorerPool, type LeagueSnapshotBundle } from "@/lib/fantrax/league-client";
import { withLiveOverlay, type LiveOverlay } from "@/lib/fantrax/live";
import type { PoolSnapshot } from "@/lib/fantrax/pool";
import { ExplorerFilters, SEARCH_INPUT_ID } from "./ExplorerFilters";
import { ExplorerTable } from "./ExplorerTable";
import { LeagueCard } from "./LeagueCard";

export interface ExplorerRequest {
  preset: PresetId;
  /** Bumped on every click, so the same preset can be asked for twice. */
  seq: number;
}

interface PlayerExplorerProps {
  plan: DailyPlan | null;
  bundle: LeagueSnapshotBundle | null;
  live: LiveOverlay | null;
  teamId: string;
  teams: Array<{ id: string; name: string }>;
  teamName: (id: string) => string;
  /** A preset asked for by another panel (« voir dans l'explorateur »). */
  request: ExplorerRequest | null;
  /**
   * The panels above have rendered. Until then the explorer sits right under
   * a one-line « Chargement » and would look "near the viewport" at once.
   */
  armed: boolean;
}

/** Tells the explorer the URL is readable (inside Suspense, as static export requires). */
function ExplorerUrlReader({ onRead }: { onRead: () => void }) {
  const params = useSearchParams();
  const search = params.toString();
  useEffect(() => {
    onRead();
  }, [search, onRead]);
  return null;
}

const URL_WRITE_DELAY_MS = 300;
/** Quiet time before the result count is announced (typing a name, several clicks). */
const ANNOUNCE_DELAY_MS = 600;
const EMPTY_FIELDS: ReadonlySet<string> = new Set();

type LoadState = "idle" | "loading" | "ready" | "error";

/**
 * « Explorateur de joueurs »: every relevant Fantrax player (projected or
 * prospect) with free filters, sorts, column choice and pages, bookmarked
 * in the URL. The pool loads when the section nears the viewport, when the
 * URL asks for a view, or when another panel links here; the optional
 * dynasty and Snake files merge in as they arrive. Statuses and draft odds
 * follow the live read.
 */
export function PlayerExplorer({ plan, bundle, live, teamId, teams, teamName, request, armed }: PlayerExplorerProps) {
  const [view, setView] = useState<ExplorerView>(DEFAULT_VIEW);
  const [wanted, setWanted] = useState(false);
  const [pool, setPool] = useState<PoolSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [dynasty, setDynasty] = useState<DynastyIndex | null>(null);
  const [snake, setSnake] = useState<SnakeIndex | null>(null);
  const [extrasIn, setExtrasIn] = useState({ dynasty: false, snake: false });
  const [expanded, setExpanded] = useState<string | null>(null);
  /** A preset to apply once the pool is in (a `?vue=` link or another panel). */
  const [pending, setPending] = useState<{ preset: PresetId; seq: number } | null>(null);
  /** Bumped by the user's own actions: only those announce the result count. */
  const [announceSeq, setAnnounceSeq] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const sectionRef = useRef<HTMLElement | null>(null);
  const resultsRef = useRef<HTMLParagraphElement | null>(null);
  const hydrated = useRef(false);
  const announced = useRef(0);
  /** The last preset applied, so a later version of it (dynasty data in) can replace it. */
  const applied = useRef<ExplorerPreset | null>(null);
  const bump = useCallback(() => setAnnounceSeq((n) => n + 1), []);

  // ---- URL → view (first read, then Back / Forward)
  const readUrl = useCallback(() => {
    const search = window.location.search;
    hydrated.current = true;
    setView(parseExplorerParams(new URLSearchParams(search)));
    if (hasExplorerParams(search)) setWanted(true);
    const preset = presetFromSearch(search);
    if (preset) setPending((p) => ({ preset, seq: (p?.seq ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    window.addEventListener("popstate", readUrl);
    return () => window.removeEventListener("popstate", readUrl);
  }, [readUrl]);

  // ---- view → URL (native History API: Next's patched replaceState
  // soft-navigates and scrolls to top on static export). Debounced: Safari
  // refuses more than ~100 history writes per 30 s.
  useEffect(() => {
    if (!hydrated.current) return;
    const id = window.setTimeout(() => {
      // Same view already in the address bar (maybe in another key order): leave it.
      if (sameExplorerSearch(view, window.location.search)) return;
      const search = explorerSearch(view, window.location.search);
      try {
        const url = `${window.location.pathname}${search}${window.location.hash}`;
        History.prototype.replaceState.call(window.history, window.history.state, "", url);
      } catch {
        // Sandboxed frames can refuse history writes; the view still applies.
      }
    }, URL_WRITE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [view]);

  // ---- load on demand: near the viewport, once the page above is in place
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || wanted || !armed) return;
    if (typeof IntersectionObserver === "undefined") {
      const id = window.setTimeout(() => setWanted(true), 0);
      return () => window.clearTimeout(id);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setWanted(true);
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [wanted, armed]);

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    loadExplorerPool().then(
      (p) => {
        if (cancelled) return;
        setPool(p);
        setFailed(false);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    const extras = loadExplorerExtras();
    extras.dynasty.then((d) => {
      if (cancelled) return;
      setDynasty(d);
      setExtrasIn((x) => ({ ...x, dynasty: true }));
    });
    extras.snake.then((s) => {
      if (cancelled) return;
      setSnake(s);
      setExtrasIn((x) => ({ ...x, snake: true }));
    });
    return () => {
      cancelled = true;
    };
  }, [wanted, attempt]);

  const loadState: LoadState = pool ? "ready" : failed ? "error" : wanted ? "loading" : "idle";

  // ---- rows
  const state = useMemo(() => (bundle ? withLiveOverlay(bundle.state, live) : null), [bundle, live]);
  const baseLineup = plan?.teamId === teamId ? plan.baseLineup : null;
  const draft = useMemo(
    () => (pool && state && bundle ? explorerDraft(state, bundle.values, teamId, baseLineup) : null),
    [pool, state, bundle, teamId, baseLineup],
  );
  const rows = useMemo(
    () =>
      pool
        ? buildExplorerRows({ pool, state, values: bundle?.values ?? null, baseLineup, draft, dynasty, snake })
        : [],
    [pool, state, bundle, baseLineup, draft, dynasty, snake],
  );

  const draftOpen = !!draft;
  const nextPick = draft?.next?.pick ?? null;
  const caps: ExplorerCapabilities = useMemo(
    () => ({
      draft: !!draft?.next,
      dynasty: dynasty?.fields ?? EMPTY_FIELDS,
      snake: !!snake,
      snakeOpinions: !!snake?.hasOpinions,
    }),
    [draft, dynasty, snake],
  );
  const presets = useMemo(() => explorerPresets(caps), [caps]);
  const teamIds = useMemo(() => teams.map((t) => t.id), [teams]);

  // What the view really does with this data (a bookmark may name more).
  const effective = useMemo(
    () =>
      effectiveView(view, {
        caps,
        teamIds,
        labels: { phases: dynasty?.phases ?? [], verdicts: snake?.verdicts ?? [], trends: snake?.trends ?? [] },
      }),
    [view, caps, teamIds, dynasty, snake],
  );
  const shownView = useMemo(
    () => ({ ...view, filters: effective.filters, sort: effective.sort }),
    [view, effective],
  );
  // A view that filters or sorts on dynasty / Snake data waits for those files.
  const waitingExtras = needsExtras(view) && !(extrasIn.dynasty && extrasIn.snake);
  const showRows = loadState === "ready" && !waitingExtras;

  const sorted = useMemo(
    () => sortRows(filterRows(rows, effective.filters, { teamId }), effective.sort),
    [rows, effective, teamId],
  );
  const pages = pageCount(sorted.length, view.perPage);
  const page = clampPage(view.page, sorted.length, view.perPage);
  const pageRows = sorted.slice((page - 1) * view.perPage, page * view.perPage);
  const nhlTeams = useMemo(() => [...new Set(rows.map((r) => r.team).filter(Boolean))].sort(), [rows]);

  // ---- actions (each announces the new count)
  const applyPreset = useCallback((p: ExplorerPreset) => {
    applied.current = p;
    setView((v) => presetView(p, v));
    setExpanded(null);
  }, []);
  const onFilters = useCallback(
    (patch: Partial<Filters>) => {
      setView((v) => ({ ...v, filters: { ...v.filters, ...patch }, page: 1 }));
      bump();
    },
    [bump],
  );
  const effectiveSort = effective.sort;
  const onSort = useCallback(
    (key: SortKey) => {
      // From the sort on screen, which may be a fallback of the URL's.
      setView((v) => ({ ...v, sort: nextSort(effectiveSort, key), page: 1 }));
      bump();
    },
    [effectiveSort, bump],
  );
  const onPreset = useCallback(
    (p: ExplorerPreset) => {
      applyPreset(p);
      setWanted(true);
      bump();
    },
    [applyPreset, bump],
  );
  const onReset = useCallback(() => {
    applied.current = null;
    setView((v) => ({ ...DEFAULT_VIEW, cols: v.cols, perPage: v.perPage }));
    bump();
  }, [bump]);
  const onColumns = useCallback((cols: ColumnKey[]) => setView((v) => ({ ...v, cols })), []);
  const goTo = (n: number) => {
    setView((v) => ({ ...v, page: n }));
    setExpanded(null);
    bump();
    resultsRef.current?.scrollIntoView({ block: "nearest" });
  };
  const retry = () => {
    setFailed(false);
    setAttempt((n) => n + 1);
    bump();
    // The button goes away while loading: keep focus in the section.
    document.getElementById("explorateur-titre")?.focus({ preventScroll: true });
  };

  // ---- a preset asked for by another panel: jump now, apply once the pool is in
  const lastRequest = useRef(0);
  useEffect(() => {
    if (!request || request.seq === lastRequest.current) return;
    const id = window.setTimeout(() => {
      lastRequest.current = request.seq;
      setWanted(true);
      setPending({ preset: request.preset, seq: request.seq });
      bump();
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      sectionRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      document.getElementById("explorateur-titre")?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(id);
  }, [request, bump]);

  // Presets are resolved with the data on hand (their sort can depend on it).
  useEffect(() => {
    if (!pending || loadState === "idle" || loadState === "loading") return;
    const p = presets.find((x) => x.id === pending.preset);
    const id = window.setTimeout(() => {
      setPending(null);
      if (p) applyPreset(p);
    }, 0);
    return () => window.clearTimeout(id);
  }, [pending, loadState, presets, applyPreset]);

  // Dynasty data arriving after a preset was applied changes that preset
  // (prospects by dynasty value): follow it while the view is untouched.
  useEffect(() => {
    const old = applied.current;
    if (!old) return;
    const next = presets.find((x) => x.id === old.id);
    if (!next || matchesPreset({ ...DEFAULT_VIEW, filters: next.filters, sort: next.sort }, old)) return;
    const id = window.setTimeout(() => {
      applied.current = next;
      setView((v) => (matchesPreset(v, old) ? { ...v, filters: { ...next.filters }, sort: { ...next.sort } } : v));
    }, 0);
    return () => window.clearTimeout(id);
  }, [presets]);

  const counter =
    loadState === "ready"
      ? waitingExtras
        ? "Chargement des données dynastie et Snake…"
        : counterText(sorted.length, page, pages, effective.sort)
      : loadState === "error"
        ? "Impossible de charger les joueurs."
        : loadState === "loading"
          ? "Chargement des joueurs…"
          : "";

  // Screen readers hear the count after the user's own changes only: never
  // for the 90 s draft polling or the load itself.
  useEffect(() => {
    if (announceSeq === announced.current || pending) return;
    if (loadState === "idle" || loadState === "loading" || waitingExtras) return;
    const id = window.setTimeout(() => {
      announced.current = announceSeq;
      setAnnouncement((prev) => (prev === counter ? `${counter} ` : counter));
    }, ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [announceSeq, counter, loadState, waitingExtras, pending]);

  const caption = `Joueurs de la ligue, ${counter}. Les en-têtes de colonnes trient le tableau.`;
  const pagerButton =
    "inline-flex min-h-11 items-center gap-1 rounded-xl border border-white/15 bg-white/5 px-3 font-medium hover:border-cyan-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:border-white/15";

  return (
    <LeagueCard
      id="explorateur"
      icon={<ListFilter className="h-5 w-5" />}
      title="Explorateur de joueurs"
      accentClass="text-cyan-300"
      focusableHeading
      sectionRef={sectionRef}
      description="Tous les joueurs pertinents de la ligue, espoirs compris : filtrez, triez et choisissez vos colonnes. La vue est gardée dans l'adresse de la page, pour la mettre en favori ou la partager."
      headerExtra={
        pool ? <span className="text-xs tabular-nums text-slate-400">{fmtInt(pool.counts.total)} joueurs</span> : null
      }
    >
      <Suspense fallback={null}>
        <ExplorerUrlReader onRead={readUrl} />
      </Suspense>

      <ExplorerFilters
        view={shownView}
        caps={caps}
        presets={presets}
        teams={teams}
        teamId={teamId}
        nhlTeams={nhlTeams}
        phases={dynasty?.phases ?? []}
        verdicts={snake?.verdicts ?? []}
        trends={snake?.trends ?? []}
        draftOpen={draftOpen}
        nextPick={nextPick}
        onFilters={onFilters}
        onPreset={onPreset}
        onReset={onReset}
        onColumns={onColumns}
        visible={effective.columns}
      />

      <div className="mt-4">
        {/* The visible counter follows the data (live picks included); the
            polite status below only speaks after the user's own changes. */}
        <p ref={resultsRef} className="mb-2 scroll-mt-4 text-sm font-medium text-slate-300">
          {counter}
        </p>
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {loadState === "error" ? (
          <button
            type="button"
            onClick={retry}
            className="inline-flex min-h-11 items-center rounded-xl border border-rose-300/40 px-4 text-sm font-semibold text-rose-50 hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
          >
            Réessayer
          </button>
        ) : null}

        {showRows && sorted.length > 0 ? (
          <ExplorerTable
            rows={pageRows}
            columns={effective.columns}
            sort={effective.sort}
            onSort={onSort}
            nextPick={nextPick}
            teamId={teamId}
            draftOpen={draftOpen}
            teamName={teamName}
            expanded={expanded}
            onToggle={(id) => setExpanded((e) => (e === id ? null : id))}
            caption={caption}
          />
        ) : null}

        {showRows && sorted.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-300">
            <p>Essayez d&apos;élargir les filtres.</p>
            <button
              type="button"
              onClick={() => {
                onReset();
                // This button goes away with the empty state: keep focus in the form.
                window.setTimeout(() => document.getElementById(SEARCH_INPUT_ID)?.focus(), 0);
              }}
              className="mt-2 inline-flex min-h-11 items-center rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 font-semibold text-cyan-100 hover:bg-cyan-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Réinitialiser les filtres
            </button>
          </div>
        ) : null}

        {showRows && sorted.length > 0 ? (
          <nav
            aria-label="Pages de résultats"
            className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300"
          >
            <div className="flex items-center gap-2">
              {/* aria-disabled, not disabled: a disabled button drops the
                  keyboard focus to <body> on the first or last page. */}
              <button
                type="button"
                onClick={() => {
                  if (page > 1) goTo(page - 1);
                }}
                aria-disabled={page <= 1 || undefined}
                className={pagerButton}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Précédente
              </button>
              <span className="tabular-nums text-slate-400">
                Page {page} sur {pages}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (page < pages) goTo(page + 1);
                }}
                aria-disabled={page >= pages || undefined}
                className={pagerButton}
              >
                Suivante
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <label className="flex items-center gap-2 text-slate-400">
              Par page
              <select
                value={view.perPage}
                onChange={(e) => {
                  setView((v) => ({ ...v, perPage: Number(e.target.value), page: 1 }));
                  bump();
                }}
                className="min-h-11 rounded-xl border border-white/15 bg-slate-900 px-3 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                {PER_PAGE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </nav>
        ) : null}

        {pool ? (
          <p className="mt-3 text-xs text-slate-500">
            {explorerNote({
              draftOpen,
              nextPick,
              poolAsOf: pool.fetchedAt,
              counts: pool.counts,
              recentDrafts: pool.recentDrafts,
              dynasty: !!dynasty,
              snake: !!snake,
            })}
          </p>
        ) : null}
      </div>
    </LeagueCard>
  );
}
