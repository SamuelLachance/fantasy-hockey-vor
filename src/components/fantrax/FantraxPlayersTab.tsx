"use client";

import { FantraxPlayerTable } from "./fantrax-table";

/**
 * Joueurs: every player of the league (prospects included), filters, sorts,
 * columns. The same view list for every Fantrax league — the table drops the
 * ones a league's data cannot apply (« Meilleure valeur dynastie » in a league
 * with no keeper model), so nothing here is per league. « Espoirs » is NOT one
 * of those: it is the only view that lists the players nobody projects, which a
 * keeper league's 38-round draft spends half its picks on, and it falls back to
 * ADP where dynasty values and Ros% are both missing.
 */
export function FantraxPlayersTab({ slug }: { slug: string }) {
  return (
    <FantraxPlayerTable
      id="joueurs"
      title="Liste des joueurs"
      description="Espoirs compris. La vue (filtres, tri, colonnes) est gardée dans l’adresse de la page : mettez-la en favori ou partagez-la."
      base="tous"
      presets={["tous", "repechage", "dynastie", "espoirs", "autonomes", "equipe"]}
      perPage={50}
      showTotal
      key={slug}
    />
  );
}
