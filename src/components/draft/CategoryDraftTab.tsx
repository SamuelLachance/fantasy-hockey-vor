"use client";

import { SnakeChipLegend } from "@/components/snake/SnakeChipLegend";
import { SnakeVerdictsProvider } from "@/components/snake/SnakeVerdicts";
import type { DraftBoard } from "@/lib/draft/board-types";
import type { SnakeNhlFile } from "@/lib/snake/types";
import { DraftHelper } from "./DraftHelper";

/**
 * A categories league · Repêchage: the live draft helper, unchanged (same
 * browser storage, keyboard and layout), with Snake's verdict chips on its
 * rows from the page's seed (and, under the board, what those chips mean).
 * The seed covers every board player Snake discussed, so nothing is
 * fetched during the draft.
 */
export function CategoryDraftTab({ board, seed }: { board: DraftBoard; seed: SnakeNhlFile["rows"] }) {
  return (
    <SnakeVerdictsProvider kind="nhl" seed={seed} complete>
      <DraftHelper board={board} />
      <div className="mx-auto max-w-[120rem] px-4 pt-6 sm:px-6 lg:px-8">
        <SnakeChipLegend className="max-w-4xl" />
      </div>
    </SnakeVerdictsProvider>
  );
}
