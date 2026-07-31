import type { SortKey } from "@/lib/rankings-filters";

/** Canonical board shortcut catalogue (help dialog + docs). */
export const BOARD_SHORTCUT_ROWS: ReadonlyArray<{
  keys: string;
  action: string;
}> = [
  { keys: "/", action: "Focus search" },
  { keys: "f", action: "Toggle stat filters" },
  { keys: "r", action: "Reset board view" },
  { keys: "l", action: "Copy board link" },
  { keys: "m", action: "Load more rows" },
  { keys: "Home", action: "Scroll to top" },
  { keys: "End", action: "Jump to board + focus search" },
  { keys: "Shift+G", action: "Toggle Starters / All goalies" },
  { keys: "[ / ]", action: "Previous / next position tab" },
  { keys: "v / e / u / g", action: "Sort by VOR / Edge / Σσ / GP" },
  { keys: "?", action: "Toggle this help" },
  { keys: "Esc", action: "Clear search / close help / filters / row" },
  { keys: "j / ↓", action: "Next player (opens first if none)" },
  { keys: "k / ↑", action: "Previous player (opens last if none)" },
  { keys: "Enter / Space", action: "Expand / collapse focused row" },
  { keys: "Double-click header", action: "Reset sort to VOR" },
];

/** Letter → sort column for board hotkeys (no modifiers). */
export const BOARD_SORT_HOTKEYS: Readonly<Record<string, SortKey>> = {
  v: "vor",
  e: "draftValue",
  u: "sigma",
  g: "gamesPlayed",
};

/** Compact footer/status line listing primary shortcuts. */
export function boardShortcutsStatusCopy(): string {
  return (
    "Press / to focus search, f filters, r reset, l copy link, m load more, [ / ] positions, Home/End navigate, " +
    "? for shortcuts. Esc clears search or closes help/filters then the open row; j/k or ↑/↓ move " +
    "(opens first/last if none). Shift+G toggles Starters / All goalies. " +
    "v/e/u/g sorts by VOR / Edge / Σσ / GP."
  );
}

/** Compact site footer chip for board hotkeys. */
export function boardShortcutsFooterChip(): string {
  return "board: / · f · r · l · m · [/] · Home/End · v/e/u/g · Shift+G · ? · j/k · Enter · Esc · CSV/JSON/Link";
}
