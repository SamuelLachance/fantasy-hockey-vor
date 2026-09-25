"use client";

import Link from "next/link";
import { ArrowLeft, ListOrdered } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadSnakePlayer, type SnakePlayerRecord } from "@/lib/snake/client";
import { formatCountFr, plural, positionLabel } from "@/lib/snake/copy";
import { LEAGUES } from "@/lib/leagues/registry";
import { leaguePlayerPath } from "@/lib/leagues/routes";
import { decodeIdSet } from "@/lib/snake/league-seed";
import { SITE_BRAND } from "@/lib/site";
import { SnakeDisclaimerShort } from "./SnakeDisclaimer";
import { SnakeOpinionItem } from "./SnakeOpinionItem";
import { SnakeSynthesisCard } from "./SnakeSynthesisCard";

const OPINIONS_PAGE = 20;

export interface BoardLeague {
  slug: string;
  name: string;
  /** NHL ids on its board that Snake discussed (`encodeIdSet`). */
  nhlIds: string;
}

/** The Fantrax league whose players Snake's Fantrax ids point to. */
const fantraxLeague = LEAGUES.find((l) => l.platform === "Fantrax");

type Load = { key: string; state: "loading" } | { key: string; state: "error" } | { key: string; state: "ready"; rec: SnakePlayerRecord | null };

const opinionHeadingId = (i: number) => `snake-opinion-${i}`;

/** One player: synthesis card + full dated timeline (lazy shard). */
export function SnakePlayerDetail({
  playerKey,
  onBack,
  autoFocus = true,
  inMyTeam,
  myTeamName,
  boardLeagues = [],
}: {
  playerKey: string;
  onBack: () => void;
  /** Focus the heading when shown (in-page navigation, not deep-link arrival). */
  autoFocus?: boolean;
  inMyTeam: (fantraxId: string | null) => boolean;
  myTeamName: string;
  /** Categories leagues and the NHL ids on their board (players Snake discussed). */
  boardLeagues?: readonly BoardLeague[];
}) {
  const [load, setLoad] = useState<Load>({ key: playerKey, state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [shown, setShown] = useState({ key: playerKey, n: OPINIONS_PAGE });
  const [show, setShow] = useState({ key: playerKey, value: "" });
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  // First opinion revealed by "Afficher … de plus" (focus moves to it).
  const focusFromRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSnakePlayer(playerKey).then(
      (rec) => {
        if (!cancelled) setLoad({ key: playerKey, state: "ready", rec });
      },
      () => {
        if (!cancelled) setLoad({ key: playerKey, state: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [playerKey, attempt]);

  const current: Load = load.key === playerKey ? load : { key: playerKey, state: "loading" };
  const rec = current.state === "ready" ? current.rec : null;
  const showFilter = show.key === playerKey ? show.value : "";
  const limit = shown.key === playerKey ? shown.n : OPINIONS_PAGE;

  // Tab title once the player is known. Restored only if it is still ours:
  // this cleanup also runs when the whole route unmounts on a client
  // navigation, after the next page has already set its own title.
  const name = rec?.row.n ?? null;
  useEffect(() => {
    if (!name) return;
    const prev = document.title;
    const mine = `${name} — Opinions de Snake | ${SITE_BRAND}`;
    document.title = mine;
    return () => {
      if (document.title === mine) document.title = prev;
    };
  }, [name]);
  useEffect(() => {
    if (autoFocus) headingRef.current?.focus({ preventScroll: true });
  }, [autoFocus, playerKey, current.state]);
  useEffect(() => {
    const from = focusFromRef.current;
    if (from === null) return;
    focusFromRef.current = null;
    document.getElementById(opinionHeadingId(from))?.focus();
  }, [limit]);

  const shows = useMemo(() => {
    if (!rec) return [];
    const counts = new Map<string, number>();
    for (const o of rec.opinions) {
      const s = rec.videos[o.vid]?.[1] ?? "";
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rec]);

  const opinions = useMemo(
    () => (rec ? rec.opinions.filter((o) => !showFilter || rec.videos[o.vid]?.[1] === showFilter) : []),
    [rec, showFilter],
  );

  const back = (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 text-sm font-medium text-slate-200 transition motion-reduce:transition-none hover:border-cyan-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Retour à la liste
    </button>
  );

  if (current.state !== "ready" || !rec) {
    return (
      <section aria-labelledby="snake-detail-titre" className="space-y-4">
        {back}
        <h2 id="snake-detail-titre" ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-white focus:outline-none">
          {current.state === "loading" ? "Chargement du joueur…" : current.state === "error" ? "Chargement impossible" : "Joueur introuvable"}
        </h2>
        {current.state === "loading" ? (
          <div role="status" aria-busy="true" className="space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-white/10 motion-reduce:animate-none" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-white/10 motion-reduce:animate-none" />
            <span className="sr-only">Chargement des opinions…</span>
          </div>
        ) : current.state === "error" ? (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100" role="alert">
            <p>{"Les opinions de ce joueur n'ont pas pu être chargées."}</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-rose-300/40 px-4 font-semibold text-rose-50 hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
            >
              Réessayer
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-300">
            {"Ce joueur n'est pas (ou plus) dans la base publique. Le lien est peut-être ancien."}
          </p>
        )}
      </section>
    );
  }

  const row = rec.row;
  const mine = inMyTeam(row.fx);
  // His Joueurs row in each league that lists him (Fantrax id; NHL id on a categories league's board).
  const inLeagues = [
    ...(row.fx && fantraxLeague
      ? [{ href: leaguePlayerPath(fantraxLeague.slug, row.fx), label: `${fantraxLeague.shortName} › Joueurs` }]
      : []),
    ...boardLeagues
      .filter((l) => row.nhl !== null && decodeIdSet(l.nhlIds).has(String(row.nhl)))
      .map((l) => ({ href: leaguePlayerPath(l.slug, String(row.nhl)), label: `${l.name} › Joueurs` })),
  ];
  return (
    <section aria-labelledby="snake-detail-titre" className="space-y-5">
      {back}
      <header className="space-y-2">
        <h2
          id="snake-detail-titre"
          ref={headingRef}
          tabIndex={-1}
          className="break-words text-3xl font-bold tracking-tight text-white focus:outline-none"
        >
          {row.n}
        </h2>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-400">
          <span>
            {row.pos ?? "?"} <span className="sr-only">({positionLabel(row.pos)})</span>
          </span>
          <span aria-hidden="true">·</span>
          <span>{row.tm ?? "Sans équipe LNH"}</span>
          {row.dr ? (
            <>
              <span aria-hidden="true">·</span>
              <span>Repêché en {row.dr}</span>
            </>
          ) : null}
          {mine ? (
            <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-xs font-medium text-cyan-200 ring-1 ring-inset ring-cyan-400/30">
              Dans l&apos;équipe Fantrax {myTeamName}
            </span>
          ) : null}
        </p>
        {inLeagues.length ? (
          <p className="flex flex-wrap items-center gap-x-3 text-sm text-slate-400">
            <ListOrdered className="h-4 w-4 text-cyan-400" aria-hidden="true" />
            <span>Dans vos ligues :</span>
            {inLeagues.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                prefetch={false}
                className="inline-flex min-h-11 items-center rounded-sm text-cyan-400 underline-offset-2 hover:text-cyan-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
              >
                {l.label}
              </Link>
            ))}
          </p>
        ) : null}
      </header>

      <SnakeSynthesisCard row={row} />
      <SnakeDisclaimerShort inPage />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="text-xl font-semibold text-white">
          Chronologie des opinions{" "}
          <span className="text-base font-normal text-slate-400">({plural(opinions.length, "opinion", "opinions")})</span>
        </h3>
        {shows.length > 1 ? (
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-400">
            Émission
            <select
              value={showFilter}
              onChange={(e) => {
                setShow({ key: playerKey, value: e.target.value });
                setShown({ key: playerKey, n: OPINIONS_PAGE });
              }}
              className="min-h-11 rounded-xl border border-white/15 bg-slate-900 px-3 text-sm text-white"
            >
              <option value="">Toutes ({formatCountFr(rec.opinions.length)})</option>
              {shows.map(([s, n]) => (
                <option key={s} value={s}>
                  {s} ({formatCountFr(n)})
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <ol className="space-y-3">
        {opinions.slice(0, limit).map((o, i) => (
          <li key={`${o.vid}-${o.t}`}>
            <SnakeOpinionItem opinion={o} video={rec.videos[o.vid]} headingLevel={4} headingId={opinionHeadingId(i)} />
          </li>
        ))}
      </ol>
      {opinions.length > limit ? (
        <button
          type="button"
          onClick={() => {
            focusFromRef.current = limit;
            setShown({ key: playerKey, n: limit + OPINIONS_PAGE });
          }}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-semibold text-slate-200 transition motion-reduce:transition-none hover:border-cyan-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          Afficher {formatCountFr(Math.min(OPINIONS_PAGE, opinions.length - limit))} opinions de plus (sur{" "}
          {formatCountFr(opinions.length - limit)} restantes)
        </button>
      ) : null}
    </section>
  );
}
