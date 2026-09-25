"use client";

import { FantraxPlanGate } from "./FantraxPlanGate";
import { useFantraxLeague } from "./fantrax-league-context";
import { FantraxPlayerTable } from "./fantrax-table";
import { WaiverTargets } from "./WaiverTargets";

/** Captains · Ballottage: the best free agents and waiver claims for the period (claims left), then every available player. */
export function FantraxWaiversTab() {
  const { player } = useFantraxLeague();
  return (
    <div className="space-y-6">
      <FantraxPlanGate>{(plan) => <WaiverTargets plan={plan} player={player} />}</FantraxPlanGate>
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
