"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import { SnakeVerdictsProvider } from "@/components/snake/SnakeVerdicts";
import type { DraftBoard, DraftBoardPlayer } from "@/lib/draft/board-types";
import { formatDraftStartFr } from "@/lib/draft/draft-copy";
import { myPickIds, UNLISTED_PLAYER_ID } from "@/lib/draft/draft-state";
import { getDraftStore } from "@/lib/draft/draft-store";
import { draftTimeline } from "@/lib/draft/suggestions";
import { buildLineup, categoryTargets, teamCategoryStrength } from "@/lib/draft/team";
import { leagueTabPath } from "@/lib/leagues/routes";
import { fmtInt } from "@/lib/player-table/copy";
import type { SnakeNhlFile } from "@/lib/snake/types";
import { CategoryPlayerTable, useCategoryTableData } from "./category-table";
import { DraftMyTeam } from "./DraftMyTeam";

/**
 * A categories league · Mon équipe: the players marked « Moi » in the
 * draft helper (same browser storage, kept in sync with other tabs), found
 * in the whole league list (board, then the fetched pool), their lineup
 * and category strengths, then the same players in the league's player
 * table. Device-local, and frozen at the draft (no Yahoo integration yet:
 * trades and waivers are not seen).
 */
export function CategoryTeamTab({ board, slug, seed }: { board: DraftBoard; slug: string; seed: SnakeNhlFile["rows"] }) {
  return (
    <SnakeVerdictsProvider kind="nhl" seed={seed} complete>
      <TeamBody board={board} slug={slug} />
    </SnakeVerdictsProvider>
  );
}

function TeamBody({ board, slug }: { board: DraftBoard; slug: string }) {
  const store = getDraftStore(board.slug, board.league.teams);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const source = useCategoryTableData(board);
  const { players, poolStatus } = source;
  const view = useMemo(() => {
    const byId = new Map(players.map((p) => [p.id, p]));
    const ids = myPickIds(state);
    const found = ids.map((id) => byId.get(id)).filter((p): p is DraftBoardPlayer => p != null);
    // No projection, no value: listed under the lineup, never seated in it.
    const mine = found.filter((p) => !p.noProj);
    const lineup = buildLineup(board, mine);
    const strength = teamCategoryStrength(board, lineup);
    return {
      picks: ids.length,
      notFound: ids.length - found.length,
      unlisted: state.picks.filter((p) => p.mine && p.id === UNLISTED_PLAYER_ID).length,
      unprojected: found.filter((p) => p.noProj),
      lineup,
      strength,
      targets: categoryTargets(strength),
      timeline: draftTimeline(board, state),
    };
  }, [board, state, players]);

  const draftLink = (
    <Link
      href={leagueTabPath(slug, "repechage")}
      prefetch={false}
      className="inline-flex min-h-11 items-center gap-1 rounded-md font-semibold text-cyan-300 underline-offset-2 hover:text-cyan-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
    >
      Onglet Repêchage
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );

  if (view.picks === 0 && view.unlisted === 0) {
    return (
      <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300 sm:p-6">
        <p>Votre équipe apparaîtra ici à mesure que vous marquez vos choix dans l’onglet Repêchage.</p>
        <p className="text-slate-400">
          {state.slot ? `Votre position au repêchage : ${state.slot}${state.slot === 1 ? "re" : "e"}. ` : "Position au repêchage non saisie. "}
          Repêchage le{" "}
          <time dateTime={board.league.draftStartsAt}>{formatDraftStartFr(board.league.draftStartsAt)}</time>.
        </p>
        <p>{draftLink}</p>
      </div>
    );
  }

  const done = source.done;
  return (
    <div className="space-y-6">
      <div className="max-w-2xl space-y-2">
        <DraftMyTeam
          board={board}
          lineup={view.lineup}
          strength={view.strength}
          targets={view.targets}
          myPicks={view.timeline.myPicks}
          currentPick={view.timeline.currentPick}
        />
        {view.unprojected.length > 0 ? (
          <p className="text-xs text-amber-100/90">
            Sans projection, donc hors de l’alignement ci-dessus : {view.unprojected.map((p) => p.name).join(", ")}.
          </p>
        ) : null}
        {view.notFound > 0 ? (
          <p className="text-xs text-slate-400">
            {poolStatus === "error"
              ? `${view.notFound === 1 ? "Un de vos choix n’est" : `${fmtInt(view.notFound)} de vos choix ne sont`} pas dans les ${fmtInt(board.players.length)} premiers joueurs et la liste complète n’a pas pu être chargée.`
              : poolStatus === "ready"
                ? `${view.notFound === 1 ? "Un de vos choix n’est" : `${fmtInt(view.notFound)} de vos choix ne sont`} plus dans la liste des joueurs de la ligue.`
                : `Chargement de la liste complète pour ${view.notFound === 1 ? "un" : fmtInt(view.notFound)} de vos choix…`}
          </p>
        ) : null}
        {view.unlisted > 0 ? (
          <p className="text-xs text-slate-400">
            {view.unlisted === 1 ? "Un de vos choix est marqué" : `${view.unlisted} de vos choix sont marqués`} « hors liste » :
            tous les joueurs sont maintenant dans l’onglet Repêchage, où vous pouvez nommer le bon joueur (bouton « Identifier »
            de « Derniers choix ») ; le numéro du choix ne change pas.
          </p>
        ) : null}
        <p className="text-xs text-slate-400">
          {done
            ? "Effectif au repêchage, d’après les choix marqués sur cet appareil : les échanges et le ballottage de la saison n’y sont pas (il faudrait l’API de Yahoo)."
            : "Basé sur les choix marqués sur cet appareil (exportez-les depuis l’onglet Repêchage pour un autre appareil)."}
        </p>
      </div>
      <CategoryPlayerTable
        board={board}
        source={source}
        id="effectif-joueurs"
        title={done ? "Effectif au repêchage" : "Mes choix au repêchage"}
        description="Vos joueurs avec leur valeur dans la ligue, leurs catégories et l’avis de Snake."
        base="equipe"
        presets={[]}
        perPage={50}
      />
      <p className="text-sm">{draftLink}</p>
    </div>
  );
}
