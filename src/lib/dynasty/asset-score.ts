/**
 * Asset scores for a dynasty league: every player and every future draft
 * pick of every team, on one 0-100 scale, with what to do with each.
 *
 * The value of a player is the league's own dynasty value for the chosen
 * horizon (scoring, roster rules, the Captains keeper-10 cutdown and minors,
 * the Slapshot cap and league contracts are already inside it). The value of
 * a pick is the expected dynasty value of the player taken there: the
 * league's next draft pool, best first — Captains (keeper 10): the players
 * not expected to be kept at the cutdown; Slapshot (everyone carries over):
 * the players nobody rosters — plus a new NHL draft class shaped like the
 * latest one, discounted by the seasons until that draft. The score is the
 * asset's percentile among the league's rostered players (so a score of 90
 * beats 90 % of them); a pick gets the score its value would have.
 *
 * Pure: no fetch, no DOM.
 */

export type AssetHorizon = "winNow" | "balanced" | "longTerm";
export type AssetLeague = "keeper" | "dynasty";

export interface AssetRecord {
  n: string;
  g: "F" | "D" | "G";
  age: number;
  phase: string;
  dv: Record<AssetHorizon, number>;
  /** The model rank per horizon (the market gap is measured against it). */
  rank?: Record<AssetHorizon, number>;
  /** Expected gain per season (the model's own units), first seasons. */
  eG: number[];
  draft?: { year: number; pick: number };
  market?: { ros?: number; adp?: number; gap?: number; rank?: number };
  /** Captains: keeper odds at the next cutdown. */
  keeper?: { status: string; pKept27: number | null };
  elig?: { now: boolean };
}

export interface PickInput {
  year: number;
  round: number;
  owner: string;
  original: string;
}

export interface AssetLeagueInput {
  kind: AssetLeague;
  firstSeason: number;
  teams: string[];
  /** teamId → rostered player ids. */
  rosters: Record<string, string[]>;
  records: Record<string, AssetRecord>;
  picks: PickInput[];
  /** Discount per season of each horizon. */
  deltas: Record<AssetHorizon, number>;
  /** Players kept per team at the cutdown (Captains: 10). */
  keepers?: number;
}

export type Tier = "Élite" | "Pilier" | "Solide" | "Utile" | "Marginal";
export type Timeline = "maintenant" | "durable" | "avenir";
export type Window = "Aspirant" | "En montée" | "Entre-deux" | "Reconstruction";
export type Action =
  | "Garder"
  | "Vendre haut"
  | "Vendre maintenant"
  | "Échanger avant l’écrémage"
  | "Remplaçable"
  | "Garder (pièce d’échange)";

export interface PlayerAsset {
  kind: "player";
  id: string;
  team: string;
  name: string;
  value: number;
  score: number;
  tier: Tier;
  timeline: Timeline;
  /** The market pays more (negative) or less (positive) than the model, as a share of his rank. */
  marketGap: number | null;
  flags: string[];
  action: Action;
  why: string;
}

export interface PickAsset {
  kind: "pick";
  id: string;
  team: string;
  name: string;
  year: number;
  round: number;
  original: string;
  /** Expected overall slot used for the value. */
  slot: number;
  value: number;
  score: number;
  tier: Tier;
  action: Action;
  why: string;
}

export type Asset = PlayerAsset | PickAsset;

export interface TeamAssets {
  team: string;
  assets: Asset[];
  /** Sum of player values (horizon), of pick values, and both. */
  playerValue: number;
  pickValue: number;
  total: number;
  /** This season's strength: the best 20 expected gains of the first season. */
  now: number;
  /** Long-term strength: long-term dynasty values of the best 25. */
  future: number;
  window: Window;
  ranks: { total: number; now: number; future: number };
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function tierOf(score: number): Tier {
  if (score >= 97) return "Élite";
  if (score >= 88) return "Pilier";
  if (score >= 65) return "Solide";
  if (score >= 35) return "Utile";
  return "Marginal";
}

/** Share of the discounted value that falls in the next two seasons. */
export function nowShare(eG: readonly number[], delta: number): number {
  let tot = 0;
  let near = 0;
  eG.forEach((x, t) => {
    const w = Math.pow(delta, t) * Math.max(0, x);
    tot += w;
    if (t <= 1) near += w;
  });
  return tot > 0 ? near / tot : 0;
}

function timelineOf(eG: readonly number[], delta: number, phase: string): Timeline {
  if (phase === "prospect") return "avenir";
  const s = nowShare(eG, delta);
  return s >= 0.6 ? "maintenant" : s <= 0.35 ? "avenir" : "durable";
}

/** Percentile scorer against a sorted (ascending) list of values. */
function scorer(sortedAsc: readonly number[]): (v: number) => number {
  const n = sortedAsc.length;
  return (v: number) => {
    if (!n) return 0;
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedAsc[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(0, Math.min(100, Math.round((lo / n) * 100)));
  };
}

/**
 * Expected value of the player taken at each overall slot 1..slots of the
 * next draft: the pool (value, availability) sorted best first, the k-th
 * expected pick where the cumulative availability reaches k.
 */
export function slotValues(pool: ReadonlyArray<{ v: number; a: number }>, slots: number): number[] {
  const sorted = [...pool].filter((x) => x.a > 0 && x.v > 0).sort((x, y) => y.v - x.v);
  const out: number[] = [];
  let cum = 0;
  let i = 0;
  for (let k = 1; k <= slots; k++) {
    while (i < sorted.length && cum + sorted[i]!.a < k - 1e-9) {
      cum += sorted[i]!.a;
      i++;
    }
    out.push(i < sorted.length ? sorted[i]!.v : 0);
  }
  return out;
}

export function assetsOf(inp: AssetLeagueInput, horizon: AssetHorizon): TeamAssets[] {
  const delta = inp.deltas[horizon];
  const val = (id: string) => Math.max(0, inp.records[id]?.dv[horizon] ?? 0);
  const rostered = new Set(Object.values(inp.rosters).flat());
  const rosteredVals = [...rostered].map(val).sort((a, b) => a - b);
  const score = scorer(rosteredVals);
  // the replacement asset: the value at the 15th percentile of rostered players
  const replacement = rosteredVals[Math.floor(rosteredVals.length * 0.15)] ?? 0;

  // ---- the next draft's pool
  const latestClass = Math.max(...Object.values(inp.records).map((r) => r.draft?.year ?? 0));
  const pool: Array<{ v: number; a: number }> = [];
  for (const [id, r] of Object.entries(inp.records)) {
    const v = Math.max(0, r.dv[horizon]);
    // a new NHL draft class shaped like the latest one
    if (r.draft?.year === latestClass) pool.push({ v, a: 1 });
    if (inp.kind === "keeper") {
      // keeper league: everyone not kept at the cutdown is back in the pool
      const p = rostered.has(id) ? (r.keeper?.pKept27 ?? 0) : 0;
      if (r.draft?.year !== latestClass) pool.push({ v, a: Math.max(0, 1 - p) });
    } else if (!rostered.has(id) && r.draft?.year !== latestClass) {
      pool.push({ v, a: 1 });
    }
  }
  const nTeams = inp.teams.length;
  const rounds = Math.max(1, ...inp.picks.map((p) => p.round));
  const slots = slotValues(pool, nTeams * rounds);

  // ---- players
  const strengthNow = new Map<string, number>();
  const byTeam = new Map<string, Asset[]>();
  for (const t of inp.teams) {
    const ids = inp.rosters[t] ?? [];
    const gains = ids.map((id) => Math.max(0, inp.records[id]?.eG[0] ?? 0)).sort((a, b) => b - a);
    strengthNow.set(t, gains.slice(0, 20).reduce((s, x) => s + x, 0));
    byTeam.set(t, []);
  }
  // draft order of the next draft: weakest now first (assumption)
  const order = [...inp.teams].sort((a, b) => strengthNow.get(a)! - strengthNow.get(b)!);
  const posOf = new Map(order.map((t, i) => [t, i]));

  for (const t of inp.teams) {
    for (const id of inp.rosters[t] ?? []) {
      const r = inp.records[id];
      if (!r) continue;
      const v = val(id);
      const s = score(v);
      const gapRaw = r.market?.gap;
      const rank = r.market?.rank ?? r.rank?.balanced;
      const marketGap = gapRaw != null && rank != null ? gapRaw / Math.max(20, rank) : null;
      const flags: string[] = [];
      if (marketGap != null && marketGap <= -0.25) flags.push("le marché le paie plus cher");
      if (marketGap != null && marketGap >= 0.25) flags.push("sous-estimé par le marché");
      const cutRisk = inp.kind === "keeper" && r.keeper && r.keeper.pKept27 != null && r.keeper.pKept27 < 0.5 && !r.elig?.now;
      if (cutRisk) flags.push(`${Math.round((1 - r.keeper!.pKept27!) * 100)} % de risque de ne pas être protégé`);
      byTeam.get(t)!.push({
        kind: "player",
        id,
        team: t,
        name: r.n,
        value: r1(v),
        score: s,
        tier: tierOf(s),
        timeline: timelineOf(r.eG, delta, r.phase),
        marketGap: marketGap == null ? null : Math.round(marketGap * 100) / 100,
        flags,
        action: "Garder",
        why: "",
      });
    }
  }

  // ---- picks
  for (const p of inp.picks) {
    if (!byTeam.has(p.owner)) continue;
    const yearsOut = Math.max(1, p.year - inp.firstSeason);
    const pos = p.year === inp.firstSeason + 1 ? (posOf.get(p.original) ?? (nTeams - 1) / 2) : (nTeams - 1) / 2;
    const slot = Math.min(slots.length, (p.round - 1) * nTeams + Math.round(pos) + 1);
    const v = (slots[slot - 1] ?? 0) * Math.pow(delta, yearsOut);
    const s = score(v);
    byTeam.get(p.owner)!.push({
      kind: "pick",
      id: `${p.year}-${p.round}-${p.original}`,
      team: p.owner,
      name: `${p.round}${p.round === 1 ? "re" : "e"} ronde ${p.year}`,
      year: p.year,
      round: p.round,
      original: p.original,
      slot,
      value: r1(v),
      score: s,
      tier: tierOf(s),
      action: "Garder",
      why: "",
    });
  }

  // ---- team totals and window
  const teamsOut: TeamAssets[] = inp.teams.map((t) => {
    const assets = byTeam.get(t)!;
    const players = assets.filter((a): a is PlayerAsset => a.kind === "player");
    const playerValue = players.reduce((s, a) => s + a.value, 0);
    const pickValue = assets.filter((a) => a.kind === "pick").reduce((s, a) => s + a.value, 0);
    const future = (inp.rosters[t] ?? [])
      .map((id) => Math.max(0, inp.records[id]?.dv.longTerm ?? 0))
      .sort((a, b) => b - a)
      .slice(0, 25)
      .reduce((s, x) => s + x, 0);
    return {
      team: t,
      assets,
      playerValue: r1(playerValue),
      pickValue: r1(pickValue),
      total: r1(playerValue + pickValue),
      now: r1(strengthNow.get(t)!),
      future: r1(future),
      window: "Entre-deux",
      ranks: { total: 0, now: 0, future: 0 },
    };
  });
  const rankBy = (k: "total" | "now" | "future") => {
    const sorted = [...teamsOut].sort((a, b) => b[k] - a[k]);
    sorted.forEach((t, i) => (t.ranks[k] = i + 1));
  };
  rankBy("total");
  rankBy("now");
  rankBy("future");
  for (const t of teamsOut) {
    const third = Math.ceil(nTeams / 3);
    if (t.ranks.now <= third) t.window = "Aspirant";
    else if (t.ranks.future <= third) t.window = "En montée";
    else if (t.ranks.now > Math.floor(nTeams / 2) && t.ranks.future > Math.floor(nTeams / 2)) t.window = "Reconstruction";
    // ---- actions, given the team's window
    for (const a of t.assets) {
      if (a.kind === "pick") {
        if (t.window === "Aspirant") {
          a.action = "Garder (pièce d’échange)";
          a.why = "Une équipe qui gagne maintenant peut l’échanger contre un joueur qui aide cette saison.";
        } else {
          a.why =
            t.window === "Reconstruction" || t.window === "En montée"
              ? "Pour une équipe qui vise plus loin, les choix sont le carburant : à garder."
              : "Valeur stable; utile dans un échange.";
        }
        continue;
      }
      const why: string[] = [];
      if (a.flags.some((f) => f.startsWith("le marché"))) {
        a.action = "Vendre haut";
        why.push("le marché le paie plus que sa valeur pour la ligue");
      }
      if (inp.kind === "keeper" && a.flags.some((f) => f.includes("protégé")) && a.value > replacement) {
        a.action = "Échanger avant l’écrémage";
        why.push("il risque de ne pas faire partie des 10 protégés : sa valeur s’évapore à l’écrémage");
      }
      if (a.action === "Garder" && (t.window === "Reconstruction" || t.window === "En montée") && a.timeline === "maintenant" && a.score >= 35) {
        a.action = "Vendre maintenant";
        why.push("sa valeur est surtout cette saison et la prochaine, alors que l’équipe vise plus loin");
      }
      if (a.action === "Garder" && t.window === "Aspirant" && a.timeline === "avenir" && a.score >= 65) {
        a.action = "Garder (pièce d’échange)";
        why.push("sa valeur arrive plus tard : la meilleure monnaie pour renforcer l’équipe maintenant");
      }
      if (a.action === "Garder" && a.value <= replacement) {
        a.action = "Remplaçable";
        why.push("un joueur disponible vaut autant : place à libérer");
      }
      if (!why.length) why.push(a.score >= 88 ? "pièce centrale de l’équipe" : "valeur à sa place dans l’équipe");
      a.why = why.join("; ");
    }
    t.assets.sort((x, y) => y.value - x.value);
  }
  return teamsOut;
}

/**
 * Trade targets for one team: other teams' players whose market undervalues
 * them and whose timeline fits the team's window, best value first.
 */
export function tradeTargets(teams: readonly TeamAssets[], mine: string, limit = 12): PlayerAsset[] {
  const me = teams.find((t) => t.team === mine);
  if (!me) return [];
  const want: Timeline[] = me.window === "Aspirant" ? ["maintenant", "durable"] : me.window === "Reconstruction" || me.window === "En montée" ? ["avenir", "durable"] : ["durable", "maintenant", "avenir"];
  return teams
    .filter((t) => t.team !== mine)
    .flatMap((t) => t.assets.filter((a): a is PlayerAsset => a.kind === "player"))
    .filter((a) => a.flags.includes("sous-estimé par le marché") && want.includes(a.timeline) && a.score >= 50)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}
