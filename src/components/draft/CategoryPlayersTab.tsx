import type { ReactNode } from "react";
import type { DraftBoard } from "@/lib/draft/board-types";
import { DraftMethodNote } from "./DraftMethodNote";

/**
 * A categories league · Joueurs (server part): where the draft marks come
 * from, how to read the values, then the league's player table (`table`, a
 * client chunk of its own). How deep the list goes is the tab's lead line.
 */
export function CategoryPlayersTab({ board, table }: { board: DraftBoard; table: ReactNode }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Les marques « Repêché » et « Mon choix » viennent de l’onglet Repêchage, sur cet appareil.
      </p>
      <div className="max-w-3xl">
        <DraftMethodNote board={board} shortcuts={false} summary="Comment lire ces valeurs" />
      </div>
      {table}
    </div>
  );
}
