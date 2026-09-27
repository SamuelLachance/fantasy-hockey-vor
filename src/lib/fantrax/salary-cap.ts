/**
 * A league salary cap on real NHL cap hits (Slapshot: 105 M$ in 2026-27,
 * counted over the 23 Active + Reserve players only; IR and Minors are free).
 *
 * The numbers come from `<public>/contracts.json`, which the dynasty build
 * derives from its own snapshot (scripts/dynasty-client.ts): the league cap
 * per season (the growth assumption is the dynasty profile's one knob), the
 * league minimum salary, the cap's shadow price λ, and every modeled player's
 * cap hit per season — the signed seasons as they are, then the projected
 * next contract. Pure: no fetch, no DOM.
 */
import type { SalaryCapConfig } from "./config";

/** Seasons the file carries per player (2026-27 first). */
export const CONTRACT_SEASONS = 6;

/** One player's contract as the site reads it. */
export interface ContractRow {
  /** Cap hit per season (M$, 2 dp), `CONTRACT_SEASONS` seasons from `firstSeason`: signed, then projected. */
  c: number[];
  /** How many of those seasons are signed (0 = no NHL contract for the first season). */
  s: number;
  /** First season (start year) without a signed contract; null = signed through the file's horizon. */
  x: number | null;
  /** Status when the signed contract ends. */
  st: "UFA" | "RFA" | null;
  /** The first season is an entry-level deal. */
  elc?: 1;
}

export interface ContractsFile {
  /** dynasty.json's builtAt: the two files are one build. */
  builtAt: string;
  firstSeason: number;
  /** League cap per season, M$ (`CONTRACT_SEASONS` seasons). */
  cap: number[];
  /** League minimum salary per season, M$. */
  min: number[];
  /** NHL upper limit per season, M$ (the trajectory the league cap follows). */
  nhl: number[];
  /** Growth of the cap per season after the last announced NHL cap. */
  growthAfter: number;
  /** Seasons whose NHL cap is announced (start years); later ones grow by `growthAfter`. */
  announced: number[];
  /** Cap shadow price per season, league points per M$ above the minimum. */
  lambda: number[];
  players: Record<string, ContractRow>;
}

export function isContractsFile(x: unknown): x is ContractsFile {
  if (!x || typeof x !== "object") return false;
  const f = x as Partial<ContractsFile>;
  return (
    typeof f.firstSeason === "number" &&
    Array.isArray(f.cap) &&
    f.cap.length > 0 &&
    f.cap.every((v) => typeof v === "number" && Number.isFinite(v)) &&
    !!f.players &&
    typeof f.players === "object"
  );
}

/** A team's cap use over its counted players, season by season. */
export interface SalaryUsage {
  /** Start years shown (the first `seasons` of the file). */
  seasons: number[];
  /** League cap per season, M$. */
  cap: number[];
  /** Cap hits of the counted players (signed, then projected), M$. */
  used: number[];
  /** The signed part of `used` (a season past a contract's end counts 0 here). */
  signed: number[];
  /** cap − used. */
  room: number[];
  /** Players on Active + Reserve now. */
  counted: number;
  /** Spots that count (23). */
  spots: number;
  /** Counted players with no contract in the file (their salary is unknown, not 0). */
  unknown: string[];
  /** Counted players by cap hit this season, highest first: [id, M$]. */
  top: Array<[string, number]>;
  /** Over the cap this season. */
  over: boolean;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Cap use of one roster: the players whose status counts (Active + Reserve),
 * their cap hits per season from the contracts file, against the league cap.
 * Future seasons keep today's counted players (what is already committed).
 */
export function salaryUsage(
  roster: ReadonlyArray<{ id: string; status: string }>,
  contracts: ContractsFile,
  rules: SalaryCapConfig,
  seasons = 4,
): SalaryUsage {
  const n = Math.min(seasons, contracts.cap.length);
  const counted = roster.filter((e) => rules.countedStatuses.includes(e.status));
  const used = new Array<number>(n).fill(0);
  const signed = new Array<number>(n).fill(0);
  const unknown: string[] = [];
  const top: Array<[string, number]> = [];
  for (const e of counted) {
    const c = contracts.players[e.id];
    if (!c) {
      unknown.push(e.id);
      continue;
    }
    for (let t = 0; t < n; t++) {
      const hit = c.c[t] ?? 0;
      used[t] += hit;
      if (t < c.s) signed[t] += hit;
    }
    top.push([e.id, c.c[0] ?? 0]);
  }
  top.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const cap = contracts.cap.slice(0, n);
  return {
    seasons: Array.from({ length: n }, (_, t) => contracts.firstSeason + t),
    cap,
    used: used.map(r2),
    signed: signed.map(r2),
    room: cap.map((c, t) => r2(c - used[t]!)),
    counted: counted.length,
    spots: rules.countedSpots,
    unknown,
    top,
    over: used[0]! > cap[0]! + 1e-9,
  };
}

/** `98,4 M$` (fr-CA, one decimal from 10 M$, two below). */
export function fmtMoney(m: number): string {
  const abs = Math.abs(m);
  const s = abs.toLocaleString("fr-CA", {
    minimumFractionDigits: abs >= 10 ? 1 : 2,
    maximumFractionDigits: abs >= 10 ? 1 : 2,
  });
  return `${m < 0 ? "−" : ""}${s} M$`;
}

/** « 2026-27 ». */
export function capSeasonLabel(y: number): string {
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

/** The cap line under the legality one: « Masse salariale : 98,4 M$ / 105 M$, marge 6,6 M$ (Actifs + Réserve). » */
export function salaryLine(u: SalaryUsage): string {
  const room = u.room[0] ?? 0;
  const unknown = u.unknown.length ? `; ${u.unknown.length} salaire${u.unknown.length > 1 ? "s" : ""} inconnu${u.unknown.length > 1 ? "s" : ""}` : "";
  const head = `Masse salariale : ${fmtMoney(u.used[0] ?? 0)} / ${fmtMoney(u.cap[0] ?? 0)}`;
  return room < 0
    ? `${head}, dépassement de ${fmtMoney(-room)} (Actifs + Réserve seulement${unknown}).`
    : `${head}, marge ${fmtMoney(room)} (Actifs + Réserve seulement, ${u.counted} joueurs sur ${u.spots}${unknown}).`;
}

/** The growth assumption in words, for the method note. */
export function capGrowthText(f: Pick<ContractsFile, "cap" | "firstSeason" | "growthAfter" | "announced" | "nhl">): string {
  const last = Math.max(...f.announced);
  const pct = (x: number) => `${String(Math.round(x * 1000) / 10).replace(".", ",")} %`;
  const seasons = f.cap.slice(0, 4).map((c, t) => `${capSeasonLabel(f.firstSeason + t)} ${fmtMoney(c)}`).join(", ");
  return `Plafond de la ligue : ${seasons}… Il suit le plafond de la LNH (annoncé jusqu’en ${capSeasonLabel(last)}), puis +${pct(f.growthAfter)} par saison (hypothèse, à confirmer par le commissaire).`;
}
