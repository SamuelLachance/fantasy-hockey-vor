/**
 * The words and cells of a salary-cap league's contracts (Slapshot): the
 * contract-end label, the salary cell and the table legend. Apart from
 * table-copy.ts so a league without a cap — whose tabs load table-copy with
 * every table — never ships them: the table renders these through lazy
 * pieces (ContractCells.tsx), the draft board and the details row (both lazy)
 * import them directly.
 */

/** No-break space (U+00A0), as table-copy uses. */
const NBSP = " ";

/**
 * The legend of a salary-cap dynasty league (Slapshot): no cutdown, no
 * « Conseil », but the cap charge inside the value and the salary columns.
 */
export const SLAPSHOT_LEGEND = `Valeur dyn.${NBSP}: points au-dessus du remplacement sur 12 saisons, nets du coût de son salaire sous le plafond, pas des points de la saison (ne pas additionner). Salaire${NBSP}: moyenne annuelle de son contrat LNH réel (en italique, un contrat projeté). Fourchette${NBSP}: 8 chances sur 10 que la valeur finisse entre ces bornes. Chances LNH${NBSP}: devenir un régulier.`;

/** « 2031-32 · JAS » (the contract column), « sans contrat » for a player with no signed season. */
export function contractEndLabel(c: { signed: number; expiry: number | null; status: "UFA" | "RFA" | null; elc: boolean }, firstSeason = 2026): string {
  if (c.signed === 0) return "sans contrat";
  const last = firstSeason + c.signed - 1;
  const season = `${last}-${String((last + 1) % 100).padStart(2, "0")}`;
  const st = c.status === "RFA" ? "JAC" : c.status === "UFA" ? "JAS" : null;
  return c.expiry === null ? `${season}+` : st ? `${season} · ${st}` : season;
}

/** « 12,5 » (M$ in a salary cell: one decimal from 10, two below). */
export function salaryCell(m: number | null): string {
  if (m === null) return "—";
  const d = m >= 10 ? 1 : 2;
  return (Math.round(m * 10 ** d) / 10 ** d).toFixed(d).replace(".", ",");
}
