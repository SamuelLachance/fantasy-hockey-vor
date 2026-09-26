/**
 * The 2027 keeper outlook of a dynasty record and the phase labels
 * (§3.12), apart from the sentence builder (`explain.ts`) and the hint
 * sentences (`roster-hint.ts`) so the player tables read them without the
 * growth clauses. Pure and small.
 */
import type { DynastyRecord, KeeperStatus, Phase } from "./types";

/** No-break space (U+00A0): before « : » and « % » (French typography). */
export const NBSP = " ";

/** French phase labels (§3.12): the tables, the filter and the sentence say the same words. */
export const PHASE_FR: Record<Phase, string> = {
  prospect: "espoir",
  rising: "en progression",
  entering_prime: "entre dans son prime",
  prime: "dans son prime",
  plateau: "plateau",
  declining: "en déclin",
  late_career: "fin de carrière",
};

/**
 * The phase in words for one player: the model's, softened where it would
 * mislead at his age. The phase comes from the effective age (shifted for
 * elite players and their trajectory) and a young skater's expected
 * progression, not the age alone: a 21-year-old whose level should hold is
 * « déjà établi », a 29-year-old on the aging curve (about −4 %/an) is in a
 * « léger déclin ».
 */
export function phaseLabelFr(r: Pick<DynastyRecord, "phase" | "age">): string {
  if (r.phase === "prime" && r.age < 23) return "déjà établi";
  if (r.phase === "declining" && r.age < 31) return "léger déclin";
  return PHASE_FR[r.phase];
}

/** League-wide keeper status (the 160th keeper of the league: the value basis). */
export const KEEPER_FR: Record<KeeperStatus, string> = {
  free: "stationné gratuitement",
  core: "protégé sûr",
  bubble: "près de la ligne des 160 protégés",
  rental: "location",
};

/** Team-conditional keeper status (his own team's 10 keeper slots at the 2027 cutdown). */
export const KEEPER_TEAM_FR: Record<KeeperStatus, string> = {
  free: "stationné gratuitement",
  core: "protégé sûr de son équipe",
  bubble: "sur la ligne des 10 protégés de son équipe",
  rental: "hors des 10 protégés de son équipe",
};

/**
 * The keeper status that decides a rostered player's 2027 cutdown: his own
 * team's 10 slots when known (roster view), else the league-wide one.
 */
export function keeperView(r: Pick<DynastyRecord, "keeper">): { status: KeeperStatus; p: number | null; team: boolean; rank: number | null } {
  const t = r.keeper.team;
  return t
    ? { status: t.status, p: t.pKept27, team: true, rank: t.rank }
    : { status: r.keeper.status, p: r.keeper.pKept27, team: false, rank: null };
}

/** Share of the balanced value (δ 0.75) that comes from the first two seasons. */
export function nearShare(r: Pick<DynastyRecord, "eG">, delta = 0.75): number {
  let tot = 0;
  let near = 0;
  r.eG.forEach((x, t) => {
    const w = Math.pow(delta, t) * x;
    tot += w;
    if (t <= 1) near += w;
  });
  return tot > 0 ? near / tot : 0;
}
