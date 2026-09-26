"use client";

import { TabLink } from "@/components/league-shell/TabLink";
import { draftBoardNote } from "@/lib/fantrax/league-copy";
import { dynastyDraftNote } from "@/lib/fantrax/table-copy";
import { DraftPanel } from "./DraftPanel";
import { FantraxPlanGate } from "./FantraxPlanGate";
import { useFantraxLeague } from "./fantrax-league-context";
import { FantraxPlayerTable } from "./fantrax-table";

/**
 * Captains · Repêchage: who is on the clock, the user's picks, VONA by
 * position and the latest picks (live, folded), then right away the best
 * available players (the current plan's board until the whole pool is
 * in), their filters folded so the rows come first. The season columns
 * (value, VONA, odds) and the dynasty value sit side by side; the note says
 * they are two different units.
 */
export function FantraxDraftTab({ slug }: { slug: string }) {
  const { player, teamName, live, nowMs, plan, hasDynasty, mode } = useFantraxLeague();
  const d = plan?.draft ?? null;
  const notes = [
    d ? draftBoardNote(d.next?.pick ?? null, d.following?.pick ?? null, d.poolShare, hasDynasty) : null,
    hasDynasty ? dynastyDraftNote(mode) : null,
  ].filter(Boolean);
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
        presets={["repechage", "dynastie", "espoirs"]}
        perPage={25}
        fallback="draft"
        compactFilters
        footer={notes.length ? notes.join(" ") : null}
      />
    </div>
  );
}
