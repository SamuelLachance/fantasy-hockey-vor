"use client";

import { Suspense } from "react";
import type { PlayerProjection } from "@/lib/types";
import { RankingsTableInner } from "./RankingsTableInner";

interface RankingsTableProps {
  players: PlayerProjection[];
}

export function RankingsTable({ players }: RankingsTableProps) {
  return (
    <Suspense
      fallback={
        <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-6 py-16 text-center text-slate-400">
          Loading rankings…
        </div>
      }
    >
      <RankingsTableInner players={players} />
    </Suspense>
  );
}
