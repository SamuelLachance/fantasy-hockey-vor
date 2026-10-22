"use client";

import dynamic from "next/dynamic";
import { FantraxPlanGate } from "./FantraxPlanGate";
import { useFantraxLeague } from "./fantrax-league-context";
import { FantraxPlayerTable } from "./fantrax-table";
import { WaiverTargets } from "./WaiverTargets";

// The week's streaming plan (its solver, its words) loads on demand: no other tab needs it.
const StreamerPlan = dynamic(() => import("./StreamerPlan").then((m) => m.StreamerPlan), { ssr: false });

/** Ballottage: the week's streaming plan, the best free agents and waiver claims for the period (claims left), then every available player. */
export function FantraxWaiversTab() {
  const { player } = useFantraxLeague();
  return (
    <div className="space-y-6">
      <FantraxPlanGate>
        {(plan) => (
          <div className="space-y-6">
            <StreamerPlan />
            <WaiverTargets plan={plan} player={player} />
          </div>
        )}
      </FantraxPlanGate>
      <FantraxPlayerTable
        id="autonomes"
        title="Tous les joueurs disponibles"
        base="autonomes"
        presets={["autonomes", "ballottage-ww", "espoirs"]}
        perPage={50}
      />
    </div>
  );
}
