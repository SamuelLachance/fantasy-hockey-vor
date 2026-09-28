"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TabLink } from "@/components/league-shell/TabLink";
import { canRankByPoints, parseGroups } from "@/lib/fantrax/config";
import { draftBoardNote } from "@/lib/fantrax/league-copy";
import type { PoolSnapshot } from "@/lib/fantrax/pool";
import { loadFantraxPool, peekFantraxPool } from "@/lib/fantrax/pool-client";
import type { PresetId } from "@/lib/fantrax/table";
import { dynastyDraftNote } from "@/lib/fantrax/table-copy";
import { DraftPanel } from "./DraftPanel";
import { FantraxPlanGate } from "./FantraxPlanGate";
import { useFantraxLeague } from "./fantrax-league-context";
import { FantraxPlayerTable } from "./fantrax-table";
import type { PlayerLookup } from "./LeagueCard";


/** A dynasty startup draft (every player carries over) opens on dynasty value, prospects included. */
const DYNASTY_DRAFT_PRESETS: readonly PresetId[] = ["dynastie", "repechage", "espoirs"];
const SEASON_DRAFT_PRESETS: readonly PresetId[] = ["repechage", "dynastie", "espoirs"];

/**
 * The whole pool's names, once the table has loaded it (cached per league):
 * the latest picks of a dynasty draft are often prospects nobody projects,
 * whom the plan's lookup cannot name.
 */
function usePoolLookup(player: PlayerLookup): PlayerLookup {
  const { config } = useFantraxLeague();
  const [pool, setPool] = useState<PoolSnapshot | null>(() => peekFantraxPool(config));
  useEffect(() => {
    if (pool) return;
    let cancelled = false;
    loadFantraxPool(config).then(
      (p) => {
        if (!cancelled) setPool(p);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [pool, config]);
  const byId = useMemo(() => new Map((pool?.players ?? []).map((r) => [r.id, r])), [pool]);
  return useCallback<PlayerLookup>(
    (id) => {
      const known = player(id);
      if (known || !id) return known;
      const r = byId.get(id);
      return r
        ? { n: r.n, t: r.t, e: parseGroups(r.pos, config).join(","), st: "", fpg: r.fpg ?? 0, src: r.src === "p" ? "proj" : "prior" }
        : undefined;
    },
    [player, byId, config],
  );
}

/**
 * A Fantrax league's Repêchage: who is on the clock, the user's picks, VONA by
 * position and the latest picks (live, folded), then right away the best
 * available players (the current plan's board until the whole pool is
 * in), their filters folded so the rows come first. The season columns
 * (value, VONA, odds) and the dynasty value sit side by side; the note says
 * they are two different units.
 *
 * A salary-cap league (Slapshot, a dynasty startup draft) adds, around the
 * same panel and table: « C'EST À TOI » when its team is on the clock, its
 * roster so far with the cap use over the 23 counted spots and the room per
 * season, the empty starting seats by position, the best available per
 * position, and the method note; its table opens on the dynasty view
 * (prospects included, with salaries and contract ends).
 */
export function FantraxDraftTab({ slug }: { slug: string }) {
  const { config, pack, player, teamName, live, nowMs, plan, hasDynasty, mode } = useFantraxLeague();
  const lookup = usePoolLookup(player);
  const d = plan?.draft ?? null;
  const cap = !!config.salaryCap;
  // A salary-cap league's own pieces (the cue, the cap / needs / best-by-position
  // board, the method note) come with its league pack: Captains never loads them.
  const parts = pack?.parts;
  const notes = [
    d
      ? draftBoardNote(d.next?.pick ?? null, d.following?.pick ?? null, d.poolShare, hasDynasty, canRankByPoints(config) ? pack?.copy.vorBoardNote : undefined)
      : null,
    hasDynasty ? (!config.features.keeperCutdown && pack ? pack.copy.dynastyDraftNote(mode) : dynastyDraftNote(mode)) : null,
  ].filter(Boolean);
  return (
    <div className="space-y-6">
      {parts ? <parts.DraftCue /> : null}
      <FantraxPlanGate>
        {(p) =>
          p.draft ? (
            <DraftPanel
              plan={p}
              player={lookup}
              teamName={teamName}
              recent={live?.recent ?? null}
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
      {parts ? <parts.DraftBoard /> : null}
      <FantraxPlayerTable
        id="disponibles"
        title={d ? "Meilleurs disponibles" : "Meilleurs joueurs disponibles"}
        base={cap ? "dynastie" : "repechage"}
        presets={cap ? DYNASTY_DRAFT_PRESETS : SEASON_DRAFT_PRESETS}
        perPage={25}
        fallback="draft"
        compactFilters
        footer={notes.length ? notes.join(" ") : null}
      />
      {parts ? <parts.DraftFooter /> : null}
    </div>
  );
}
