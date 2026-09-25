"use client";

import Link from "next/link";
import { ArrowRight, ExternalLink, Mic } from "lucide-react";
import { useEffect, useState } from "react";
import { ensureSnakeBoard, useSnakeBoardEntry, useSnakeBoardStatus } from "@/lib/snake/board-store";
import { loadSnakePlayer, type SnakePlayerRecord } from "@/lib/snake/client";
import { formatSnakeDate, snakeDerivedNote } from "@/lib/snake/copy";
import { formatClock, snakePlayerHref, youtubeHref } from "@/lib/snake/url";
import { SnakeProbableMark, SnakeTrendBadge, SnakeVerdictChip } from "./SnakeBadges";
import { SnakeDisclaimerShort } from "./SnakeDisclaimer";

type Load =
  | { key: string; state: "loading" }
  | { key: string; state: "error" }
  | { key: string; state: "ready"; rec: SnakePlayerRecord | null };

/**
 * « L'avis de Snake » in the rankings board's expanded panel (French block
 * on the English board). Renders nothing for players he never discussed.
 * Data: the NHL lookup (idle-loaded) then the player's opinion shard.
 */
export function ExpandedPlayerSnake({ playerId }: { playerId: number }) {
  const entry = useSnakeBoardEntry(playerId);
  const status = useSnakeBoardStatus();
  const key = entry?.[0] ?? null;
  const [load, setLoad] = useState<Load | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    ensureSnakeBoard();
  }, []);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    loadSnakePlayer(key).then(
      (rec) => {
        if (!cancelled) setLoad({ key, state: "ready", rec });
      },
      () => {
        if (!cancelled) setLoad({ key, state: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, attempt]);

  if (!key) {
    // Lookup still loading: reserve nothing; failed lookup: stay silent
    // (the rest of the panel does not depend on it).
    return status === "loading" ? (
      <span className="sr-only" role="status">
        Chargement de l&apos;avis de Snake…
      </span>
    ) : null;
  }

  const current: Load = load && load.key === key ? load : { key, state: "loading" };
  const headingId = `snake-avis-${playerId}`;
  const rec = current.state === "ready" ? current.rec : null;
  if (current.state === "ready" && !rec) return null;
  const latest = rec?.opinions[0];
  const latestVideo = latest ? rec?.videos[latest.vid] : undefined;

  return (
    <section
      lang="fr-CA"
      aria-labelledby={headingId}
      aria-busy={current.state === "loading" || undefined}
      className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Mic className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        <h3 id={headingId} className="text-sm font-semibold text-white">
          L&apos;avis de Snake
        </h3>
        <SnakeVerdictChip verdict={rec?.row.v ?? entry![1]} />
        <SnakeTrendBadge trend={rec?.row.td ?? entry![2]} />
        {(rec ? rec.row.pr : entry![3]) ? <SnakeProbableMark /> : null}
      </div>

      {current.state === "error" ? (
        <p className="mt-2 text-sm text-slate-300">
          {"La synthèse n'a pas pu être chargée. "}
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
          {latest ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
              <span>
                Dernière mention : <time dateTime={latest.d}>{formatSnakeDate(latest.d)}</time>
                {latestVideo ? ` · ${latestVideo[1]}` : ""}
              </span>
              <a
                href={youtubeHref(latest.vid, latest.t)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1 rounded-sm text-cyan-300 underline underline-offset-2 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
              >
                Écouter à {formatClock(latest.t)}
                <span className="sr-only"> sur YouTube (nouvel onglet)</span>
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </p>
          ) : null}
          <p className="mt-1">
            <Link
              href={snakePlayerHref(key)}
              prefetch={false}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm font-semibold text-emerald-200 underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            >
              Toutes ses opinions sur {rec.row.n} ({rec.row.oc})
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </p>
        </>
      )}
      <SnakeDisclaimerShort className="mt-2" />
    </section>
  );
}
