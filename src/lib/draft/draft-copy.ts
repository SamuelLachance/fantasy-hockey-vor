import type { LeagueCategory, StartingSlot } from "../leagues/types";

/**
 * French (Québec) copy and number formatting for the draft helper. Stat
 * abbreviations stay Yahoo's (the league runs on Yahoo; that is what the
 * draft room shows), with French names for titles and screen readers.
 *
 * Numbers are formatted by hand, not with `toLocaleString("fr-CA")`: the
 * page is prerendered, and ICU builds disagree on the fr-CA group separator
 * (U+00A0 vs U+202F), which would be a hydration mismatch.
 */

export const CATEGORY_SHORT: Record<LeagueCategory, string> = {
  goals: "G",
  assists: "A",
  powerplayPoints: "PPP",
  shots: "SOG",
  hits: "HIT",
  blocks: "BLK",
  penaltyMinutes: "PIM",
  faceoffWins: "FOW",
  wins: "W",
  goalsAgainstAverage: "GAA",
  savePct: "SV%",
  shutouts: "SHO",
};

export const CATEGORY_FR: Record<LeagueCategory, string> = {
  goals: "Buts",
  assists: "Aides",
  powerplayPoints: "Points en avantage numérique",
  shots: "Tirs au but",
  hits: "Mises en échec",
  blocks: "Tirs bloqués",
  penaltyMinutes: "Minutes de pénalité",
  faceoffWins: "Mises au jeu gagnées",
  wins: "Victoires",
  goalsAgainstAverage: "Moyenne de buts alloués",
  savePct: "Pourcentage d’arrêts",
  shutouts: "Blanchissages",
};

export const SLOT_FR: Record<StartingSlot | "BN", string> = {
  C: "C",
  LW: "LW",
  RW: "RW",
  F: "F",
  D: "D",
  Util: "Util",
  G: "G",
  BN: "Banc",
};

const NBSP = String.fromCharCode(0xa0);

/** 1234.5 → "1 234,5" (non-breaking space groups, decimal comma). */
export function formatFr(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  const fixed = Math.abs(value).toFixed(digits);
  const [int, dec] = fixed.split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const sign = value < 0 && Number(fixed) !== 0 ? "−" : "";
  return `${sign}${grouped}${dec ? `,${dec}` : ""}`;
}

/** Signed, with a plus: "+2,4" / "−0,8" / "0,0". */
export function formatSignedFr(value: number, digits = 1): string {
  const body = formatFr(value, digits);
  if (body.startsWith("−") || Number(Math.abs(value).toFixed(digits)) === 0) return body;
  return `+${body}`;
}

/** 0.64 → "64 %". */
export function formatPercentFr(p: number): string {
  return `${formatFr(p * 100, 0)}${NBSP}%`;
}

export function pickLabel(pick: number): string {
  return `n°${NBSP}${pick}`;
}

/** Display one projected stat in its natural precision (smoothed SHO: one decimal). */
export function formatStat(cat: LeagueCategory, value: number): string {
  if (cat === "savePct") return formatFr(value, 3);
  if (cat === "goalsAgainstAverage") return formatFr(value, 2);
  if (cat === "shutouts") return formatFr(value, 1);
  return formatFr(value, 0);
}

export function yearsLabel(age: number | null): string {
  return age == null ? "" : `${age}${NBSP}ans`;
}

/** "dans 3 choix" / "dans 1 choix" / "maintenant". */
export function picksAwayLabel(n: number): string {
  if (n <= 0) return "maintenant";
  return `dans ${n}${NBSP}choix`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const DAYS_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MONTHS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

/**
 * "2026-09-27T14:00:00-04:00" → "dimanche 27 septembre 2026, 14 h (HAE)".
 * Read straight off the string (the league's own wall clock), never through
 * the viewer's timezone, so build and browser always agree.
 */
export function formatDraftStartFr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d, hh, mm, tz] = m;
  const dow = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))).getUTCDay();
  const zone = tz === "-04:00" ? " (HAE)" : tz === "-05:00" ? " (HNE)" : "";
  const time = mm === "00" ? `${Number(hh)}${NBSP}h` : `${Number(hh)}${NBSP}h${NBSP}${mm}`;
  return `${DAYS_FR[dow]} ${Number(d)} ${MONTHS_FR[Number(mo) - 1]} ${y}, ${time}${zone}`;
}

/** "2026-08-11T06:13:44Z" → "11 août 2026" (UTC calendar date). */
export function formatDateFr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS_FR[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * Keyboard shortcuts. No bare-letter shortcut on purpose: any letter typed
 * outside a field goes to the search box (type-to-search), so typing a
 * player's name can never trigger an action.
 */
export const DRAFT_SHORTCUTS: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: "a–z", label: "Taper un nom n’importe où : il va dans la recherche" },
  { keys: "/", label: "Aller à la recherche" },
  {
    keys: "Entrée",
    label: "Marquer le joueur surligné : mon choix quand c’est à vous, sinon repêché par une autre équipe",
  },
  { keys: "Maj + Entrée", label: "L’inverse (autre équipe quand c’est à vous, sinon mon choix)" },
  { keys: "↑ ↓", label: "Changer de joueur surligné (dans la recherche)" },
  { keys: "Échap", label: "Vider la recherche, puis quitter le champ" },
  { keys: "Ctrl + Z", label: "Annuler la dernière action (aussi dans la recherche vide)" },
  { keys: "1 à 7", label: "Filtre : Tous, C, LW, RW, F, D, G (hors champ texte)" },
];

/**
 * Who is on the clock at `pick` vs how it was marked. null when fine or when
 * our slot is unknown.
 */
export function pickOwnerMismatch(
  pickSlot: number,
  mySlot: number | null,
  markedMine: boolean,
): "marked-mine-not-my-pick" | "my-pick-marked-other" | null {
  if (mySlot == null) return null;
  const isMine = pickSlot === mySlot;
  if (isMine === markedMine) return null;
  return markedMine ? "marked-mine-not-my-pick" : "my-pick-marked-other";
}
