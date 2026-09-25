/**
 * French copy for everything Snake on the site (pure, no locale data needed).
 */
import type { SnakeStance, SnakeTrend } from "./types";

export const SNAKE_SCOUT_NAME = "Simon « Snake » Boisvert";

/** Short disclaimer shown wherever Snake content appears (its own tiny module: see ./disclaimer). */
export { SNAKE_DISCLAIMER_SHORT } from "./disclaimer";

/** Full disclaimer (the /snake page). */
export const SNAKE_DISCLAIMER_FULL: readonly string[] = [
  "Cette page n'est pas officielle. Les résumés sont générés automatiquement à partir des sous-titres automatiques de YouTube des balados publics auxquels participe Simon « Snake » Boisvert.",
  "Ce sont des paraphrases en français, pas des citations : les propos sont reformulés et résumés, jamais présentés comme ses mots exacts. Les sous-titres automatiques déforment souvent les noms et les propos, alors un résumé peut contenir des erreurs de transcription, de compréhension ou d'attribution (propos d'un autre intervenant, mauvais joueur, mauvais contexte).",
  "Ce site n'a aucune affiliation avec Simon Boisvert ni avec les émissions citées, et rien ici n'est approuvé par eux.",
  "Avant de vous fier à une opinion, écoutez la source : chaque opinion renvoie au passage de la vidéo publique, avec sa date et le nom de l'émission.",
];

export const SNAKE_ATTRIBUTION_POLICY =
  "Les passages dont l'attribution à Snake est incertaine ne sont jamais publiés, pas plus que ceux dont le joueur est mal identifié. Ceux dont l'attribution est seulement probable portent la mention « attribution probable ».";

export const SNAKE_PROBABLE_LABEL = "attribution probable";
export const SNAKE_PROBABLE_TITLE =
  "Le passage semble venir de Snake, sans certitude : vérifiez dans la vidéo.";

/**
 * Note above a row whose source synthesis was withheld (`dv`): it stands on
 * one published opinion, dated `sd`.
 */
export function snakeDerivedNote(date: string | null | undefined, probable: boolean): string {
  const when = date ? ` du ${formatSnakeDate(date)}` : "";
  return `Synthèse automatique retirée : elle s'appuyait aussi sur des passages qui ne sont pas publiés. Voici plutôt son opinion publiée${when}, la plus récente${probable ? "" : " dont l'attribution est certaine"}.`;
}

/** Note above a synthesis trimmed to what the published opinions support (`tr`). */
export const SNAKE_TRIMMED_NOTE =
  "Synthèse abrégée : les passages qui reposaient sur des extraits non publiés (attribution incertaine ou joueur mal identifié) en ont été retirés.";

/** "2022 #62 MTL" → "2022, 62e choix (MTL)" (other formats unchanged). */
export function formatDraftFr(draft: string): string {
  const m = /^(\d{4}) #(\d{1,3}) ([A-Z]{2,3})$/.exec(draft.trim());
  if (!m) return draft.trim();
  const n = Number(m[2]);
  return `${m[1]}, ${n === 1 ? "1er" : `${n}e`} choix (${m[3]})`;
}

const STANCE_LABEL: Record<SnakeStance, string> = {
  "très positif": "Très positif",
  positif: "Positif",
  neutre: "Neutre",
  mitigé: "Mitigé",
  négatif: "Négatif",
  "très négatif": "Très négatif",
};

/** Capitalized verdict label. */
export function stanceLabel(s: SnakeStance): string {
  return STANCE_LABEL[s] ?? s;
}

const STANCE_SYMBOL: Record<SnakeStance, string> = {
  "très positif": "++",
  positif: "+",
  neutre: "=",
  mitigé: "±",
  négatif: "−",
  "très négatif": "−−",
};

/** Compact symbol for tight spots (board chip). */
export function stanceSymbol(s: SnakeStance): string {
  return STANCE_SYMBOL[s] ?? "?";
}

/** Sort score: higher = more positive. */
export function stanceScore(s: SnakeStance): number {
  switch (s) {
    case "très positif":
      return 5;
    case "positif":
      return 4;
    case "neutre":
      return 3;
    case "mitigé":
      return 2;
    case "négatif":
      return 1;
    case "très négatif":
      return 0;
    default:
      return 2.5;
  }
}

/** Tailwind classes for a verdict chip (text + ring + background; never color alone). */
export function stanceToneClass(s: SnakeStance): string {
  switch (s) {
    case "très positif":
      return "bg-emerald-400/20 text-emerald-100 ring-emerald-300/50";
    case "positif":
      return "bg-emerald-500/10 text-emerald-200 ring-emerald-500/30";
    case "neutre":
      return "bg-white/5 text-slate-200 ring-white/15";
    case "mitigé":
      return "bg-amber-500/10 text-amber-200 ring-amber-500/30";
    case "négatif":
      return "bg-rose-500/10 text-rose-200 ring-rose-500/30";
    case "très négatif":
      return "bg-rose-500/25 text-rose-100 ring-rose-400/50";
    default:
      return "bg-white/5 text-slate-200 ring-white/15";
  }
}

const TREND_LABEL: Record<SnakeTrend, string> = {
  "en hausse": "En hausse",
  stable: "Stable",
  variable: "Variable",
  "en baisse": "En baisse",
  inconnue: "Tendance inconnue",
};

export function trendLabel(t: SnakeTrend): string {
  return TREND_LABEL[t] ?? t;
}

/**
 * Chip / aria text: "Avis de Snake : positif, en hausse", or with a name
 * "Avis de Snake sur Lane Hutson : positif, en hausse".
 */
export function snakeVerdictAria(v: SnakeStance, t?: SnakeTrend | null, probable?: boolean, name?: string): string {
  const trend = t && t !== "inconnue" ? `, ${t}` : "";
  return `Avis de Snake${name ? ` sur ${name}` : ""} : ${v}${trend}${probable ? ` (${SNAKE_PROBABLE_LABEL})` : ""}`;
}

/** Hover text of the compact chips: the verdict plus what it is. */
export function snakeChipTitle(v: SnakeStance, t?: SnakeTrend | null, probable?: boolean): string {
  return `${snakeVerdictAria(v, t, probable)}. Résumé non officiel, généré automatiquement à partir de ses balados publics.`;
}

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juill.", "août", "sept.", "oct.", "nov.", "déc."];
const NBSP = " ";

/** "2026-09-22" → "22 sept. 2026" (non-breaking spaces). */
export function formatSnakeDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return iso;
  return `${Number(m[3])}${NBSP}${month}${NBSP}${m[1]}`;
}

/** 9545 → "9 545" (French grouping with a non-breaking space; no locale data). */
export function formatCountFr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−" : "";
  const digits = String(Math.round(Math.abs(n)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** French plural helper: 1 opinion, 2 opinions. */
export function plural(n: number, one: string, many: string): string {
  return `${formatCountFr(n)}${NBSP}${Math.abs(n) >= 2 ? many : one}`;
}

const POSITION_LABEL: Record<string, string> = {
  C: "centre",
  LW: "ailier gauche",
  RW: "ailier droit",
  D: "défenseur",
  G: "gardien",
  F: "attaquant",
};

export function positionLabel(pos: string | null): string {
  return pos ? (POSITION_LABEL[pos] ?? pos) : "position inconnue";
}

/** "1er", "2e" (rank mentions). */
export function rankOrdinal(n: number): string {
  return n === 1 ? "1er" : `${n}e`;
}

/** Hockey season of a date: July 1 starts the next season ("2025-26"). */
export function seasonOf(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const start = m >= 7 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
