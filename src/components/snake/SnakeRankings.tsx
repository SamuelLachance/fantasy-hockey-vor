"use client";

import { ExternalLink, Trophy } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { loadSnakeRankings } from "@/lib/snake/client";
import { formatCountFr, formatSnakeDate, plural, seasonOf } from "@/lib/snake/copy";
import { queryTokens } from "@/lib/snake/filters";
import { normalizePlayerName } from "@/lib/snake/resolve";
import type { SnakeRanking, SnakeRankingsFile } from "@/lib/snake/types";
import { formatClock, snakeSearch, youtubeHref } from "@/lib/snake/url";

const PAGE = 12;
const SELECT_CLASS =
  "min-h-11 w-full rounded-xl border border-white/15 bg-slate-900 px-3 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400";

function rankingMatches(r: SnakeRanking, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = `${normalizePlayerName(r.ti)} ${r.e.map((e) => normalizePlayerName(e[1])).join(" ")}`;
  return tokens.every((t) => hay.includes(t));
}

const rankingHeadingId = (i: number) => `snake-classement-${i}`;

/**
 * « Classements de Snake »: every ranking he gave, newest first. Loaded
 * lazily: only once `armed` (the page's own data is in, so this section is
 * pushed well below the fold) and the section nears the viewport.
 */
export function SnakeRankings({
  armed,
  onOpenPlayer,
}: {
  armed: boolean;
  /** `returnId`: the link's DOM id, so closing the player returns focus to it. */
  onOpenPlayer: (key: string, returnId: string) => void;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [wanted, setWanted] = useState(false);
  const [data, setData] = useState<SnakeRankingsFile | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState("");
  const [season, setSeason] = useState("");
  const [shown, setShown] = useState(PAGE);
  const deferredQuery = useDeferredValue(query);
  const focusFromRef = useRef<number | null>(null);

  // Load when the section gets near the viewport (after the page's own data:
  // before that, the short skeleton puts this section within reach on load).
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
      { rootMargin: "200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [wanted, armed]);

  useEffect(() => {
    const from = focusFromRef.current;
    if (from === null) return;
    focusFromRef.current = null;
    document.getElementById(rankingHeadingId(from))?.focus();
  }, [shown]);

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    loadSnakeRankings().then(
      (d) => {
        if (!cancelled) {
          setData(d);
          setFailed(false);
        }
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [wanted, attempt]);

  const shows = useMemo(() => [...new Set((data?.rankings ?? []).map((r) => r.sh))].sort(), [data]);
  const seasons = useMemo(
    () => [...new Set((data?.rankings ?? []).map((r) => seasonOf(r.d)))].sort().reverse(),
    [data],
  );
  const list = useMemo(() => {
    const tokens = queryTokens(deferredQuery);
    return (data?.rankings ?? []).filter(
      (r) => (!show || r.sh === show) && (!season || seasonOf(r.d) === season) && rankingMatches(r, tokens),
    );
  }, [data, deferredQuery, show, season]);

  const resetPage = () => setShown(PAGE);

  return (
    <section ref={sectionRef} id="classements" aria-labelledby="classements-titre" className="scroll-mt-4 space-y-4">
      <div className="flex items-center gap-2 text-amber-200">
        <Trophy className="h-5 w-5" aria-hidden="true" />
        <h2 id="classements-titre" className="text-2xl font-semibold text-white">
          Classements de Snake
        </h2>
      </div>
      <p className="max-w-3xl text-sm text-slate-400">
        {
          "Les listes et rangs qu'il a donnés en ondes (repêchages, trophées, meilleurs espoirs…), extraits automatiquement. Une liste peut être partielle ou approximative : vérifiez dans la vidéo."
        }
      </p>

      {!data ? (
        failed ? (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100" role="alert">
            <p>Les classements n&apos;ont pas pu être chargés.</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-rose-300/40 px-4 font-semibold text-rose-50 hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
            >
              Réessayer
            </button>
          </div>
        ) : wanted ? (
          <p role="status" className="text-sm text-slate-400">
            Chargement des classements…
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setWanted(true)}
            className="inline-flex min-h-11 items-center rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-semibold text-slate-200 hover:border-cyan-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            Afficher les classements
          </button>
        )
      ) : (
        <>
          <form role="search" aria-label="Filtrer les classements" onSubmit={(e) => e.preventDefault()} className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-slate-400">
              Joueur ou sujet
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  resetPage();
                }}
                placeholder="Ex. : Calder, repêchage 2026, Hutson…"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                className="min-h-11 w-full rounded-xl border border-white/15 bg-slate-900 px-3 text-base text-white placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 sm:text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-400">
              Émission
              <select
                className={SELECT_CLASS}
                value={show}
                onChange={(e) => {
                  setShow(e.target.value);
                  resetPage();
                }}
              >
                <option value="">Toutes</option>
                {shows.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-400">
              Saison
              <select
                className={SELECT_CLASS}
                value={season}
                onChange={(e) => {
                  setSeason(e.target.value);
                  resetPage();
                }}
              >
                <option value="">Toutes</option>
                {seasons.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </form>
          <p role="status" className="text-sm text-slate-400">
            {plural(list.length, "classement", "classements")}
          </p>
          <ul className="grid gap-3 md:grid-cols-2">
            {list.slice(0, shown).map((r, ri) => {
              // Order of mention, not a ranking: no numbers.
              const Items = r.u ? "ul" : "ol";
              return (
              <li key={`${r.vid}-${r.ti}`} className="flex flex-col rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <h3
                  id={rankingHeadingId(ri)}
                  tabIndex={-1}
                  className="text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
                >
                  {r.ti}
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  <time dateTime={r.d}>{formatSnakeDate(r.d)}</time> · <span className="text-cyan-200">{r.sh}</span>
                </p>
                <Items className="mt-3 space-y-1 text-sm">
                  {r.e.map(([rank, name, key], i) => (
                    <li key={i} className="flex items-baseline gap-2">
                      <span className="w-8 shrink-0 text-right font-mono tabular-nums text-slate-400" aria-hidden={r.u ? true : undefined}>
                        {r.u ? "•" : `${rank}.`}
                      </span>
                      {key ? (
                        <a
                          id={`snake-rang-${r.vid}-${ri}-${i}`}
                          href={snakeSearch("", key)}
                          onClick={(e) => {
                            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                            e.preventDefault();
                            onOpenPlayer(key, e.currentTarget.id);
                          }}
                          className="rounded-sm text-cyan-300 underline-offset-2 hover:text-cyan-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
                        >
                          {name}
                        </a>
                      ) : (
                        <span className="text-slate-200">{name}</span>
                      )}
                    </li>
                  ))}
                </Items>
                {r.u ? <p className="mt-2 text-xs text-slate-400">Noms dans l&apos;ordre où il les cite, sans classement.</p> : null}
                <p className="mt-auto pt-3 text-xs">
                  <a
                    href={youtubeHref(r.vid, r.t)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-sm text-cyan-400 underline-offset-2 hover:text-cyan-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
                  >
                    {r.t > 0 ? `Écouter à ${formatClock(r.t)}` : "Moment non repéré : voir la vidéo depuis le début"}
                    <span className="sr-only"> : {r.vt} (YouTube, nouvel onglet)</span>
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                  <span className="mt-0.5 block break-words text-slate-400" aria-hidden="true">
                    {r.vt}
                  </span>
                </p>
              </li>
              );
            })}
          </ul>
          {list.length > shown ? (
            <button
              type="button"
              onClick={() => {
                focusFromRef.current = shown;
                setShown((n) => n + PAGE);
              }}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-semibold text-slate-200 transition motion-reduce:transition-none hover:border-cyan-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Afficher {formatCountFr(Math.min(PAGE, list.length - shown))} classements de plus (sur{" "}
              {formatCountFr(list.length - shown)} restants)
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
