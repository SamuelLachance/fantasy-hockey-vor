/**
 * French lines of a league salary cap (src/lib/fantrax/salary-cap.ts): the
 * cap line under the legality one, the season labels and the growth
 * assumption. Apart from the arithmetic so the planner's chunk (which every
 * tab of a Fantrax league loads) carries none of these words.
 */
import { fmtMoney } from "./money";
import type { ContractsFile, SalaryUsage } from "./salary-cap";
import type { DailyPlan } from "./daily-plan";

export { fmtMoney };

/** « 2026-27 ». */
export function capSeasonLabel(y: number): string {
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

/** The cap line under the legality one: « Masse salariale : 98,4 M$ / 105 M$, marge 6,6 M$ (Actifs + Réserve). » */
export function salaryLine(u: SalaryUsage): string {
  const room = u.room[0] ?? 0;
  const unknown = u.unknown.length ? `; ${u.unknown.length} salaire${u.unknown.length > 1 ? "s" : ""} inconnu${u.unknown.length > 1 ? "s" : ""}` : "";
  const head = `Masse salariale : ${fmtMoney(u.used[0] ?? 0)} / ${fmtMoney(u.cap[0] ?? 0)}`;
  // More Active + Reserve players than counted spots (a draft seats every pick in Active).
  const extra = u.surplus?.length
    ? `; ${u.surplus.length} de plus, supposé${u.surplus.length > 1 ? "s" : ""} aux mineures`
    : "";
  return room < 0
    ? `${head}, dépassement de ${fmtMoney(-room)} (Actifs + Réserve seulement${extra}${unknown}).`
    : `${head}, marge ${fmtMoney(room)} (Actifs + Réserve seulement, ${u.counted} joueurs sur ${u.spots}${extra}${unknown}).`;
}

const list = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} et ${names.at(-1)}`);

/**
 * The salary-cap fit (`plan.capFit`, cap-fit.ts) in words: « Ajustement au
 * plafond : envoyer A et B aux mineures, rappeler C. Masse 108,1 M$ → 103,4
 * M$, +26 points projetés d’ici la fin de la saison. »
 */
export function capFitLine(fit: NonNullable<DailyPlan["capFit"]>, name: (id: string) => string): string {
  const down = fit.moves.filter((m) => m.to === "MINORS").map((m) => name(m.id));
  const up = fit.moves.filter((m) => m.to === "RESERVE").map((m) => name(m.id));
  const acts = [down.length ? `envoyer ${list(down)} aux mineures` : "", up.length ? `rappeler ${list(up)} (Réserve)` : ""].filter(Boolean).join(", ");
  const money = `masse ${fmtMoney(fit.usedBefore)} → ${fmtMoney(fit.usedAfter)}`;
  const gain =
    fit.gain !== null
      ? `, +${Math.round(fit.gain)} point${Math.round(fit.gain) >= 2 ? "s" : ""} projeté${Math.round(fit.gain) >= 2 ? "s" : ""} d’ici la fin de la saison régulière de la ligue`
      : fit.legal
        ? ", ce qui rend l’effectif conforme"
        : "; l’effectif reste non conforme (il faudra aussi libérer ou ajouter un joueur)";
  return `Ajustement au plafond : ${acts} (${money}${gain}).`;
}

/** The growth assumption in words, for the method note. */
export function capGrowthText(f: Pick<ContractsFile, "cap" | "firstSeason" | "growthAfter" | "announced" | "nhl">): string {
  const last = Math.max(...f.announced);
  const pct = (x: number) => `${String(Math.round(x * 1000) / 10).replace(".", ",")} %`;
  const seasons = f.cap.slice(0, 4).map((c, t) => `${capSeasonLabel(f.firstSeason + t)} ${fmtMoney(c)}`).join(", ");
  if (f.cap.every((c) => c === f.cap[0])) return `Plafond de la ligue : ${fmtMoney(f.cap[0]!)} chaque saison (fixe, règle du commissaire), plancher de 70 M$.`;
  return `Plafond de la ligue : ${seasons}… Il suit le plafond de la LNH (annoncé jusqu’en ${capSeasonLabel(last)}), puis +${pct(f.growthAfter)} par saison (hypothèse, à confirmer par le commissaire).`;
}
