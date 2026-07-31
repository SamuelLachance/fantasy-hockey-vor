"use client";

import { Suspense } from "react";
import type { PlayerProjection } from "@/lib/types";
import { RankingsLoadingStatus } from "./RankingsLoadingStatus";
import { RankingsTableInner } from "./RankingsTableInner";

interface RankingsTableProps {
  players: PlayerProjection[];
}

export function RankingsTable({ players }: RankingsTableProps) {
  return (
    <section
      id="rankings"
      aria-labelledby="rankings-heading"
      className="space-y-4 scroll-mt-6"
    >
      <h2 id="rankings-heading" className="sr-only">
        VOR rankings
      </h2>
      <Suspense
        fallback={
          <RankingsLoadingStatus className="rounded-2xl border border-white/10 bg-slate-950/40 px-6 py-16" />
        }
      >
        <RankingsTableInner players={players} />
      </Suspense>
    </section>
  );
}
