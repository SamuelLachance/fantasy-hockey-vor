"use client";

import { Users } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useDocumentLang } from "@/hooks/useDocumentLang";
import { loadSnakeIndex } from "@/lib/snake/client";
import { formatCountFr, formatSnakeDate, plural, positionLabel } from "@/lib/snake/copy";
import {
  DEFAULT_SNAKE_FILTERS,
  filterSnakeRows,
  seasonsInRows,
  sortSnakeItems,
  teamsInRows,
  type SnakeFilterState,
} from "@/lib/snake/filters";
import type { SnakeIndexFile, SnakeListRow } from "@/lib/snake/types";
import { snakeKeyFromSearch, snakeSearch } from "@/lib/snake/url";
import { SnakeProbableMark, SnakeTrendBadge, SnakeVerdictChip } from "./SnakeBadges";
import { SnakeFilters } from "./SnakeFilters";
import { SnakePlayerDetail } from "./SnakePlayerDetail";
import { SnakeRankings } from "./SnakeRankings";

const PAGE = 40;

type LoadState = "loading" | "ready" | "error";

/** Reads `?p=` (inside Suspense, as static export requires) and reports it up. */
function KeyFromUrl({ onKey }: { onKey: (key: string | null) => void }) {
  const params = useSearchParams();
  const p = params.get("p");
  useEffect(() => {
    onKey(p ? p.slice(0, 200) : null);
  }, [p, onKey]);
  return null;
}

/**
 * Native History API (as the board and /league do): Next's patched
 * push/replaceState soft-navigate, which remounts the page and scrolls to top
 * on static export. Next's own state object is kept (its popstate handler
 * then restores this same page instead of reloading) and carries how many
 * detail views deep this entry is, so "Retour à la liste" can go back to the
 * list entry.
 */
function writeHistory(mode: "push" | "replace", key: string | null, depth: number): void {
  try {
    const url = `${window.location.pathname}${snakeSearch(window.location.search, key)}`;
    const fn = mode === "push" ? History.prototype.pushState : History.prototype.replaceState;
    const state = { ...(window.history.state ?? {}), snakeDepth: depth };
    fn.call(window.history, state, "", url);
  } catch {
    // Sandboxed frames can refuse history writes; the view still changes.
  }
}

function historyDepth(state: unknown): number {
  const d = (state as { snakeDepth?: unknown } | null)?.snakeDepth;
  return typeof d === "number" && Number.isInteger(d) && d > 0 ? d : 0;
}

function PlayerCard({
  row,
  matches,
  filtered,
  mine,
  teamName,
  onOpen,
}: {
  row: SnakeListRow;
  matches: number;
  filtered: boolean;
  mine: boolean;
  /** The site owner's Fantrax team (named, never "my team": the page is public). */
  teamName: string;
  onOpen: (key: string) => void;
}) {
  return (
    <article className="flex h-full flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4 transition motion-reduce:transition-none hover:border-cyan-400/30">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 text-base font-semibold">
          <a
            id={`snake-carte-${row.k}`}
            href={snakeSearch("", row.k)}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              onOpen(row.k);
            }}
            className="inline-flex min-h-11 items-center break-words rounded-sm text-white underline-offset-2 hover:text-cyan-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          >
            {row.n}
          </a>
        </h3>
        <div className="flex flex-wrap items-center gap-1.5 pt-2.5">
          <SnakeVerdictChip verdict={row.v} />
          <SnakeTrendBadge trend={row.td} />
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
        <span>
          {row.pos ?? "?"}
          <span className="sr-only"> ({positionLabel(row.pos)})</span>
        </span>
        <span aria-hidden="true">·</span>
        <span>{row.tm ?? "Sans équipe LNH"}</span>
        <span aria-hidden="true">·</span>
        <span>
          {plural(row.oc, "opinion", "opinions")}
          {filtered && matches !== row.oc ? ` (${formatCountFr(matches)} dans la sélection)` : ""}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          dernière mention <time dateTime={row.ls}>{formatSnakeDate(row.ls)}</time>
        </span>
      </p>
      <p className="line-clamp-3 text-sm leading-relaxed text-slate-300">{row.s}</p>
      {row.pr || mine ? (
        <p className="mt-auto flex flex-wrap gap-1.5">
          {mine ? (
            <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-xs font-medium text-cyan-200 ring-1 ring-inset ring-cyan-400/30">
              {teamName}
            </span>
          ) : null}
          {row.pr ? <SnakeProbableMark /> : null}
        </p>
      ) : null}
    </article>
  );
}

interface SnakeExplorerProps {
  /** Fantrax ids on the user's roster (baked at the last league sync). */
  myFantraxIds: string[];
  myTeamName: string;
}

/**
 * The /snake database: search + filters + list, a player's detail view
 * (`?p=<key>`, deep-linkable on a static export), and his rankings.
 */
export function SnakeExplorer({ myFantraxIds, myTeamName }: SnakeExplorerProps) {
  useDocumentLang("fr-CA");
  const [index, setIndex] = useState<SnakeIndexFile | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [attempt, setAttempt] = useState(0);
  const [filters, setFilters] = useState<SnakeFilterState>(DEFAULT_SNAKE_FILTERS);
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<string | null>(null);
  // Move focus to the detail heading only after an in-page action (not on a
  // deep-link arrival, where the page simply starts on the detail).
  const [focusDetail, setFocusDetail] = useState(false);
  const depthRef = useRef(0);
  // Set while "Retour à la liste" walks back through our detail entries.
  const closingRef = useRef(false);
  // Where "Retour à la liste" / Back puts focus: the element that opened
  // the player (a card, or a name in a ranking) and the scroll position.
  const returnRef = useRef<{ id: string; scrollY: number } | null>(null);
  // First card revealed by "Afficher … de plus" (focus moves to it).
  const focusFromRef = useRef<number | null>(null);
  const listTopRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const deferredFilters = useDeferredValue(filters);

  const mySet = useMemo(() => new Set(myFantraxIds), [myFantraxIds]);
  const inMyTeam = useCallback((fx: string | null) => !!fx && mySet.has(fx), [mySet]);

  useEffect(() => {
    let cancelled = false;
    loadSnakeIndex().then(
      (d) => {
        if (cancelled) return;
        setIndex(d);
        setLoadState("ready");
      },
      () => {
        if (!cancelled) setLoadState("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // An old key folded into another record resolves in its own shard (no
  // wait for the index), so the detail is keyed by the URL's key as is.
  const detailKey = selected;

  const onUrlKey = useCallback((key: string | null) => setSelected(key), []);

  // Back / Forward across detail views we pushed.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      depthRef.current = historyDepth(e.state);
      const key = snakeKeyFromSearch(window.location.search);
      if (closingRef.current) {
        closingRef.current = false;
        // Landed on the arrival entry of a deep link: it still names a
        // player, and the button promised the list.
        if (key) writeHistory("replace", null, 0);
        setSelected(null);
        return;
      }
      setFocusDetail(true);
      setSelected(key);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Detail opens at its heading; closing returns to the card that opened it.
  const prevSelected = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevSelected.current;
    prevSelected.current = selected;
    if (selected && selected !== prev) {
      listTopRef.current?.scrollIntoView({ block: "start" });
    } else if (!selected && prev) {
      const ret = returnRef.current;
      returnRef.current = null;
      requestAnimationFrame(() => {
        const origin = ret ? document.getElementById(ret.id) : null;
        if (ret && origin) {
          window.scrollTo({ top: ret.scrollY });
          origin.focus({ preventScroll: true });
        } else {
          searchRef.current?.focus({ preventScroll: true });
        }
      });
    }
  }, [selected]);

  const open = useCallback(
    (key: string, returnId: string = `snake-carte-${key}`) => {
      if (!selected) returnRef.current = { id: returnId, scrollY: window.scrollY };
      depthRef.current += 1;
      writeHistory("push", key, depthRef.current);
      setFocusDetail(true);
      setSelected(key);
    },
    [selected],
  );

  const close = useCallback(() => {
    const depth = depthRef.current;
    if (depth > 0) {
      // Detail views we pushed: go back to the entry before them (popstate closes).
      closingRef.current = true;
      window.history.go(-depth);
      return;
    }
    // Opened from a link (?p= on arrival): drop the parameter in place.
    writeHistory("replace", null, 0);
    setSelected(null);
  }, []);

  const updateFilters = useCallback((patch: Partial<SnakeFilterState>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setShown(PAGE);
  }, []);

  const rows = useMemo(() => index?.rows ?? [], [index]);
  const teams = useMemo(() => teamsInRows(rows), [rows]);
  const seasons = useMemo(() => seasonsInRows(rows), [rows]);
  const myCount = useMemo(() => rows.filter((r) => r.fx && mySet.has(r.fx)).length, [rows, mySet]);
  const items = useMemo(() => {
    if (!index) return [];
    const list = filterSnakeRows(rows, deferredFilters, { refDate: index.builtAt, myFantraxIds: mySet });
    return sortSnakeItems(list, deferredFilters.sort);
  }, [index, rows, deferredFilters, mySet]);
  const showOrPeriod = deferredFilters.show >= 0 || !!deferredFilters.period;

  useEffect(() => {
    const from = focusFromRef.current;
    if (from === null) return;
    focusFromRef.current = null;
    const item = items[from];
    if (item) document.getElementById(`snake-carte-${item.row.k}`)?.focus();
  }, [shown, items]);

  return (
    <>
      <Suspense fallback={null}>
        <KeyFromUrl onKey={onUrlKey} />
      </Suspense>

      <div ref={listTopRef} className="scroll-mt-4">
        {detailKey ? (
          <SnakePlayerDetail
            key={detailKey}
            playerKey={detailKey}
            onBack={close}
            autoFocus={focusDetail}
            inMyTeam={inMyTeam}
            myTeamName={myTeamName}
          />
        ) : (
          <section id="joueurs" aria-labelledby="joueurs-titre" className="scroll-mt-4 space-y-4">
            <div className="flex items-center gap-2 text-cyan-300">
              <Users className="h-5 w-5" aria-hidden="true" />
              <h2 id="joueurs-titre" className="text-2xl font-semibold text-white">
                Joueurs
              </h2>
            </div>
            {index ? (
              <>
                <SnakeFilters
                  filters={filters}
                  onChange={updateFilters}
                  onReset={() => {
                    setFilters(DEFAULT_SNAKE_FILTERS);
                    setShown(PAGE);
                  }}
                  shows={index.shows}
                  teams={teams}
                  seasons={seasons}
                  myTeamName={myTeamName}
                  myCount={myCount}
                  searchRef={searchRef}
                  dataDate={index.builtAt.slice(0, 10)}
                />
                <p role="status" className="text-sm text-slate-300">
                  {items.length === rows.length
                    ? `${plural(items.length, "joueur", "joueurs")} au total`
                    : `${plural(items.length, "joueur trouvé", "joueurs trouvés")} sur ${formatCountFr(rows.length)}`}
                </p>
                {items.length === 0 ? (
                  <p className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-400">
                    Aucun joueur ne correspond à ces critères.
                  </p>
                ) : (
                  <ul className="grid gap-3 lg:grid-cols-2">
                    {items.slice(0, shown).map(({ row, matches }) => (
                      <li key={row.k}>
                        <PlayerCard
                          row={row}
                          matches={matches}
                          filtered={showOrPeriod}
                          mine={inMyTeam(row.fx)}
                          teamName={myTeamName}
                          onOpen={open}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                {items.length > shown ? (
                  <button
                    type="button"
                    onClick={() => {
                      focusFromRef.current = shown;
                      setShown((n) => n + PAGE);
                    }}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-semibold text-slate-200 transition motion-reduce:transition-none hover:border-cyan-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                  >
                    Afficher {formatCountFr(Math.min(PAGE, items.length - shown))} joueurs de plus (sur{" "}
                    {formatCountFr(items.length - shown)} restants)
                  </button>
                ) : null}
              </>
            ) : loadState === "error" ? (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100" role="alert">
                <p>La base de données n&apos;a pas pu être chargée.</p>
                <button
                  type="button"
                  onClick={() => {
                    setLoadState("loading");
                    setAttempt((n) => n + 1);
                  }}
                  className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-rose-300/40 px-4 font-semibold text-rose-50 hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                >
                  Réessayer
                </button>
              </div>
            ) : (
              <div role="status" aria-busy="true" className="space-y-3">
                <div className="h-11 w-full animate-pulse rounded-xl bg-white/5 motion-reduce:animate-none" />
                <div className="grid gap-3 lg:grid-cols-2">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-36 animate-pulse rounded-xl bg-white/5 motion-reduce:animate-none" />
                  ))}
                </div>
                <span className="sr-only">Chargement de la base de données…</span>
              </div>
            )}
          </section>
        )}
      </div>

      <div className="border-t border-white/10 pt-10">
        <SnakeRankings armed={loadState !== "loading"} onOpenPlayer={open} />
      </div>
    </>
  );
}
