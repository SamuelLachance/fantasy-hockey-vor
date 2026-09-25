"use client";

import { TabLink } from "@/components/league-shell/TabLink";
import { draftBoardNote } from "@/lib/fantrax/league-copy";
import { DraftPanel } from "./DraftPanel";
import { FantraxPlanGate } from "./FantraxPlanGate";
import { useFantraxLeague } from "./fantrax-league-context";
import { FantraxPlayerTable } from "./fantrax-table";

/**
 * Captains · Repêchage: who is on the clock, the user's picks, VONA by
 * position and the latest picks (live, folded), then right away the best
 * available players (the current plan's board until the whole pool is
 * in), their filters folded so the rows come first.
 */
export function FantraxDraftTab({ slug }: { slug: string }) {
  const { player, teamName, live, nowMs, plan } = useFantraxLeague();
  const d = plan?.draft ?? null;
  return (
    <div className="space-y-6">
      <FantraxPlanGate>
        {(p) =>
          p.draft ? (
            <DraftPanel
              plan={p}
              player={player}
              teamName={teamName}
              recent={live?.recent ?? null}
              liveAt={live?.fetchedAt ?? null}
              nowMs={nowMs}
            />
          ) : (
            <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
              Aucun repêchage en cours dans cette ligue.{" "}
              <TabLink slug={slug} tab="joueurs">
                Voir tous les joueurs
              </TabLink>
            </p>
          )
        }
      </FantraxPlanGate>
      <FantraxPlayerTable
        id="disponibles"
        title={d ? "Meilleurs disponibles" : "Meilleurs joueurs disponibles"}
        base="repechage"
        presets={["repechage", "espoirs"]}
        perPage={25}
        fallback="draft"
        compactFilters
        footer={d ? draftBoardNote(d.next?.pick ?? null, d.following?.pick ?? null, d.poolShare) : null}
      />
    </div>
  );
}
