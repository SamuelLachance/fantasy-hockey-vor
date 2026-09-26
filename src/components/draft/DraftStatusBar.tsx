"use client";

import { Search, Undo2 } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { formatClock, pickLabel, picksAwayLabel } from "@/lib/draft/draft-copy";
import { pickInfo } from "@/lib/draft/snake";
import type { DraftTimeline } from "@/lib/draft/suggestions";

interface DraftStatusBarProps {
  barRef: RefObject<HTMLDivElement | null>;
  timeline: DraftTimeline;
  teams: number;
  slot: number | null;
  onSlot: (slot: number | null) => void;
  onUndo: () => void;
  canUndo: boolean;
  /** Wall-clock ms of the last mark (the clock of the pick now on). */
  lastMarkAt: number | null;
  pickSeconds: number;
  /** Jump to the board search (phones: the board sits below suggestions). */
  onSearch: () => void;
}

/**
 * Elapsed time on the current pick since the last one was marked — a guide
 * only (Yahoo's clock is authoritative), but it tells you how long the
 * manager on the clock has been thinking out of the 75 s.
 */
function PickClock({ since, pickSeconds }: { since: number | null; pickSeconds: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (since == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [since]);
  if (since == null || now == null) {
    return <span className="tabular-nums text-slate-500">{formatClock(0)}</span>;
  }
  const elapsed = Math.max(0, (now - since) / 1000);
  const late = elapsed > pickSeconds;
  const share = Math.min(1, elapsed / pickSeconds);
  return (
    <span className="inline-flex items-center gap-2" title="Temps écoulé depuis le dernier choix marqué">
      <span className={`tabular-nums ${late ? "text-rose-300" : "text-slate-200"}`}>
        {formatClock(elapsed)}
      </span>
      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-white/10 sm:block" aria-hidden="true">
        <span
          className={`block h-full ${share > 0.8 ? "bg-rose-400" : "bg-cyan-400"}`}
          style={{ width: `${share * 100}%` }}
        />
      </span>
    </span>
  );
}

/** Idle time after a slot change before the select gives focus back. */
const SLOT_BLUR_MS = 1200;

export function DraftStatusBar({
  barRef,
  timeline,
  teams,
  slot,
  onSlot,
  onUndo,
  canUndo,
  lastMarkAt,
  pickSeconds,
  onSearch,
}: DraftStatusBarProps) {
  const { currentPick, totalPicks, targetPick, onTheClock, draftOver } = timeline;
  // Pending "hand focus back" after a slot change (see onChange).
  const blurTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (blurTimer.current != null) window.clearTimeout(blurTimer.current);
    },
    [],
  );
  const info = pickInfo(Math.min(currentPick, totalPicks), teams);
  const away = targetPick != null ? targetPick - currentPick : null;
  return (
    <div
      ref={barRef}
      className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/95 pt-[env(safe-area-inset-top,0px)] backdrop-blur motion-reduce:backdrop-blur-none"
    >
      <div className="mx-auto flex max-w-[120rem] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6 lg:px-8">
        <div className="min-w-0">
          {draftOver ? (
            <p className="text-sm font-semibold text-white">Repêchage terminé ({totalPicks} choix)</p>
          ) : (
            <p className="text-sm text-slate-300">
              <span className="font-semibold text-white">Choix {pickLabel(currentPick)}</span>
              <span className="text-slate-500"> / {totalPicks}</span>
              <span className="hidden sm:inline">
                {" "}
                · Ronde {info.round}, choix {info.pickInRound} · au bâton : position {info.slot}
              </span>
            </p>
          )}
        </div>

        {!draftOver ? (
          <div className="text-sm">
            <PickClock since={lastMarkAt} pickSeconds={pickSeconds} />
          </div>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {onTheClock ? (
            <span className="rounded-full bg-amber-400 px-3 py-1 text-sm font-bold text-slate-950 motion-safe:animate-pulse">
              À vous !
            </span>
          ) : targetPick != null && away != null ? (
            <span className="text-sm text-slate-300">
              Mon choix <span className="font-semibold text-white">{pickLabel(targetPick)}</span>{" "}
              <span className="text-slate-400">({picksAwayLabel(away)})</span>
            </span>
          ) : slot == null ? (
            <span className="text-xs text-amber-200">Entrez votre position →</span>
          ) : null}

          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <span>Ma position</span>
            <select
              value={slot ?? ""}
              onChange={(e) => {
                onSlot(e.target.value === "" ? null : Number(e.target.value));
                // Hand focus back shortly after the last change: a select
                // that keeps focus turns the 1–7 filter keys and arrows into
                // silent slot changes. The delay leaves native type-ahead
                // room to reach "12" ("1" then "2").
                const el = e.currentTarget;
                if (blurTimer.current != null) window.clearTimeout(blurTimer.current);
                blurTimer.current = window.setTimeout(() => {
                  blurTimer.current = null;
                  if (document.activeElement === el) el.blur();
                }, SLOT_BLUR_MS);
              }}
              className="min-h-9 rounded-lg border border-white/15 bg-slate-900 px-2 text-sm text-white"
              aria-label="Ma position dans l’ordre du repêchage (1 à 12)"
            >
              <option value="">—</option>
              {Array.from({ length: teams }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={onSearch}
            aria-label="Chercher un joueur"
            title="Chercher un joueur ( / )"
            className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-white/15 text-slate-200 hover:border-white/30 hover:bg-white/5 lg:hidden"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Annuler la dernière action (Ctrl + Z)"
            aria-label="Annuler la dernière action"
            className="inline-flex min-h-9 min-w-9 items-center justify-center gap-1 rounded-lg border border-white/15 px-2 text-xs text-slate-200 hover:border-white/30 hover:bg-white/5 disabled:opacity-40"
          >
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Annuler</span>
          </button>
        </div>
      </div>
    </div>
  );
}
