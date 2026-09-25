"use client";

import Link from "next/link";
import { ArrowRight, ExternalLink, Mic } from "lucide-react";
import { useEffect, useState } from "react";
import { SnakeProbableMark, SnakeTrendBadge, SnakeVerdictChip } from "@/components/snake/SnakeBadges";
import { SnakeDisclaimerShort } from "@/components/snake/SnakeDisclaimer";
import { loadSnakePlayer, type SnakePlayerRecord } from "@/lib/snake/client";
import { formatSnakeDate, snakeDerivedNote } from "@/lib/snake/copy";
import { SNAKE_STANCES, SNAKE_TRENDS, type SnakeRow, type SnakeStance, type SnakeTrend } from "@/lib/snake/types";
import { formatClock, snakePlayerHref, youtubeHref } from "@/lib/snake/url";

type Load =
  | { key: string; state: "loading" }
  | { key: string; state: "error" }
  | { key: string; state: "ready"; rec: SnakePlayerRecord | null };

const LATEST = 3;

const asStance = (v: string | undefined): SnakeStance | null =>
  (SNAKE_STANCES as readonly (string | undefined)[]).includes(v) ? (v as SnakeStance) : null;
const asTrend = (v: string | undefined): SnakeTrend | null =>
  (SNAKE_TRENDS as readonly (string | undefined)[]).includes(v) ? (v as SnakeTrend) : null;

/**
 * « L’avis de Snake » in a player table's details row: his synthesis,
 * projection and latest opinions (each linked to the video at the passage),
 * loaded from the player's shard when the row opens. The verdict chips
 * paint at once from the table's own data.
 */
export function SnakeDetail({
  snakeKey,
  verdict,
  trend,
  probable = false,
  idPrefix,
  elsewhere,
}: {
  snakeKey: string;
  verdict?: string;
  trend?: string;
  probable?: boolean;
  /** Unique per row (heading id). */
  idPrefix: string;
  /** The same player in the user's other leagues (from his Snake record: Fantrax and NHL ids). */
  elsewhere?: (row: SnakeRow) => ReadonlyArray<{ href: string; label: string }>;
}) {
  const [load, setLoad] = useState<Load | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadSnakePlayer(snakeKey).then(
      (rec) => {
        if (!cancelled) setLoad({ key: snakeKey, state: "ready", rec });
      },
      () => {
        if (!cancelled) setLoad({ key: snakeKey, state: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [snakeKey, attempt]);

  const current: Load = load && load.key === snakeKey ? load : { key: snakeKey, state: "loading" };
  const rec = current.state === "ready" ? current.rec : null;
  if (current.state === "ready" && !rec) return null;
  const headingId = `${idPrefix}-snake`;
  const stance = asStance(rec?.row.v ?? verdict);
  const tendency = asTrend(rec?.row.td ?? trend);
  const latest = rec?.opinions.slice(0, LATEST) ?? [];
  const others = rec && elsewhere ? elsewhere(rec.row) : [];

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={current.state === "loading" || undefined}
      className="mt-4 max-w-3xl rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Mic className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        <h3 id={headingId} className="text-sm font-semibold text-white">
          L’avis de Snake
        </h3>
        {stance ? <SnakeVerdictChip verdict={stance} /> : null}
        {tendency ? <SnakeTrendBadge trend={tendency} /> : null}
        {(rec ? rec.row.pr : probable) ? <SnakeProbableMark /> : null}
      </div>

      {current.state === "error" ? (
        <p className="mt-2 text-sm text-slate-300">
          {"La synthèse n’a pas pu être chargée. "}
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="inline-flex min-h-11 items-center rounded-sm font-semibold text-cyan-300 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          >
            Réessayer
          </button>
        </p>
      ) : !rec ? (
        <div className="mt-3 space-y-2" aria-hidden="true">
          <div className="h-3 w-full animate-pulse rounded bg-white/10 motion-reduce:animate-none" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-white/10 motion-reduce:animate-none" />
        </div>
      ) : (
        <>
          {rec.row.dv ? <p className="mt-2 text-xs text-amber-200/90">{snakeDerivedNote(rec.row.sd, !!rec.row.pr)}</p> : null}
          <p className="mt-2 text-sm leading-relaxed text-slate-200">{rec.row.s}</p>
          {rec.row.pj ? (
            <p className="mt-2 text-sm text-slate-300">
              <span className="font-semibold text-violet-200">Projection :</span> {rec.row.pj}
            </p>
          ) : null}
          {latest.length ? (
            <>
              <h4 className="mt-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Dernières opinions</h4>
              <ul className="mt-1 space-y-2">
                {latest.map((o) => {
                  const video = rec.videos[o.vid];
                  return (
                    <li key={`${o.vid}-${o.t}`} className="text-sm text-slate-300">
                      <span className="flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                        <time dateTime={o.d}>{formatSnakeDate(o.d)}</time>
                        {video ? <span>· {video[1]}</span> : null}
                        {o.p ? <SnakeProbableMark /> : null}
                        <a
                          href={youtubeHref(o.vid, o.t)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-11 items-center gap-1 rounded-sm text-cyan-300 underline underline-offset-2 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
                        >
                          Écouter à {formatClock(o.t)}
                          <span className="sr-only"> sur YouTube (nouvel onglet)</span>
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      </span>
                      <span className="block">{o.o}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
          <p className="mt-1">
            <Link
              href={snakePlayerHref(rec.key)}
              prefetch={false}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm font-semibold text-emerald-200 underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            >
              Fiche Snake complète ({rec.row.oc} {rec.row.oc > 1 ? "opinions" : "opinion"})
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </p>
          {others.length ? (
            <p className="flex flex-wrap items-center gap-x-3 text-sm text-slate-400">
              <span>Dans vos autres ligues :</span>
              {others.map((o) => (
                <Link
                  key={o.href}
                  href={o.href}
                  prefetch={false}
                  className="inline-flex min-h-11 items-center gap-1 rounded-sm font-medium text-cyan-300 underline-offset-2 hover:text-cyan-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
                >
                  {o.label}
                </Link>
              ))}
            </p>
          ) : null}
        </>
      )}
      <SnakeDisclaimerShort className="mt-2" />
    </section>
  );
}
