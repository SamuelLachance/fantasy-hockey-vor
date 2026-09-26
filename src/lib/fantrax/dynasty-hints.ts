/**
 * What the Captains tables say about a dynasty.json record (§3.12 of the
 * dynasty spec, in the tables' words): phase labels and their URL tokens,
 * the 2027 cutdown outlook (against his own team's 10 keeper slots when he
 * is still on the roster the model saw, else the league's 160), the
 * « Conseil » hint from the viewer's side (his players, the available ones,
 * the other teams') and a roster's summary line. One vocabulary everywhere:
 * Protéger · À décider · Location · Gratuit. Pure; the model's own numbers.
 */
import { keeperView, NBSP, nearShare, PHASE_FR, phaseLabelFr } from "@/lib/dynasty/keeper-view";
import type { DynastyRecord, KeeperStatus, Mode, Phase } from "@/lib/dynasty/types";

/** Career order (the phase sort and the filter's options). */
export const PHASE_ORDER: readonly Phase[] = [
  "prospect",
  "rising",
  "entering_prime",
  "prime",
  "plateau",
  "declining",
  "late_career",
];

/** The model's phase in French (the sentence's words: « en progression »…). */
export const PHASE_LABEL: Record<Phase, string> = PHASE_FR;

/**
 * The phase filter's options: a phase also covers the cells' softer words
 * for the young (« déjà établi ») and the not-yet-old (« léger déclin »).
 */
export const PHASE_FILTER_LABEL: Record<Phase, string> = {
  ...PHASE_FR,
  prime: "dans son prime (ou déjà établi)",
  declining: "en déclin (léger ou net)",
};

/** The Phase cell (the sentence's words too): see `phaseLabelFr`. */
export const phaseLabel = phaseLabelFr;

/** `?phase=` tokens (ASCII). */
const PHASE_TOKEN: Record<Phase, string> = {
  prospect: "espoir",
  rising: "progression",
  entering_prime: "entree-prime",
  prime: "prime",
  plateau: "plateau",
  declining: "declin",
  late_career: "fin-carriere",
};
/** Tokens of earlier addresses. */
const PHASE_TOKEN_OLD: Record<string, Phase> = { ascension: "rising" };

export function phaseToken(p: Phase): string {
  return PHASE_TOKEN[p];
}

/** A `?phase=` token (or a model key) → phase; anything else → null. */
export function phaseFromToken(s: string): Phase | null {
  const t = s.trim().toLowerCase();
  return PHASE_ORDER.find((p) => PHASE_TOKEN[p] === t || p === t) ?? PHASE_TOKEN_OLD[t] ?? null;
}

export function isPhase(s: string): s is Phase {
  return (PHASE_ORDER as readonly string[]).includes(s);
}

/** First cutdown the tables speak of (before 2027-28). */
export const FIRST_CUTDOWN = 2027;

/** `?conservation=` tokens: the 2027 cutdown outlook. */
export const KEEPER_TOKEN: Record<KeeperStatus, string> = {
  core: "sur",
  bubble: "decider",
  rental: "location",
  free: "gratuit",
};
export const KEEPER_ORDER: readonly KeeperStatus[] = ["core", "bubble", "rental", "free"];

export function keeperFromToken(s: string): KeeperStatus | null {
  const t = s.trim().toLowerCase();
  return KEEPER_ORDER.find((k) => KEEPER_TOKEN[k] === t || k === t) ?? null;
}

/** The filter's words (a status, whoever holds him): the cells' words, explained. */
export const KEEPER_FILTER_LABEL: Record<KeeperStatus, string> = {
  core: "Protéger (protégés sûrs)",
  bubble: "À décider (sur la ligne)",
  rental: "Location (hors des protégés)",
  free: "Gratuit (admissible aux mineures)",
};

export interface KeeperOutlook {
  status: KeeperStatus;
  /** P(kept at the 2027 cutdown | not minors-eligible then); null for a free stash or when almost never gated. */
  p: number | null;
  /** Against his own team's 10 slots (rostered, same roster as the model's), else the league's 160th keeper. */
  team: boolean;
  /** Median rank among his team's candidates (team view only). */
  rank: number | null;
  /** Free: the first cutdown that needs a keeper slot (freeThrough + 1). */
  slotFrom: number | null;
  /** Cell text: « Protéger », « À décider », « Location », « Gratuit ». */
  label: string;
  /** The cell's second line: « 72 % », « 72 % (ligue) », « à protéger dès 2028 ». */
  detail: string | null;
  tone: "emerald" | "amber" | "rose" | "violet";
}

const LABEL: Record<KeeperStatus, string> = {
  core: "Protéger",
  bubble: "À décider",
  rental: "Location",
  free: "Gratuit",
};
const TONE: Record<KeeperStatus, KeeperOutlook["tone"]> = {
  core: "emerald",
  bubble: "amber",
  rental: "rose",
  free: "violet",
};

const pct = (p: number) => `${Math.round(p * 100)}${NBSP}%`;

/** The 2027 cutdown as the tables show it. */
export function keeperOutlook(r: Pick<DynastyRecord, "keeper" | "elig">): KeeperOutlook {
  const kv = keeperView(r);
  const slotFrom = kv.status === "free" && r.elig.freeThrough != null ? r.elig.freeThrough + 1 : null;
  const p = kv.status === "free" ? null : kv.p;
  return {
    status: kv.status,
    p,
    team: kv.team,
    rank: kv.rank,
    slotFrom,
    label: LABEL[kv.status],
    detail: slotFrom !== null ? `à protéger dès ${slotFrom}` : p !== null ? `${pct(p)}${kv.team ? "" : " (ligue)"}` : null,
    tone: TONE[kv.status],
  };
}

/** The « Écrémage 2027 » sort: status first (Protéger, Gratuit, À décider, Location), then the odds. */
export function keeperSortValue(r: Pick<DynastyRecord, "keeper" | "elig">): number {
  const k = keeperOutlook(r);
  const tier = k.status === "core" ? 3 : k.status === "free" ? 2 : k.status === "bubble" ? 1 : 0;
  return tier * 2 + (k.p ?? 0);
}

/**
 * His record as the tables read it now: the team view (keeper.team) only
 * holds on the roster the model saw (`syncOwners`, the sync's rosters). A
 * player drafted, claimed, traded or dropped since gets the league's view,
 * so no team's 10 slots are counted with stale odds. Without the sync's
 * rosters (null), the record as is.
 */
export function currentRecord(
  r: DynastyRecord,
  id: string,
  owner: string | null,
  syncOwners: ReadonlyMap<string, string> | null | undefined,
): DynastyRecord {
  if (!r.keeper.team || !syncOwners || (syncOwners.get(id) ?? null) === owner) return r;
  const { team: _team, ...league } = r.keeper;
  return { ...r, keeper: league };
}

// ------------------------------------------------------------ hints

/** Whose player he is, seen from the page's team: his own, nobody's, another team's. */
export type HintSide = "mine" | "free" | "other";

export function hintSide(owner: string | null, teamId: string): HintSide {
  return owner === null ? "free" : owner === teamId ? "mine" : "other";
}

export type DynastyHintCode =
  // the page's team
  | "keep"
  | "keep-sell-rebuild"
  | "decide"
  | "sell-high"
  | "trade-before"
  | "sell"
  | "rental"
  | "stash"
  // available
  | "target"
  | "target-line"
  | "target-now"
  | "target-stash"
  | "low"
  // another team's
  | "other-core"
  | "other-line"
  | "other-rental"
  | "other-free";

export interface DynastyHint {
  code: DynastyHintCode;
  /** Cell text. */
  short: string;
}

const SHORT: Record<DynastyHintCode, string> = {
  keep: "Protéger",
  "keep-sell-rebuild": "Protéger (vendre si reconstruction)",
  decide: "À décider",
  "sell-high": "Vendre haut",
  "trade-before": "Échanger avant 2027",
  sell: "Vendre",
  rental: "Location",
  stash: "Garder (gratuit)",
  target: "Cible à protéger",
  "target-line": "Cible sur la ligne",
  "target-now": "Pour cette saison",
  "target-stash": "Cible gratuite",
  low: "Faible valeur",
  "other-core": "Protéger (autre équipe)",
  "other-line": "À décider (autre équipe)",
  "other-rental": "Location (autre équipe)",
  "other-free": "Gratuit (autre équipe)",
};

/** Worth a season on the active roster (the owner's « échanger avant 2027 » line). */
export const WIN_NOW_MIN = 30;
/** Worth a minors slot for someone who takes him now (long-term value). */
export const STASH_MIN = 10;

/**
 * Keep / trade hint from the page's team's side (the cell's words; the
 * sentence is `dynastyHintText`, loaded with the details row). His own
 * player: what to do (protéger, vendre si reconstruction, à décider,
 * échanger avant 2027, garder gratuitement). An available one: what he
 * would be for the team that takes him (the league's 160 keepers), a
 * win-now pickup only with a win-now value. Another team's: where his team
 * stands at the cutdown, so the viewer knows whom it may part with.
 */
export function dynastyHint(r: DynastyRecord, side: HintSide): DynastyHint {
  const kv = keeperView(r);
  const gap = r.market.gap ?? 0;
  let code: DynastyHintCode;
  if (side === "mine") {
    if (kv.status === "free") code = "stash";
    else if (kv.status === "core") {
      code = (r.phase === "declining" || r.phase === "late_career") && nearShare(r) >= 0.6 ? "keep-sell-rebuild" : "keep";
    } else if (kv.status === "bubble") code = gap < -50 ? "sell-high" : "decide";
    else if (r.dv.winNow >= WIN_NOW_MIN) code = "trade-before";
    else code = gap < -50 ? "sell" : "rental";
  } else if (side === "free") {
    if (kv.status === "free") code = r.dv.longTerm >= STASH_MIN ? "target-stash" : "low";
    else if (kv.status === "core") code = "target";
    else if (kv.status === "bubble") code = "target-line";
    else code = r.dv.winNow >= WIN_NOW_MIN ? "target-now" : "low";
  } else {
    code = kv.status === "free" ? "other-free" : kv.status === "core" ? "other-core" : kv.status === "bubble" ? "other-line" : "other-rental";
  }
  return { code, short: SHORT[code] };
}

// ------------------------------------------------------------ roster summary

export interface TeamDynastySummary {
  core: number;
  bubble: number;
  rental: number;
  free: number;
  /** Rostered players without a record (added since the build). */
  unknown: number;
  /** Rostered with a record but no team view (arrived since the sync): out of the 10-slot counts. */
  outside: number;
  /** Rentals still worth using this season (the « échanger avant 2027 » list). */
  tradeBefore: number;
  /** « 5 à protéger, 6 à décider, 6 en location, 28 gratuits (mineures) » */
  text: string;
}

const count = (n: number, one: string, many: string) => `${n} ${n >= 2 ? many : one}`;

/**
 * A roster's 2027 cutdown outlook against its 10 keeper slots: only the
 * players the model saw on this roster (their team view) are counted.
 */
export function teamDynastySummary(records: ReadonlyArray<DynastyRecord | null | undefined>): TeamDynastySummary {
  const s = { core: 0, bubble: 0, rental: 0, free: 0, unknown: 0, outside: 0, tradeBefore: 0 };
  for (const r of records) {
    if (!r) {
      s.unknown++;
      continue;
    }
    const t = r.keeper.team;
    if (!t) {
      s.outside++;
      continue;
    }
    s[t.status]++;
    if (t.status === "rental" && r.dv.winNow >= WIN_NOW_MIN) s.tradeBefore++;
  }
  const parts = [
    `${s.core} à protéger`,
    `${s.bubble} à décider`,
    `${s.rental} en location`,
    `${count(s.free, "gratuit", "gratuits")} (mineures)`,
  ];
  const later = s.outside + s.unknown;
  if (later > 0) parts.push(`${later} ${later >= 2 ? "arrivés" : "arrivé"} depuis la synchro (hors décompte)`);
  return { ...s, text: parts.join(", ") };
}

/** Value of a record in a mode (a zero-value id reads 0; no record, null). */
export function dynastyValueOf(r: DynastyRecord | null, zero: boolean, mode: Mode): number | null {
  if (r) return r.dv[mode];
  return zero ? 0 : null;
}

/** P10–P90 band shown for a mode (Gagner maintenant has none: the balanced one). */
export function bandOf(r: Pick<DynastyRecord, "band">, mode: Mode): [number, number, number] {
  return mode === "longTerm" ? r.band.longTerm : r.band.balanced;
}
