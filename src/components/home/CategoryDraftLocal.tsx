"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { UNLISTED_PLAYER_ID } from "@/lib/draft/draft-state";
import { draftDone } from "@/lib/draft/draft-done";
import { getDraftStore } from "@/lib/draft/draft-store";
import { leagueTabPath } from "@/lib/leagues/routes";

const TICK_MS = 60_000;

/**
 * The draft as marked on this device (same storage as the draft helper):
 * the user's slot and how many picks are marked, then « Repêchage
 * terminé » and a link to the team once it is over (every pick marked, or
 * 12 h after the start). Nothing in the prerendered HTML: the store and
 * the clock only exist in the browser.
 */
export function CategoryDraftLocal({
  slug,
  leagueSlug,
  teams,
  rounds,
  startsAt,
}: {
  /** Draft storage slug (the league's profile). */
  slug: string;
  /** Route slug of the league. */
  leagueSlug: string;
  teams: number;
  rounds: number;
  startsAt: string;
}) {
  const store = getDraftStore(slug, teams);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, TICK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);
  if (nowMs === null) return null;
  const total = teams * rounds;
  const mine = state.picks.filter((p) => p.mine && p.id !== UNLISTED_PLAYER_ID).length;
  const marked = state.picks.length;
  const done = draftDone({ teams, rounds, draftStartsAt: startsAt }, state, nowMs);
  if (done) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-slate-300">
        <span>
          <span className="font-semibold text-white">Repêchage terminé.</span>{" "}
          {mine > 0 ? `Sur cet appareil : ${mine} choix à moi.` : "Aucun de vos choix n’est marqué sur cet appareil."}
        </span>
        <Link
          href={leagueTabPath(leagueSlug, "mon-equipe")}
          prefetch={false}
          className="inline-flex min-h-11 items-center rounded-md font-semibold text-cyan-300 underline-offset-2 hover:text-cyan-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          Voir mon équipe
        </Link>
      </p>
    );
  }
  return (
    <p className="text-sm text-slate-300">
      Sur cet appareil :{" "}
      {state.slot ? (
        <>
          ma position <span className="font-semibold text-white">{state.slot}{state.slot === 1 ? "re" : "e"}</span>
        </>
      ) : (
        <span className="text-slate-400">position non saisie</span>
      )}
      {" · "}
      {marked === 0
        ? "aucun choix marqué"
        : `${marked}/${total} choix marqués, dont ${mine} à moi`}
    </p>
  );
}
