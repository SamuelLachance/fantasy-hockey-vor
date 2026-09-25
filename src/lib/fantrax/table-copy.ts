/**
 * French copy of the Captains Dynasty player table (column labels, cell
 * text, notes), kept out of the components so it is testable without a
 * browser. Numbers go through the same hand-built formatters as the rest
 * of the site; the generic table copy is in `@/lib/player-table/copy`.
 */
import { fmtInt } from "@/lib/player-table/copy";
import { FANTRAX_ICON } from "./config";
import type { ColumnKey, FantraxRow, FantraxType, SortKey } from "./table";
import { fmtNum, fmtOdds, pickLabel } from "./league-copy";

/** No-break space (U+00A0), as league-copy uses. */
const NBSP = " ";

export interface ColumnCopy {
  /** Header text (short). */
  label: string;
  /** Full meaning (header tooltip, column chooser, sort button name). */
  title: string;
}

export function columnCopy(col: ColumnKey, nextPick: number | null): ColumnCopy {
  switch (col) {
    case "statut":
      return { label: "Statut", title: "Où il est : disponible, au ballottage ou dans quelle équipe" };
    case "valeur":
      return { label: "Valeur", title: `Points projetés sur la saison, jusqu'à +50${NBSP}% si vos postes D ou G sont vides` };
    case "vona":
      return { label: "VONA", title: "Valeur moins le meilleur attendu à sa position à votre choix suivant" };
    case "dispo":
      return {
        label: nextPick !== null ? `Dispo. au ${pickLabel(nextPick)}` : "Dispo.",
        title: "Chance qu'il soit encore disponible à votre prochain choix",
      };
    case "fp":
      return { label: "FP saison", title: "Points de fantasy projetés sur la saison" };
    case "fpm":
      return { label: "FP/match", title: "Points de fantasy projetés par match joué (par départ pour un gardien)" };
    case "age":
      return { label: "Âge", title: "Âge" };
    case "ros":
      return { label: "% Fantrax", title: "Part des ligues Fantrax où il est pris cette semaine" };
    case "adp":
      return { label: "ADP", title: "Rang moyen de sélection dans les repêchages Fantrax" };
    case "lnh":
      return { label: "Repêchage LNH", title: "Année, rang et équipe au repêchage de la LNH" };
    case "dyn":
      return { label: "Valeur dyn.", title: "Valeur dynastie (modèle à long terme)" };
    case "phase":
      return { label: "Phase", title: "Phase de carrière" };
    case "pnhl":
      return { label: "P(LNH)", title: "Probabilité de devenir un régulier dans la LNH" };
    case "eta":
      return { label: "ETA", title: "Saison d'arrivée prévue dans la LNH" };
    case "fourchette":
      return { label: "p10–p90", title: "Fourchette de la valeur dynastie : 10e, 50e et 90e centiles" };
    case "verdict":
      return { label: "Snake", title: "Verdict de Simon « Snake » Boisvert" };
    case "tendance":
      return { label: "Tendance", title: "Tendance de l'opinion de Snake" };
    case "opinions":
      return { label: "Opinions", title: "Nombre d'opinions de Snake publiées" };
    case "synthese":
      return { label: "Avis de Snake", title: "Verdict et synthèse d'une ligne de Simon « Snake » Boisvert" };
    case "conseil":
      return {
        label: "Conseil",
        title: "Indice automatique d’après la valeur dynastie et la phase de carrière — à vérifier",
      };
  }
}

export const SORT_LABEL: Record<SortKey, string> = {
  valeur: "Valeur",
  vona: "VONA",
  dispo: "Disponibilité à mon prochain choix",
  fp: "FP saison",
  fpm: "FP/match",
  age: "Âge",
  adp: "ADP",
  ros: "% Fantrax",
  lnh: "Rang au repêchage LNH",
  nom: "Nom",
  dyn: "Valeur dynastie",
  pnhl: "P(LNH)",
  eta: "ETA",
  verdict: "Verdict de Snake",
  opinions: "Opinions de Snake",
};

export const TYPE_LABEL: Record<FantraxType, string> = {
  tous: "Tous",
  proj: "Projetés",
  espoirs: "Espoirs",
};

/** `2026 · 23e · DET` */
export function nhlDraftLabel(d: FantraxRow["nhlDraft"]): string {
  if (!d) return "—";
  return `${d.year} · ${d.overall}${d.overall === 1 ? "er" : "e"} · ${d.team}`;
}

const ROSTER_STATUS_LABEL: Record<string, string> = {
  A: "actif",
  R: "réserve",
  I: "blessés",
  M: "mineures",
};

export interface StatusCopy {
  text: string;
  tone: "violet" | "emerald" | "amber" | "cyan" | "slate";
  /** Roster slot on that team (actif, réserve, mineures…). */
  detail?: string;
}

/** Where a player is, for the Statut column. */
export function statusCopy(
  row: Pick<FantraxRow, "owner" | "free" | "rosterStatus">,
  ctx: { teamId: string; draftOpen: boolean; teamName: (id: string) => string },
): StatusCopy {
  if (row.owner) {
    const detail = row.rosterStatus ? ROSTER_STATUS_LABEL[row.rosterStatus] : "vient d'être repêché";
    if (row.owner === ctx.teamId) return { text: "Mon équipe", tone: "cyan", detail };
    return { text: ctx.teamName(row.owner), tone: "slate", detail };
  }
  if (ctx.draftOpen) return { text: "Disponible", tone: "violet", detail: row.free === "WW" ? "au repêchage (ballottage)" : "au repêchage" };
  return row.free === "WW" ? { text: "Ballottage", tone: "amber" } : { text: "Autonome", tone: "emerald" };
}

/** Short tags for the icons worth a glance (injury, suspension, contract). */
export function iconTags(icons: readonly string[]): Array<{ text: string; title: string; tone: "rose" | "amber" | "slate" }> {
  const out: Array<{ text: string; title: string; tone: "rose" | "amber" | "slate" }> = [];
  const has = (i: string) => icons.includes(i);
  if (has(FANTRAX_ICON.injured) || has(FANTRAX_ICON.nhlInjuredReserve)) {
    out.push({ text: "Blessé", title: "Blessé (liste des blessés de la LNH ou absent)", tone: "rose" });
  } else if (has(FANTRAX_ICON.dayToDay)) {
    out.push({ text: "Jour à jour", title: "Blessure au jour le jour", tone: "amber" });
  }
  if (has(FANTRAX_ICON.suspended)) out.push({ text: "Suspendu", title: "Suspendu", tone: "rose" });
  if (has(FANTRAX_ICON.inactive)) out.push({ text: "Inactif", title: "Inactif ou retraité", tone: "slate" });
  if (has(FANTRAX_ICON.nhlFreeAgent)) out.push({ text: "Sans contrat", title: "Sans contrat dans la LNH", tone: "slate" });
  return out;
}

/** Longer wording for the details row. */
export function iconDetails(icons: readonly string[]): string[] {
  const words: Record<string, string> = {
    [FANTRAX_ICON.dayToDay]: "blessure au jour le jour",
    [FANTRAX_ICON.nhlInjuredReserve]: "sur la liste des blessés de la LNH",
    [FANTRAX_ICON.injured]: "blessé",
    [FANTRAX_ICON.nhlFreeAgent]: "sans contrat dans la LNH",
    [FANTRAX_ICON.minorLeagues]: "assigné aux ligues mineures (LAH, junior ou Europe)",
    [FANTRAX_ICON.suspended]: "suspendu",
    [FANTRAX_ICON.inactive]: "inactif",
  };
  return icons.map((i) => words[i]).filter((w): w is string => !!w);
}

export function sourceLabel(src: FantraxRow["src"]): string {
  return src === "p" ? "Projeté" : src === "e" ? "Espoir" : "Sans projection";
}

/** Cell text for a number column ("—" when missing). */
export function numCell(x: number | null | undefined, digits: number): string {
  return x === null || x === undefined || !Number.isFinite(x) ? "—" : fmtNum(x, digits);
}

export function oddsCell(x: number | null): string {
  return x === null ? "—" : fmtOdds(x);
}

/** 0.72 → `72 %`. */
export function pctCell(x: number | null | undefined): string {
  return x === null || x === undefined ? "—" : `${Math.round(x * 100)}${NBSP}%`;
}

/** The note under the table: what the numbers mean and where they come from. */
export function fantraxTableNote(opts: {
  draftOpen: boolean;
  nextPick: number | null;
  poolAsOf: string;
  counts: { projected: number; prospects: number };
  recentDrafts: [number, number];
  dynasty: boolean;
  snake: boolean;
  /** Under the Repêchage tab's own note (value, VONA and odds already explained there). */
  brief?: boolean;
}): string {
  const parts = [
    `${fmtInt(opts.counts.projected)} joueurs projetés et ${fmtInt(opts.counts.prospects)} espoirs${NBSP}: les joueurs que nous projetons, ceux qui ont un ADP Fantrax, ceux d'une équipe de la ligue ou au ballottage, les choix des repêchages de la LNH ${opts.recentDrafts[0]} à ${opts.recentDrafts[1]} et ceux pris dans au moins 1${NBSP}% des ligues Fantrax.`,
  ];
  if (!opts.brief) {
    parts.push(`Valeur = points projetés sur la saison, jusqu'à +50${NBSP}% si vos postes D ou G sont vides (comme au repêchage).`);
    if (opts.draftOpen && opts.nextPick !== null) {
      parts.push(
        `VONA et Dispo. (chance d'être encore là à votre choix ${pickLabel(opts.nextPick)}) : mêmes calculs que l’onglet Repêchage, pour les joueurs projetés; les choix faits en direct retirent les joueurs repêchés.`,
      );
    }
  }
  parts.push("Les espoirs n'ont pas de projection : triez-les par % Fantrax, ADP, âge ou rang au repêchage de la LNH.");
  if (opts.dynasty) {
    parts.push("Valeur dynastie : modèle à long terme publié avec le site. Conseil : indice automatique d’après la valeur dynastie et la phase de carrière, à vérifier.");
  }
  if (opts.snake) parts.push("Snake : synthèse des opinions de Simon « Snake » Boisvert (paraphrases générées automatiquement).");
  return parts.join(" ");
}
