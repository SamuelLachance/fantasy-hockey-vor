/**
 * French labels and the one-line explanation of a dynasty value (§3.12).
 * Pure and small: usable in the browser and in the terminal report. The
 * sentence never quotes scouting sources; it states the model's own numbers.
 */
import { GROWTH_FALL, GROWTH_RISE, pedigreeFr, productionFr } from "./growth";
import { KEEPER_FR, KEEPER_TEAM_FR, keeperView, NBSP, nearShare, PHASE_FR, phaseLabelFr } from "./keeper-view";
import { freeStashFr } from "./roster-hint";
import type { DynastyRecord, Group, Mode, Phase } from "./types";

// The keeper view, phase labels and roster hint live apart (the tables load them without this sentence builder).
export { KEEPER_FR, KEEPER_TEAM_FR, keeperView, nearShare, PHASE_FR } from "./keeper-view";
export { rosterHintFr } from "./roster-hint";

/** Phase as it reads after "Attaquant de 27 ans …". */
const PHASE_CLAUSE: Record<Phase, string> = {
  prospect: "espoir",
  rising: "en progression",
  entering_prime: "qui entre dans son prime",
  prime: "dans son prime",
  plateau: "au plateau",
  declining: "en déclin",
  late_career: "en fin de carrière",
};

/** The phase clause, with the tables' softer words for the young (« déjà établi ») and the not-yet-old (« en léger déclin »). */
function phaseClause(r: Pick<DynastyRecord, "phase" | "age">): string {
  const label = phaseLabelFr(r);
  if (label === PHASE_FR[r.phase]) return PHASE_CLAUSE[r.phase];
  return r.phase === "declining" ? `en ${label}` : label;
}

export const MODE_FR: Record<Mode, string> = {
  winNow: "Gagner maintenant",
  balanced: "Équilibré",
  longTerm: "Long terme",
};

const POS_FR: Record<Group, string> = { F: "Attaquant", D: "Défenseur", G: "Gardien" };

const pct = (p: number) => `${Math.round(p * 100)}${NBSP}%`;
const seasonLabel = (y: number) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
const ordinal = (n: number) => (n === 1 ? "1er" : `${n}e`);
/** Whole number with a no-break thousands separator (1 141). */
const fmtWhole = (x: number) => String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);

/**
 * The model's own expected yearly change of the per-game level over the next
 * two seasons (conditional growth for young skaters, else λ-scaled aging
 * with the elite / trajectory shift). Not a ratio of season points: those mix in games
 * played (a full-timer's 2026-27 projection vs a generic later role) and the
 * part of 2026-27 already played, which would invent a trend.
 */
export function modelTrend(r: Pick<DynastyRecord, "trend">): number | null {
  return r.trend != null && Number.isFinite(r.trend) ? r.trend : null;
}

const FIRST_SEASON = 2026;

/**
 * The growth driver of a young skater: « progression attendue d’un choix du
 * top 5 productif à 19 ans (+20 % d'ici 2028-29) » — pedigree, production
 * percentile among same-age NHL seasons and the base age, with the expected
 * FP/G change three seasons after the 2025-26 base ("projeté" when the base
 * leans on the projection: a rookie). Null without a growth record.
 */
export function growthClauseFr(r: Pick<DynastyRecord, "growth">): string | null {
  const gr = r.growth;
  if (!gr || gr.m.length < 3) return null;
  const g3 = gr.m[2]!;
  const base = FIRST_SEASON - 1;
  const change = `${g3 >= 1 ? "+" : "−"}${Math.round(Math.abs(g3 - 1) * 100)}${NBSP}% d’ici ${seasonLabel(base + 3)}`;
  const who = `${pedigreeFr(gr.pick)} ${gr.src === "projection" ? "projeté " : ""}${productionFr(gr.pct)} à ${Math.floor(gr.baseAge)} ans`;
  const lead = g3 >= GROWTH_RISE ? "progression attendue" : g3 > GROWTH_FALL ? "peu de progression attendue" : "recul attendu";
  return `${lead} ${who} (${change})`;
}

/**
 * "Attaquant de 20 ans en progression, admissible aux mineures, gratuit
 * jusqu’à l’écrémage 2027 inclus, à protéger dès 2028; gros plafond (1 chance
 * sur 10 de dépasser 407, médiane 133)". At most 220 characters; clauses are
 * added by importance until the budget is spent. Plain words: no « P90 »,
 * « Ros » or « PJ ».
 */
export function explainFr(r: DynastyRecord, maxLen = 220): string {
  const age = Math.floor(r.age);
  const clauses: string[] = [];
  // 1. who and phase
  if (r.phase === "prospect" && r.path !== "nhl") {
    const draft = r.draft ? ` (${ordinal(r.draft.pick)} choix LNH ${r.draft.year})` : "";
    const eta = r.eta != null ? `, arrivée ${seasonLabel(r.eta)}` : "";
    const who = r.g === "G" ? "Gardien espoir" : "Espoir";
    clauses.push(`${who} de ${age} ans${draft}${NBSP}: ${pct(r.pNhl)} de chances de s’établir dans la LNH${eta}`);
  } else {
    // a young skater's growth driver carries the magnitude; others quote the yearly trend
    const growth = growthClauseFr(r);
    const trend = modelTrend(r);
    const t =
      !growth && trend != null && Math.abs(trend) >= 0.01
        ? ` (${trend > 0 ? "+" : "−"}${Math.round(Math.abs(trend) * 100)}${NBSP}%/an)`
        : "";
    // an NHL-path player who is still a part-timer and minors-eligible; a
    // rising young skater's growth clause says "progression" itself
    const phase = growth && (r.phase === "rising" || r.phase === "entering_prime") ? "" : ` ${phaseClause(r)}`;
    const who = r.phase === "prospect" ? `${POS_FR[r.g]} espoir de ${age} ans` : `${POS_FR[r.g]} de ${age} ans${phase}`;
    clauses.push(`${who}${t}`);
    if (growth) clauses.push(growth);
  }
  // 2. keeper economics (a rostered player: his own team's 10 slots)
  const firstCut = FIRST_SEASON + 1;
  const kv = keeperView(r);
  const free = kv.status === "free" ? freeStashFr(r) : null;
  if (free) {
    clauses.push(`admissible aux mineures, ${free}`);
  } else if (r.elig.now && r.elig.next < 0.5) {
    const why = r.elig.binding === "age" ? "25 ans" : `${r.gp} matchs dans la LNH`;
    const pk = kv.p != null ? ` (${pct(kv.p)} de chances)` : "";
    const bar = kv.team ? "être parmi les 10 protégés de son équipe" : "battre la ligne des 160 protégés";
    clauses.push(`perd son admissibilité aux mineures en ${firstCut} (${why})${NBSP}: devra ${bar}${pk}`);
  } else if (kv.status === "rental") clauses.push(kv.team ? KEEPER_TEAM_FR.rental : "location");
  else if (kv.status === "bubble") clauses.push(`${(kv.team ? KEEPER_TEAM_FR : KEEPER_FR).bubble} en ${firstCut}`);
  else if (kv.status === "core") clauses.push((kv.team ? KEEPER_TEAM_FR : KEEPER_FR).core);
  // 3. current status, conflict / market (the market gap matters most for young players near the line)
  if (r.flags?.includes("injuredNow")) clauses.push(`indisponible en ce moment${NBSP}: 2026-27 réduite, pas la suite`);
  if (r.flags?.includes("projectionConflict")) clauses.push("projection LNH et pedigree en désaccord");
  const gap = r.market.gap;
  if (gap != null && Math.abs(gap) > 50) {
    const sig: string[] = [];
    if (r.market.ros != null) sig.push(`pris dans ${Math.round(r.market.ros)}${NBSP}% des ligues Fantrax`);
    if (r.market.leaguePick != null) sig.push(`${ordinal(r.market.leaguePick)} choix de la ligue`);
    const s = sig.length ? ` (${sig.join(", ")})` : "";
    clauses.push(gap < 0 ? `le marché${s} le paie plus cher` : `le modèle l’aime plus que le marché${s}`);
  }
  // 4. time profile
  const near = nearShare(r);
  if (r.dv.balanced >= 1) {
    if (near >= 0.6) clauses.push(`${pct(near)} de la valeur d’ici ${seasonLabel(FIRST_SEASON + 1)}`);
    else if (near <= 0.3) clauses.push(`valeur surtout après ${seasonLabel(FIRST_SEASON + 1)}`);
  }
  // 5. upside
  const [, p50, p90] = r.band.balanced;
  if (p90 / Math.max(p50, 10) > 3 && p90 >= 30) {
    clauses.push(`gros plafond (1 chance sur 10 de dépasser ${fmtWhole(p90)}, médiane ${fmtWhole(p50)})`);
  }
  let out = clauses[0]!;
  let added = 0;
  for (let i = 1; i < clauses.length; i++) {
    const next = `${out}${added === 0 ? ", " : "; "}${clauses[i]}`;
    if (next.length > maxLen) continue;
    out = next;
    added++;
  }
  return out.length > maxLen ? `${out.slice(0, maxLen - 1)}…` : out;
}
