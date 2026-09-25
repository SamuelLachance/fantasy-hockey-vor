"use client";

import { FantraxPlayerTable } from "./fantrax-table";

/** Captains · Joueurs: every player of the league (prospects included), filters, sorts, columns. */
export function FantraxPlayersTab() {
  return (
    <FantraxPlayerTable
      id="joueurs"
      title="Liste des joueurs"
      description="Espoirs compris. La vue (filtres, tri, colonnes) est gardée dans l’adresse de la page : mettez-la en favori ou partagez-la."
      base="tous"
      presets={["tous", "repechage", "espoirs", "autonomes", "equipe"]}
      perPage={50}
      showTotal
    />
  );
}
