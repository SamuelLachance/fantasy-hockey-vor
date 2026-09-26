/**
 * The « Conseil » sentence of a dynasty record from the page's team's side
 * (details row): the owner's hint for his own players, what an available
 * player would be for whoever takes him, where another team stands. Loaded
 * with the details row, not with the tab (the cell shows `dynastyHint`).
 */
import { keeperView, NBSP } from "@/lib/dynasty/keeper-view";
import { freeStashFr, rosterHintFr } from "@/lib/dynasty/roster-hint";
import type { DynastyRecord } from "@/lib/dynasty/types";
import { dynastyHint, WIN_NOW_MIN, type DynastyHint, type HintSide } from "./dynasty-hints";

export interface DynastyHintText extends DynastyHint {
  /** The full hint, from the same side as the cell's words. */
  long: string;
}

const pct = (p: number) => `${Math.round(p * 100)}${NBSP}%`;
const odds = (p: number | null, bar: string) => (p != null ? ` (${pct(p)} de chances d’être ${bar})` : "");

export function dynastyHintText(r: DynastyRecord, side: HintSide): DynastyHintText {
  const h = dynastyHint(r, side);
  const kv = keeperView(r);
  const free = freeStashFr(r);
  const bar = kv.team ? "parmi les 10 protégés de son équipe" : "parmi les 160 protégés de la ligue";
  let long: string;
  switch (h.code) {
    case "target-stash":
      long = `à prendre et garder en mineures${NBSP}: ${free ?? "gratuit à garder"}`;
      break;
    case "low":
      long =
        kv.status === "free"
          ? `admissible aux mineures, mais peu de valeur à long terme${r.path !== "nhl" ? ` (${pct(r.pNhl)} de chances de s’établir dans la LNH)` : ""}`
          : "peu utile cette saison et sans valeur de protection à l’écrémage 2027";
      break;
    case "target":
      long = `cible${NBSP}: protégeable à l’écrémage 2027${odds(kv.p, "parmi les 160 protégés de la ligue")}`;
      break;
    case "target-line":
      long = `cible sur la ligne des 160 protégés de la ligue à l’écrémage 2027${odds(kv.p, "protégé")}`;
      break;
    case "target-now":
      long = "utile cette saison seulement, sans valeur de protection à l’écrémage 2027";
      break;
    case "other-free":
      long = `pour son équipe, admissible aux mineures${NBSP}: ${free ?? "gratuit"}`;
      break;
    case "other-core":
      long = `protégé sûr de son équipe à l’écrémage 2027${odds(kv.p, bar)}${NBSP}: il faudra payer le prix`;
      break;
    case "other-line":
      long = `sur la ligne de son équipe à l’écrémage 2027${odds(kv.p, bar)}${NBSP}: elle pourrait le céder`;
      break;
    case "other-rental":
      long =
        r.dv.winNow >= WIN_NOW_MIN
          ? `hors des protégés de son équipe à l’écrémage 2027, utile cette saison${NBSP}: elle a intérêt à l’échanger avant`
          : "hors des protégés de son équipe à l’écrémage 2027, peu utile cette saison";
      break;
    default:
      // the page's team's own player: the owner's hint
      long = rosterHintFr(r);
  }
  return { ...h, long };
}
