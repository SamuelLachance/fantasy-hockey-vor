import Link from "next/link";
import type { ReactNode } from "react";
import type { DraftBoard } from "@/lib/draft/board-types";
import type { LeaguePoolCounts } from "@/lib/draft/league-pool";
import { leagueTabPath } from "@/lib/leagues/routes";
import { fmtInt } from "@/lib/player-table/copy";
import { DraftMethodNote } from "./DraftMethodNote";

/**
 * A categories league · Joueurs (server part): where the draft marks come
 * from, where the players without a projection sort (after every projected
 * player, whatever the sort: a link filters them alone), how to read the
 * values, then the league's player table (`table`, a client chunk of its
 * own). How deep the list goes is the tab's lead line.
 */
export function CategoryPlayersTab({
  board,
  slug,
  counts,
  table,
}: {
  board: DraftBoard;
  slug: string;
  counts: LeaguePoolCounts;
  table: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Les marques « Repêché » et « Mon choix » viennent de l’onglet Repêchage, sur cet appareil.
      </p>
      {counts.unprojected > 0 ? (
        <p className="max-w-3xl text-sm text-slate-400">
          {`Les joueurs sans projection${
            counts.roster > 0 ? ` (dont ${fmtInt(counts.roster)} dans un effectif de la LNH : recrues, rappels)` : ""
          } n’ont ni rang ni valeur : ils viennent après tous les joueurs projetés, quel que soit le tri. `}
          <Link
            href={leagueTabPath(slug, "joueurs", "?projection=sans")}
            prefetch={false}
            className="font-semibold text-cyan-300 underline underline-offset-2 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            Les voir seuls
          </Link>{" "}
          (filtre « Projection »).
        </p>
      ) : null}
      <div className="max-w-3xl">
        <DraftMethodNote board={board} shortcuts={false} summary="Comment lire ces valeurs" />
      </div>
      {table}
    </div>
  );
}
