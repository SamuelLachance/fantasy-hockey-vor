/**
 * French (Québec) copy and formatters for the /league page. The plan
 * carries codes and numbers only; every word the page shows comes from
 * here, so the copy is testable without a browser.
 *
 * Numbers and dates are built by hand, not with `Intl` locale data: the
 * page is prerendered in Node and hydrated in whatever browser opens it,
 * and ICU builds disagree on details such as "sept." vs "sep." or the
 * narrow no-break space, which would be a hydration mismatch. `Intl` is
 * only used for Eastern wall-clock parts, which every engine agrees on.
 */
import { CLAIMS_PER_WEEK, LEAGUE_TIME_ZONE, type SlotId } from "./config";
import type { PlanAlert, TeamGame } from "./daily-plan";
import type { DeadReason } from "./roster-rules";

// ------------------------------------------------------------ numbers

const NBSP = " ";
const MINUS = "−";

/** `3.714` → `3,71`; negative values get a real minus sign. */
export function fmtNum(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return "—";
  const s = Math.abs(x).toFixed(digits).replace(".", ",");
  return x < 0 && Number(s.replace(",", ".")) !== 0 ? `${MINUS}${s}` : s;
}

/** Always signed: `+2,42`, `−0,50`, `+0,00`. */
export function fmtSigned(x: number, digits = 2): string {
  const s = fmtNum(x, digits);
  return s.startsWith(MINUS) ? s : `+${s}`;
}

/** Probability → `56 %` (French puts a space before the sign). */
export function fmtPct(p: number): string {
  return `${Math.round(p * 100)}${NBSP}%`;
}

export function plural(n: number, one: string, many: string): string {
  return Math.abs(n) >= 2 ? many : one;
}

/** 1 → `1re`, 2 → `2e` (rounds, ranks). */
export function ordinal(n: number): string {
  return n === 1 ? "1re" : `${n}e`;
}

// ------------------------------------------------------------ dates

const WEEKDAYS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const WEEKDAYS_MIN = ["di", "lu", "ma", "me", "je", "ve", "sa"];
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juill.", "août", "sept.", "oct.", "nov.", "déc."];

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: LEAGUE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

interface EtParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
  /** Minutes from UTC (−240 in summer, −300 in winter). */
  offset: number;
}

/** Eastern wall-clock parts of an instant. */
export function etParts(ms: number): EtParts {
  const parts = partsFmt.formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour") % 24;
  const minute = get("minute");
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offset = Math.round((wall - Math.floor(ms / 60_000) * 60_000) / 60_000);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, hour, minute, weekday, offset };
}

const two = (n: number) => String(n).padStart(2, "0");

/** `17 h 00` */
export function fmtTime(iso: string): string {
  const p = etParts(Date.parse(iso));
  return `${p.hour}${NBSP}h${NBSP}${two(p.minute)}`;
}

/** `HAE` (heure avancée de l'Est) or `HNE` (heure normale). */
export function fmtZone(iso: string): string {
  return etParts(Date.parse(iso)).offset === -240 ? "HAE" : "HNE";
}

/** `mar. 29 sept.` for an instant (Eastern calendar day). */
export function fmtDay(iso: string): string {
  const p = etParts(Date.parse(iso));
  return `${WEEKDAYS[p.weekday]} ${p.day}${NBSP}${MONTHS[p.month - 1]}`;
}

/** `mar. 29 sept.` for a `YYYY-MM-DD` calendar date. */
export function fmtCalendarDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${d}${NBSP}${MONTHS[m - 1]}`;
}

/** Week-grid column head for a `YYYY-MM-DD`: `{ day: "ma", date: "29" }`. */
export function gridDay(date: string): { day: string; date: string } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return { day: WEEKDAYS_MIN[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!, date: String(d) };
}

/** `29 sept.` */
export function fmtShortDate(iso: string): string {
  const p = etParts(Date.parse(iso));
  return `${p.day}${NBSP}${MONTHS[p.month - 1]}`;
}

/** `11 oct.` for a `YYYY-MM-DD` calendar date. */
export function fmtShortCalendarDate(date: string): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${d}${NBSP}${MONTHS[m - 1]}`;
}

/** `ven. 25 sept., 10 h 27 HAE` */
export function fmtDateTime(iso: string): string {
  return `${fmtDay(iso)}, ${fmtTime(iso)} ${fmtZone(iso)}`;
}

/** Time left before a lock: `dans 4 j 6 h`, `dans 2 h 05 min`, `dans 12 min`, `verrouillé`. */
export function fmtCountdown(targetMs: number, nowMs: number): string {
  const mins = Math.floor((targetMs - nowMs) / 60_000);
  if (mins <= 0) return "verrouillé";
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `dans ${d}${NBSP}j ${h}${NBSP}h`;
  if (h > 0) return `dans ${h}${NBSP}h ${two(m)}${NBSP}min`;
  return `dans ${m}${NBSP}min`;
}

/** Time since a past instant: `à l'instant`, `il y a 17 min`, `il y a 3 h`, `il y a 2 j`. */
export function fmtAgo(thenMs: number, nowMs: number): string {
  const mins = Math.floor((nowMs - thenMs) / 60_000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins}${NBSP}min`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `il y a ${h}${NBSP}h`;
  return `il y a ${Math.floor(h / 24)}${NBSP}j`;
}

// ------------------------------------------------------------ hockey words

export const SLOT_LABEL: Record<SlotId, string> = {
  C: "Centre",
  W: "Ailier",
  F: "Attaquant (C ou W)",
  D: "Défenseur",
  Skt: "Capitaine (attaque ×1,5)",
  G: "Gardien",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Actif",
  RESERVE: "Réserve",
  INJURED_RESERVE: "Blessés (IR)",
  MINORS: "Mineures",
  FA: "Joueur autonome",
  WW: "Au ballottage",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

/** Where a lineup move starts: a slot code as Fantrax shows it, or a status. */
export function moveEndLabel(value: string): string {
  return STATUS_LABEL[value] ?? value;
}

const DEAD_REASON: Record<DeadReason, string> = {
  "minor-leagues": "assigné aux ligues mineures",
  injured: "blessé",
  suspended: "suspendu",
  inactive: "inactif",
  "nhl-free-agent": "sans contrat dans la LNH",
  "no-team": "sans équipe dans la LNH",
};

export function deadReasonLabel(reason: string | undefined): string {
  return (reason && DEAD_REASON[reason as DeadReason]) || "ne joue pas";
}

/** Primary positions for display: `C,F,Skt` → `C`, `W,C,F,Skt` → `W/C`. */
export function positionsLabel(eligiblePos: string): string {
  const t = eligiblePos.split(",").filter((x) => x === "C" || x === "W" || x === "D" || x === "G");
  return t.join("/") || eligiblePos;
}

/** `vs FLA · 17 h 00` (home), `@ VGK · 22 h 30` (away), or no game. */
export function gameLabel(game: TeamGame | null): string {
  if (!game) return "Pas de match";
  return `${game.home ? "vs" : "@"} ${game.opp} · ${fmtTime(game.startUTC)}`;
}

// ------------------------------------------------------------ alerts

export type NameOf = (id: string | null | undefined) => string;

/** What to do with a dead active player; Reserve keeps him counted. */
const DEAD_MOVE_TAIL: Record<string, string> = {
  RESERVE: " Mettez-le en réserve : il compte encore pour le minimum de joueurs.",
  MINORS: " Envoyez-le aux mineures.",
  INJURED_RESERVE: " Placez-le sur la liste des blessés.",
  none: " Remplacez-le.",
};

const LIMIT_LABEL: Record<string, string> = {
  "too-many-active": "Trop de joueurs actifs",
  "too-many-reserve": "Trop de joueurs en réserve",
  "too-many-ir": "Trop de joueurs sur la liste des blessés",
  "too-many-minors": "Trop de joueurs dans les mineures",
  "slot-over": "Trop de joueurs au poste",
};

/**
 * One sentence per alert. `illegal-roster` returns null: the legality
 * summary above the list already says it, with the fixes.
 */
export function alertText(a: PlanAlert, name: NameOf): string | null {
  const n = a.count ?? 0;
  switch (a.code) {
    case "illegal-roster":
      return null;
    case "dead-active": {
      const who = name(a.ids?.[0]);
      return `${who} occupe un poste ${a.slot ?? ""} actif mais ne peut pas marquer (${deadReasonLabel(a.detail)}).${DEAD_MOVE_TAIL[a.to ?? "none"]}`;
    }
    case "empty-slot":
      return `${n} ${plural(n, "poste", "postes")} ${a.slot ?? ""} ${plural(n, "vide", "vides")}.`;
    case "healthy-ir":
      return `En santé sur la liste des blessés (illégal après 2 périodes d'alignement) : ${(a.ids ?? []).map((id) => name(id)).join(", ")}.`;
    case "roster-limit":
      return `${LIMIT_LABEL[a.detail ?? ""] ?? "Limite d'effectif dépassée"}${a.slot ? ` ${a.slot}` : ""} : ${n}/${a.limit ?? "?"}.`;
    case "over-max-after-moves":
      return `Les mouvements suggérés portent Actifs + Réserve à ${n} (max. ${a.limit ?? "?"}) : envoyez un joueur aux mineures ou libérez-en un.`;
    case "fxpa-down":
      return "Données Fantrax partielles à la dernière synchronisation : plafonds de matchs, blessures et statut des mineures inconnus.";
    case "stale-data":
      return `Les données datent de ${n}${NBSP}h : la synchronisation automatique semble en retard.`;
    default:
      return null;
  }
}

// ------------------------------------------------------------ sentences

export function legalitySummary(l: {
  illegal: boolean;
  need: number;
  minTotal: number;
  counts: { active: number; reserve: number; ir: number; minors: number; counted: number };
}): string {
  const c = l.counts;
  const base = `${c.counted}/${l.minTotal} joueurs comptés (Actifs ${c.active} + Réserve ${c.reserve}; blessés ${c.ir} et mineures ${c.minors} ne comptent pas)`;
  if (l.need > 0) {
    return `Alignement illégal : ${base}. Il en manque ${l.need} — sinon l'équipe ne marque aucun point.`;
  }
  return l.illegal ? `Alignement illégal : ${base}.` : `Alignement légal : ${base}.`;
}

export function claimsText(used: number | null, left: number | null): string {
  if (used === null || left === null) {
    return `Réclamations utilisées inconnues (fxpa indisponible) : ${CLAIMS_PER_WEEK} par semaine, remise à zéro le lundi.`;
  }
  return `Réclamations cette semaine : ${used}/${CLAIMS_PER_WEEK} utilisées, ${left} ${plural(left, "restante", "restantes")} (remise à zéro le lundi).`;
}
