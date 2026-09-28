/**
 * The words only a points league with a salary cap says (Slapshot): « Valeur
 * (VOR) » instead of season points, the salary and contract columns, the
 * cap's alert, the closed-fxpa notice, and the dynasty note without a
 * cutdown. Apart from league-copy.ts / table-copy.ts, which every Fantrax tab
 * loads: this module reaches the browser only through the league pack
 * (`CapLeagueShell`), which only such a league's tabs load, and the
 * server (home cards) imports it directly.
 */
import { DYNASTY_MODE_LABEL, type DynastyMode } from "./dynasty-mode";
import type { NameOf } from "./league-copy";
import type { LeagueCopy } from "./league-pack";
import { fmtMoney } from "./money";
import type { ColumnCopy, ColumnCopyCtx } from "./table-copy";
import type { ColumnKey } from "./table";

/** No-break space (U+00A0), as the other copy modules use. */
const NBSP = " ";

/** « 26-27 » (short season label of the contract columns). */
const shortSeason = (y: number) => `${String(y % 100).padStart(2, "0")}-${String((y + 1) % 100).padStart(2, "0")}`;

/** Alerts only such a league raises; null for any other code (league-copy's `alertText` words those). */
function alertText(a: { code: string; count?: number; limit?: number; ids?: string[] }, name: NameOf): string | null {
  const n = a.count ?? 0;
  switch (a.code) {
    case "fxpa-closed":
      return "Cette ligue ne publie pas ses détails joueur : blessures, % de ligues Fantrax et priorité au ballottage ne sont pas lisibles sans être membre. L'alignement optimal ne sait donc pas qui est blessé — vérifiez dans Fantrax avant de le reproduire.";
    case "salary-over": {
      const top = (a.ids ?? []).map((id) => name(id)).join(", ");
      return `Masse salariale dépassée : ${fmtMoney(n)} pour un plafond de ${fmtMoney(a.limit ?? 0)} (Actifs + Réserve). Envoyez un salarié aux mineures ou sur la liste des blessés (ils ne comptent pas)${top ? `; plus gros salaires : ${top}` : ""}.`;
    }
    default:
      return null;
  }
}

/**
 * The headers this league words its own way; null for the others
 * (table-copy's `columnCopy` then answers). « Valeur » is points over
 * replacement here — the only number that compares a gardien to a centre —
 * and the season total covers the league's own (shorter) season.
 */
function column(col: ColumnKey, ctx: ColumnCopyCtx): ColumnCopy | null {
  switch (col) {
    case "valeur":
      return ctx.vor
        ? {
            label: "Valeur (VOR)",
            title: `Points au-dessus du remplacement${NBSP}: ses points projetés de la saison moins ceux du dernier partant de la ligue qui pourrait prendre son poste (remplissage optimal de tous les postes partants de la ligue, positions multiples comprises). Ajoutez la colonne « FP saison » pour le total brut`,
          }
        : null;
    case "fp":
      return ctx.seasonShare !== undefined && ctx.seasonShare < 1
        ? {
            label: "FP saison",
            title: `Points de fantasy projetés sur la saison régulière de la ligue (environ ${Math.round(ctx.seasonShare * 100)}${NBSP}% des matchs de la LNH)`,
          }
        : null;
    case "sal":
    case "sal2": {
      const y = (ctx.capSeason ?? 2026) + (col === "sal2" ? 1 : 0);
      return {
        label: `Salaire ${shortSeason(y)}`,
        title: `Salaire ${shortSeason(y)} (moyenne annuelle de son contrat LNH réel pour cette saison, M$)${NBSP}: ce qui compte au plafond de la ligue s’il est parmi les 23 Actifs + Réserve (mineures et blessés ne comptent pas). Après la fin de son contrat, son prochain contrat projeté (en italique)${NBSP}; un espoir sans contrat LNH ne compte rien avant son arrivée prévue, puis un contrat d’entrée supposé`,
      };
    }
    case "contrat":
      return {
        label: "Fin de contrat",
        title: "Dernière saison de son contrat LNH signé, et son statut à l’échéance (JAS : joueur autonome sans compensation, JAC : avec compensation)",
      };
    default:
      return null;
  }
}

/** Repêchage: what the season columns and the dynasty value each measure (a dynasty league without a cutdown, with a salary cap). */
function dynastyDraftNote(mode: DynastyMode): string {
  return `Valeur (VOR), VONA et Dispo. comptent les points de la saison 2026-27 de la ligue (saison régulière jusqu’à la fin février, comme un repêchage d’un an); Valeur dyn. (mode ${DYNASTY_MODE_LABEL[mode]}) compte les 12 prochaines saisons, nettes du coût de chaque salaire sous le plafond${NBSP}: deux unités différentes, à ne pas additionner.`;
}

export const CAP_LEAGUE_COPY: LeagueCopy = {
  alertText,
  column,
  vorBoardNote: `Valeur (VOR) = points projetés au-dessus du remplacement à sa position${NBSP}: ses points de saison moins ceux du dernier partant de la ligue qui pourrait prendre son poste. C'est le seul chiffre qui compare un gardien à un centre; ajoutez la colonne «${NBSP}FP saison${NBSP}» (Colonnes → Projection) pour le total brut.`,
  vorTableNote: `Valeur (VOR) = points projetés au-dessus du remplacement à sa position (comme au repêchage)${NBSP}: le seul chiffre qui compare un gardien à un centre. Ajoutez la colonne «${NBSP}FP saison${NBSP}» (Colonnes → Projection) pour le total brut.`,
  dynastyDraftNote,
};
