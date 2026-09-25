"use client";

import type { ReactNode } from "react";
import type { DailyPlan } from "@/lib/fantrax/daily-plan";
import { useFantraxLeague } from "./fantrax-league-context";

/**
 * A tab body that needs the chosen team's plan: the baked plan paints at
 * once for the default team; another team waits for the snapshot
 * (« Chargement de l'équipe… »), with a retry when it cannot load.
 */
export function FantraxPlanGate({ children }: { children: (plan: DailyPlan) => ReactNode }) {
  const { plan, bundleState, refresh } = useFantraxLeague();
  if (plan) return <>{children(plan)}</>;
  if (bundleState === "error") {
    return (
      <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-sm text-rose-100">
        <p>{"Impossible de charger les données de la ligue pour cette équipe."}</p>
        <button
          type="button"
          onClick={refresh}
          className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-rose-300/40 px-4 font-semibold text-rose-50 hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
        >
          Réessayer
        </button>
      </div>
    );
  }
  return (
    <p role="status" className="py-12 text-center text-sm text-slate-400">
      {"Chargement de l'équipe…"}
    </p>
  );
}
