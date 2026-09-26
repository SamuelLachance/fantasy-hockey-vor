/**
 * The keep / trade sentences of a dynasty record (§3.12): the free-stash
 * clause and the owner's roster hint. Apart from `keeper-view.ts` so the
 * tables' first load carries only the short words; the details row, the
 * sentence builder and the reports read these.
 */
import { keeperView, NBSP, nearShare } from "./keeper-view";
import type { DynastyRecord } from "./types";

const ordinal = (n: number) => (n === 1 ? "1er" : `${n}e`);

/**
 * « gratuit jusqu’à l’écrémage 2027 inclus, à protéger dès 2028 »: the last
 * cutdown he is still minors-eligible (free) and the first one that needs a
 * keeper slot (freeThrough + 1). Null without a free season ahead.
 */
export function freeStashFr(r: Pick<DynastyRecord, "elig">): string | null {
  const last = r.elig.freeThrough;
  return last != null ? `gratuit jusqu’à l’écrémage ${last} inclus, à protéger dès ${last + 1}` : null;
}

/**
 * Short keep / trade hint for a roster row, from the owner's side (report
 * and UI): against his own team's 10 keeper slots when the snapshot has
 * them, else the league line.
 */
export function rosterHintFr(r: DynastyRecord): string {
  const gap = r.market.gap ?? 0;
  const kv = keeperView(r);
  if (kv.status === "free") {
    const free = freeStashFr(r);
    return `admissible aux mineures${NBSP}: ${free ?? "gratuit à garder"}`;
  }
  if (kv.status === "core") {
    if ((r.phase === "declining" || r.phase === "late_career") && nearShare(r) >= 0.6) {
      return "protéger; valeur surtout à court terme (à vendre si reconstruction)";
    }
    return "protéger";
  }
  if (kv.status === "bubble") {
    if (gap < -50) return `vendre haut${NBSP}: le marché le paie plus que sa valeur de protection`;
    return kv.team && kv.rank != null
      ? `décider à l’écrémage 2027 (${ordinal(kv.rank)} candidat de l’équipe pour 10 places)`
      : "décider à l’écrémage 2027 (sur la ligne)";
  }
  // rental
  if (r.dv.winNow >= 30) return `location${NBSP}: l’utiliser cette saison, l’échanger avant l’écrémage 2027`;
  return gap < -50 ? `vendre${NBSP}: le marché le paie plus cher` : "location sans valeur de protection";
}
