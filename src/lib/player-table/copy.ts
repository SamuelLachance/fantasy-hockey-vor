/**
 * Generic French copy of the player tables (counter, sort buttons, pages),
 * built by hand like every number on the site (no locale data: the
 * prerendered HTML and the browser must agree).
 */
import { plural } from "@/lib/fantrax/league-copy";
import type { SortDir } from "./types";

/** No-break space (U+00A0). */
const NBSP = " ";

/** `2650` → `2 650`. */
export function fmtInt(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return n < 0 ? `−${grouped}` : grouped;
}

/** Accessible name of a sortable header button. */
export function sortButtonLabel(label: string, active: boolean, dir: SortDir): string {
  if (!active) return `Trier par ${label}`;
  return `${label}, tri ${dir === "asc" ? "croissant" : "décroissant"} (cliquer pour inverser)`;
}

/** `1 234 joueurs · page 2 sur 25`. */
export function resultsText(total: number, page: number, pages: number): string {
  if (total === 0) return "Aucun joueur ne correspond à ces filtres.";
  const base = `${fmtInt(total)} ${plural(total, "joueur", "joueurs")}`;
  return pages > 1 ? `${base} · page ${page} sur ${pages}` : base;
}

/** `trié par Valeur, décroissant` (the sort is named even when its column is hidden). */
export function sortSummary(sort: { label: string; dir: SortDir }): string {
  return `trié par ${sort.label}, ${sort.dir === "asc" ? "croissant" : "décroissant"}`;
}

/** The counter line: results, then the sort. */
export function counterText(total: number, page: number, pages: number, sort: { label: string; dir: SortDir }): string {
  return total === 0 ? resultsText(total, page, pages) : `${resultsText(total, page, pages)} · ${sortSummary(sort)}`;
}

export const TABLE_COPY = {
  loading: "Chargement des joueurs…",
  loadingFull: "Chargement de la liste complète…",
  loadingExtras: "Chargement des données dynastie et Snake…",
  error: "Impossible de charger les joueurs.",
  retry: "Réessayer",
  empty: "Essayez d’élargir les filtres.",
  resetFilters: "Réinitialiser les filtres",
  notInPool: "Ce joueur ne fait pas partie du bassin de cette ligue.",
  pages: "Pages de résultats",
  previous: "Précédente",
  next: "Suivante",
  perPage: "Par page",
  presets: "Vues rapides",
  columns: "Colonnes",
  columnsLegend: "Colonnes affichées",
  lazyColumn: "(chargé à la demande)",
  reset: "Réinitialiser",
  filters: "Filtres",
  search: "Joueur ou équipe",
  searchPlaceholder: "Rechercher un joueur ou une équipe",
  form: "Filtres des joueurs",
  player: "Joueur",
  details: "Détails",
  /** The pool next to a title that names it all (« Bassin : 2 644 joueurs »). */
  poolTotal: (n: string) => `Bassin${NBSP}: ${n}${NBSP}joueurs`,
} as const;

/** `Détails de X` / `Masquer les détails de X`. */
export function detailsToggleLabel(name: string, open: boolean): string {
  return open ? `Masquer les détails de ${name}` : `Détails de ${name}`;
}

/** Caption of a table (read before its rows). */
export function tableCaption(title: string, counter: string): string {
  return `${title}, ${counter}. Les en-têtes de colonnes trient le tableau.`;
}
