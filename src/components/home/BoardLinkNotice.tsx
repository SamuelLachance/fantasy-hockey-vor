"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { LEAGUES } from "@/lib/leagues/registry";
import { leaguePlayerPath, leagueTabPath } from "@/lib/leagues/routes";

/** URL params of the old English VOR board (`/?player=…#rankings`). */
const OLD_BOARD_PARAMS = ["player", "pos", "sort", "dir", "q", "g", "rf"];

/**
 * null: not an old board link; otherwise the NHL id of its `?player=` (the
 * board's player links), or "" when it named none.
 */
function oldBoardLink(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    if (window.location.hash !== "#rankings" && !OLD_BOARD_PARAMS.some((k) => params.has(k))) return null;
    const id = params.get("player")?.trim() ?? "";
    return /^\d{1,9}$/.test(id) ? id : "";
  } catch {
    return null;
  }
}

const noopSubscribe = () => () => {};

/**
 * Shown on « Mes ligues » only when the address is an old board link: the
 * board is gone, each league's Joueurs tab replaces it.
 */
export function BoardLinkNotice() {
  // Read once in the browser (never in the prerendered HTML).
  const oldLink = useSyncExternalStore(noopSubscribe, oldBoardLink, () => null);
  const [dismissed, setDismissed] = useState(false);
  if (oldLink === null || dismissed) return null;
  return (
    <div
      role="note"
      className="flex flex-col gap-2 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-50 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="space-y-2">
        <p>
          L’ancien classement VOR (en anglais) a été retiré : chaque ligue a maintenant son onglet Joueurs, calculé pour
          ses propres règles.
        </p>
        <ul className="flex flex-wrap gap-2">
          {LEAGUES.filter((l) => l.tabs.includes("joueurs")).map((l) => (
            <li key={l.slug}>
              <Link
                href={
                  // Categories leagues key their rows by NHL id, like the old board: open the player there.
                  oldLink && l.kind === "yahoo-categories" ? leaguePlayerPath(l.slug, oldLink) : leagueTabPath(l.slug, "joueurs")
                }
                prefetch={false}
                className="inline-flex min-h-11 items-center rounded-full border border-amber-300/40 px-3 font-semibold text-amber-100 hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              >
                {l.shortName} › Joueurs
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Fermer ce message"
        className="inline-flex min-h-11 min-w-11 items-center justify-center self-end rounded-xl text-amber-100 hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 sm:self-start"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
