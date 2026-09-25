/**
 * French labels and the one-line explanation of a dynasty value (§3.12).
 * Pure and small: usable in the browser and in the terminal report. The
 * sentence never quotes scouting sources; it states the model's own numbers.
 */
import { GROWTH_FALL, GROWTH_RISE, pedigreeFr, productionFr } from "./growth";
import type { DynastyRecord, Group, KeeperStatus, Mode, Phase } from "./types";

export const PHASE_FR: Record<Phase, string> = {
  prospect: "espoir",
  rising: "en progression",
  entering_prime: "entre dans son prime",
  prime: "dans son prime",
  plateau: "plateau",
  declining: "en déclin",
  late_career: "fin de carrière",
};

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

export const MODE_FR: Record<Mode, string> = {
  winNow: "Gagner maintenant",
  balanced: "Équilibré",
  longTerm: "Long terme",
};

const POS_FR: Record<Group, string> = { F: "Attaquant", D: "Défenseur", G: "Gardien" };

const NBSP = " ";
const pct = (p: number) => `${Math.round(p * 100)}${NBSP}%`;
const seasonLabel = (y: number) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
const ordinal = (n: number) => (n === 1 ? "1er" : `${n}e`);

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
 * The growth driver of a young skater: « progression attendue d'un choix du
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
  const change = `${g3 >= 1 ? "+" : "−"}${Math.round(Math.abs(g3 - 1) * 100)}${NBSP}% d'ici ${seasonLabel(base + 3)}`;
  const who = `${pedigreeFr(gr.pick)} ${gr.src === "projection" ? "projeté " : ""}${productionFr(gr.pct)} à ${Math.floor(gr.baseAge)} ans`;
  const lead = g3 >= GROWTH_RISE ? "progression attendue" : g3 > GROWTH_FALL ? "peu de progression attendue" : "recul attendu";
  return `${lead} ${who} (${change})`;
}

/**
 * "Attaquant de 20 ans en progression, gratuit en mineures jusqu'à
 * l'écrémage 2028 ; gros plafond (P90 407 vs médiane 133)". At most 220
 * characters; clauses are added by importance until the budget is spent.
 */
export function explainFr(r: DynastyRecord, maxLen = 220): string {
  const age = Math.floor(r.age);
  const clauses: string[] = [];
  // 1. who and phase
  if (r.phase === "prospect" && r.path !== "nhl") {
    const draft = r.draft ? ` (${ordinal(r.draft.pick)} choix LNH ${r.draft.year})` : "";
    const eta = r.eta != null ? `, arrivée ${seasonLabel(r.eta)}` : "";
    const who = r.g === "G" ? "Gardien espoir" : "Espoir";
    clauses.push(`${who} de ${age} ans${draft} : P(LNH) ${pct(r.pNhl)}${eta}`);
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
    const phase = growth && (r.phase === "rising" || r.phase === "entering_prime") ? "" : ` ${PHASE_CLAUSE[r.phase]}`;
    const who = r.phase === "prospect" ? `${POS_FR[r.g]} espoir de ${age} ans` : `${POS_FR[r.g]} de ${age} ans${phase}`;
    clauses.push(`${who}${t}`);
    if (growth) clauses.push(growth);
  }
  // 2. keeper economics (a rostered player: his own team's 10 slots)
  const firstCut = FIRST_SEASON + 1;
  const kv = keeperView(r);
  if (kv.status === "free" && r.elig.freeThrough != null) {
    clauses.push(`gratuit en mineures jusqu'à l'écrémage ${r.elig.freeThrough + 1}`);
  } else if (r.elig.now && r.elig.next < 0.5) {
    const why = r.elig.binding === "age" ? "25 ans" : `${r.gp} PJ`;
    const pk = kv.p != null ? ` (P ${pct(kv.p)})` : "";
    const bar = kv.team ? "être parmi les 10 protégés de son équipe" : "battre la ligne des 160 protégés";
    clauses.push(`perd son admissibilité en ${firstCut} (${why}) : devra ${bar}${pk}`);
  } else if (kv.status === "rental") clauses.push(kv.team ? KEEPER_TEAM_FR.rental : "location");
  else if (kv.status === "bubble") clauses.push(`${(kv.team ? KEEPER_TEAM_FR : KEEPER_FR).bubble} en ${firstCut}`);
  else if (kv.status === "core") clauses.push((kv.team ? KEEPER_TEAM_FR : KEEPER_FR).core);
  // 3. current status, conflict / market (the market gap matters most for young players near the line)
  if (r.flags?.includes("injuredNow")) clauses.push("indisponible en ce moment : 2026-27 réduite, pas la suite");
  if (r.flags?.includes("projectionConflict")) clauses.push("projection LNH et pedigree en désaccord");
  const gap = r.market.gap;
  if (gap != null && Math.abs(gap) > 50) {
    const sig: string[] = [];
    if (r.market.ros != null) sig.push(`Ros ${Math.round(r.market.ros)}${NBSP}%`);
    if (r.market.leaguePick != null) sig.push(`${ordinal(r.market.leaguePick)} choix de la ligue`);
    const s = sig.length ? ` (${sig.join(", ")})` : "";
    clauses.push(gap < 0 ? `le marché${s} le paie plus cher` : `le modèle l'aime plus que le marché${s}`);
  }
  // 4. time profile
  const near = nearShare(r);
  if (r.dv.balanced >= 1) {
    if (near >= 0.6) clauses.push(`${pct(near)} de la valeur d'ici ${seasonLabel(FIRST_SEASON + 1)}`);
    else if (near <= 0.3) clauses.push(`valeur surtout après ${seasonLabel(FIRST_SEASON + 1)}`);
  }
  // 5. upside
  const [, p50, p90] = r.band.balanced;
  if (p90 / Math.max(p50, 10) > 3 && p90 >= 30) clauses.push(`gros plafond (P90 ${Math.round(p90)} vs médiane ${Math.round(p50)})`);
  let out = clauses[0]!;
  let added = 0;
  for (let i = 1; i < clauses.length; i++) {
    const next = `${out}${added === 0 ? ", " : " ; "}${clauses[i]}`;
    if (next.length > maxLen) continue;
    out = next;
    added++;
  }
  return out.length > maxLen ? `${out.slice(0, maxLen - 1)}…` : out;
}

/**
 * Short keep / trade hint for a roster row (report and UI): against his own
 * team's 10 keeper slots when the snapshot has them, else the league line.
 */
export function rosterHintFr(r: DynastyRecord): string {
  const gap = r.market.gap ?? 0;
  const kv = keeperView(r);
  if (kv.status === "free") {
    return r.elig.freeThrough != null
      ? `admissible aux mineures : gratuit à garder jusqu'à l'écrémage ${r.elig.freeThrough + 1}`
      : "admissible aux mineures : gratuit à garder";
  }
  if (kv.status === "core") {
    if ((r.phase === "declining" || r.phase === "late_career") && nearShare(r) >= 0.6) {
      return "protéger ; valeur surtout à court terme (à vendre si reconstruction)";
    }
    return "protéger";
  }
  if (kv.status === "bubble") {
    if (gap < -50) return "vendre haut : le marché le paie plus que sa valeur de protection";
    return kv.team && kv.rank != null
      ? `décider à l'écrémage 2027 (${ordinal(kv.rank)} candidat de l'équipe pour 10 places)`
      : "décider à l'écrémage 2027 (sur la ligne)";
  }
  // rental
  if (r.dv.winNow >= 30) return "location : l'utiliser cette saison, l'échanger avant l'écrémage 2027";
  return gap < -50 ? "vendre : le marché le paie plus cher" : "location sans valeur de protection";
}
