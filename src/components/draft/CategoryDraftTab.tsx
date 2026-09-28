"use client";

import { useMemo } from "react";
import { SnakeChipLegend } from "@/components/snake/SnakeChipLegend";
import { SnakeVerdictsProvider } from "@/components/snake/SnakeVerdicts";
import type { DraftBoard } from "@/lib/draft/board-types";
import { leagueSnakeRows } from "@/lib/draft/league-pool";
import type { SnakeNhlFile } from "@/lib/snake/types";
import { DraftHelper } from "./DraftHelper";
import { useLeaguePool } from "./useLeaguePool";

/**
 * A categories league · Repêchage: the live draft helper, unchanged (same
 * browser storage, keyboard and layout), with Snake's verdict chips on its
 * rows from the page's seed (and, under the board, what those chips mean).
 * The board is inlined, so the helper works offline mid-draft; the rest of
 * the league (`pool.json`, every other player, with Snake's verdicts on
 * them) is fetched after the first paint and joins the list when it lands.
 */
export function CategoryDraftTab({ board, seed }: { board: DraftBoard; seed: SnakeNhlFile["rows"] }) {
  const { pool } = useLeaguePool(board.slug, true);
  const rows = useMemo(() => leagueSnakeRows(seed, pool) ?? seed, [seed, pool]);
  return (
    <SnakeVerdictsProvider kind="nhl" seed={rows} complete>
      <DraftHelper board={board} pool={pool} />
      <div className="mx-auto max-w-[120rem] px-4 pt-6 sm:px-6 lg:px-8">
        <SnakeChipLegend className="max-w-4xl" />
      </div>
    </SnakeVerdictsProvider>
  );
}
