/**
 * The dynasty value mode of the Captains Dynasty tabs (« Gagner maintenant ·
 * Équilibré · Long terme »): which of dynasty.json's three values and ranks
 * every table, filter and summary uses. Kept in the address as `?mode=`
 * (absent = Équilibré) and carried from tab to tab like `?team=`. Tiny on
 * purpose: the league provider (every Captains page) imports it.
 */
import type { Mode } from "@/lib/dynasty/types";

export type DynastyMode = Mode;

export const DYNASTY_MODES: readonly DynastyMode[] = ["winNow", "balanced", "longTerm"];
export const DEFAULT_DYNASTY_MODE: DynastyMode = "balanced";
export const DYNASTY_MODE_PARAM = "mode";

/** URL tokens (French, ASCII). */
const TOKEN: Record<DynastyMode, string> = {
  winNow: "maintenant",
  balanced: "equilibre",
  longTerm: "long-terme",
};

export const DYNASTY_MODE_LABEL: Record<DynastyMode, string> = {
  winNow: "Gagner maintenant",
  balanced: "Équilibré",
  longTerm: "Long terme",
};

/** The switch's words on a phone (three options in one row at 343 px). */
export const DYNASTY_MODE_SHORT: Record<DynastyMode, string> = {
  winNow: "Maintenant",
  balanced: "Équilibré",
  longTerm: "Long terme",
};

/**
 * What each mode weighs, in plain words (dynasty.json's `params.modes`:
 * each season counts δ times the one before, δ 0.35, 0.75, 0.95).
 */
export const DYNASTY_MODE_HINT: Record<DynastyMode, string> = {
  winNow: "Surtout cette saison : la suivante compte environ un tiers autant, les autres presque plus.",
  balanced: "Les 12 prochaines saisons : chacune compte 25 % de moins que la précédente.",
  longTerm: "L’avenir d’abord : cette saison compte peu, les suivantes presque autant les unes que les autres.",
};

/** `?mode=` value → mode; missing or unknown → Équilibré. */
export function parseDynastyMode(token: string | null | undefined): DynastyMode {
  const t = (token ?? "").trim().toLowerCase();
  return DYNASTY_MODES.find((m) => TOKEN[m] === t) ?? DEFAULT_DYNASTY_MODE;
}

export function dynastyModeToken(mode: DynastyMode): string {
  return TOKEN[mode];
}

/**
 * `search` with `?mode=` set for a non-default mode and removed for
 * Équilibré (other params kept, in place): "" when nothing is left.
 */
export function dynastyModeSearch(search: string, mode: DynastyMode): string {
  const params = new URLSearchParams(search);
  if (mode === DEFAULT_DYNASTY_MODE) params.delete(DYNASTY_MODE_PARAM);
  else params.set(DYNASTY_MODE_PARAM, TOKEN[mode]);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
