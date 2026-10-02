/**
 * Asset scores for a dynasty league: every player and every future draft
 * pick of every team, on one 0-100 scale, with what to do with each.
 *
 * The value of a player is the league's own dynasty value for the chosen
 * horizon (scoring, roster rules, the Captains keeper-10 cutdown and minors,
 * the Slapshot cap and league contracts are already inside it). The value of
 * a pick is the expected dynasty value of the player taken there: the
 * league's next draft pool, best first — Captains (keeper 10): the players
 * not expected to be kept at the cutdown, never a rostered player still
 * minors-eligible then; Slapshot (everyone carries over): the players nobody
 * rosters — valued from the draft season on, plus a new NHL draft class
 * shaped like the latest one entering then; averaged over where the pick
 * may fall (final standings around today's strength, the lottery). The
 * score is the asset's percentile among the league's rostered players (so a
 * score of 90 beats 90 % of them), ties broken by season points
 * (`assetScore`, shared with the player table); a pick gets the score its
 * value would have.
 *
 * Pure: no fetch, no DOM.
 */
import { rngFor } from "./rng";

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
  /**
   * Captains: keeper odds at the next cutdown, league-wide (`pKept27`) and,
   * for a rostered player, against his own team's 10 slots (`team`). Status
   * « free »: more likely than not still minors-eligible at that cutdown, so
   * protected outside the 10 keepers.
   */
  keeper?: { status: string; pKept27: number | null; team?: { pKept27: number | null } };
  elig?: { now: boolean };
}

/** The next draft's lottery (Captains constitution: the non-playoff teams, top picks drawn by lottery points). */
export interface DraftLottery {
  /** Teams in the lottery: the weakest `teams` of the standings. */
  teams: number;
  /** Picks drawn (1 … draws); the rest of the lottery teams follow in standings order. */
  draws: number;
  /** Lottery weight of each lottery team, weakest first (`teams` entries). */
  weights: number[];
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
  /**
   * Season fantasy points by player id: the asset score's tie-break (the
   * same key as the player table's, `assetKey`). Absent ids read −1.
   */
  seasonFp?: Readonly<Record<string, number | null | undefined>>;
  /** Order of the league's annual drafts: the same every round (default) or reversed every other round. */
  draftOrder?: "fixed" | "snake";
  /** The next draft's lottery, if the league has one. */
  lottery?: DraftLottery | null;
  /**
   * Uncertainty of the final standings behind the next draft's order: the
   * sd of each team's final strength around its strength now, as a multiple
   * of the spread of the teams' strengths now (0 = the order is the current
   * strength order). Default `STANDINGS_NOISE`.
   */
  standingsNoise?: number;
}

/**
 * Default `standingsNoise`: a final strength = strength now + one
 * between-team sd of noise (correlation ≈ 0.71 between the predicted and the
 * final order). Not fitted on the leagues' own history (none on file): the
 * audit of 2026-10-02 put the preseason-to-final Spearman of a 16-team H2H
 * points league at 0.50-0.56 in a synthetic run; 1.0 sits between that and a
 * perfectly known order.
 */
export const STANDINGS_NOISE = 1;

/**
 * Captains Dynasty lottery (constitution, scratchpad dynasty/league-structure.json
 * rules.keeper.draft.lottery): the 11 non-playoff teams by lottery points,
 * 16th 25 … 6th 1 (linear between them: the intermediate points are not
 * published), the top 3 picks drawn.
 */
export const CAPTAINS_LOTTERY: DraftLottery = {
  teams: 11,
  draws: 3,
  weights: Array.from({ length: 11 }, (_, i) => 25 - (24 * i) / 10),
};

/** One player's asset key: his dynasty value, ties broken by his season points (unknown: −1). */
export type AssetKey = readonly [value: number, seasonFp: number];

export const assetKey = (value: number | null | undefined, seasonFp: number | null | undefined): AssetKey => [
  value ?? 0,
  seasonFp ?? -1,
];

const keyLess = (a: AssetKey, b: AssetKey) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

/** The scale an asset score is read against: the league's rostered players' keys, ascending. */
export function assetScale(keys: Iterable<AssetKey>): AssetKey[] {
  return [...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/**
 * Asset score 0-100: the share of the scale strictly below the key. The one
 * definition of the score — the « Actifs » tab and the player table both
 * read it — so a player has the same score in every view (audit 2026-10-02:
 * the tab broke no ties, so a zero-value player read 0 there and up to 9 in
 * the table).
 */
export function assetScore(scale: readonly AssetKey[], key: AssetKey): number {
  const n = scale.length;
  if (!n) return 0;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keyLess(scale[mid]!, key)) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, Math.min(100, Math.round((lo / n) * 100)));
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

/** Season weights of each horizon besides its δ (the engine's modes, params.json `modes`: w0, w1, then 1). */
export const ASSET_MODE_WEIGHTS: Record<AssetHorizon, { w0: number; w1?: number }> = {
  winNow: { w0: 1 },
  balanced: { w0: 1 },
  longTerm: { w0: 0.2, w1: 0.5 },
};

/**
 * A player's dynasty value counted from season `k` on, still discounted to
 * now: his value × the share of his discounted expected gains that falls in
 * seasons ≥ k (the share keeps the market layer's level). With `shift` his
 * whole path moves k seasons later instead (a draft class that only enters
 * the league then). k = 0: his value.
 */
export function valueFrom(r: Pick<AssetRecord, "dv" | "eG">, horizon: AssetHorizon, delta: number, k: number, shift = false): number {
  const dv = Math.max(0, r.dv[horizon] ?? 0);
  if (k <= 0 || !(dv > 0)) return dv;
  const mw = ASSET_MODE_WEIGHTS[horizon];
  const w = (t: number) => (t === 0 ? mw.w0 : t === 1 ? (mw.w1 ?? 1) : 1) * Math.pow(delta, t);
  let all = 0;
  let later = 0;
  r.eG.forEach((x, t) => {
    all += w(t) * x;
    if (shift) later += w(t + k) * x;
    else if (t >= k) later += w(t) * x;
  });
  return all > 0 ? Math.max(0, (dv * later) / all) : 0;
}

/**
 * The pool of the draft `k` seasons out, in value from that draft on
 * (discounted to now):
 *  - a new NHL draft class shaped like the latest one (its path moved to the
 *    draft season), every player available;
 *  - keeper league: everyone not expected to be kept at the cutdown — a
 *    rostered player still minors-eligible then (status « free ») is
 *    protected outside the 10 keepers, so never in it (audit 2026-10-02: 401
 *    owned prospects, Martone 427, Frondell 370, read as available); the
 *    others at 1 − P(kept), his own team's odds first;
 *  - a league where everyone carries over: the players nobody rosters.
 * Players already in the league count from the draft season on: the seasons
 * before it belong to whoever holds them now.
 */
export function draftPool(inp: AssetLeagueInput, horizon: AssetHorizon, k: number): Array<{ v: number; a: number }> {
  const delta = inp.deltas[horizon];
  const rostered = new Set(Object.values(inp.rosters).flat());
  const latestClass = Math.max(...Object.values(inp.records).map((r) => r.draft?.year ?? 0));
  const pool: Array<{ v: number; a: number }> = [];
  for (const [id, r] of Object.entries(inp.records)) {
    if (r.draft?.year === latestClass) {
      pool.push({ v: valueFrom(r, horizon, delta, k, true), a: 1 });
      continue;
    }
    let a = 0;
    if (!rostered.has(id)) a = 1;
    else if (inp.kind === "keeper" && r.keeper?.status !== "free") a = Math.max(0, 1 - (r.keeper?.team?.pKept27 ?? r.keeper?.pKept27 ?? 0));
    if (a > 0) pool.push({ v: valueFrom(r, horizon, delta, k), a });
  }
  return pool;
}

/**
 * P(a team picks at position j of each round of the next draft), j = 0 the
 * first: final standings drawn around the teams' strength now (normal noise
 * of `noise` × the spread of the strengths; the weakest picks first), then
 * the lottery. Seeded: the same inputs give the same odds.
 */
export function draftOrderOdds(
  strength: ReadonlyMap<string, number>,
  opts: { noise: number; lottery?: DraftLottery | null; draws?: number },
): Map<string, number[]> {
  const teams = [...strength.keys()].sort();
  const n = teams.length;
  const s = teams.map((t) => strength.get(t)!);
  const mean = s.reduce((a, x) => a + x, 0) / Math.max(1, n);
  const sd = Math.sqrt(s.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  const sigma = Math.max(0, opts.noise) * sd;
  const lot = opts.lottery && opts.lottery.teams > 0 && opts.lottery.draws > 0 ? opts.lottery : null;
  const M = sigma > 0 || lot ? (opts.draws ?? 4000) : 1;
  const rng = rngFor(`|asset-order|${teams.join(",")}`);
  const odds = teams.map(() => new Array<number>(n).fill(0));
  const fin = new Array<number>(n).fill(0);
  for (let m = 0; m < M; m++) {
    for (let i = 0; i < n; i++) fin[i] = s[i]! + (sigma > 0 ? sigma * rng.n() : 0);
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => fin[a]! - fin[b]! || teams[a]!.localeCompare(teams[b]!));
    let picks = order;
    if (lot) {
      const L = Math.min(n, lot.teams);
      const left = order.slice(0, L).map((team, i) => ({ team, w: Math.max(0, lot.weights[i] ?? 0) }));
      const drawn: number[] = [];
      for (let d = 0; d < Math.min(lot.draws, L); d++) {
        const tot = left.reduce((a, x) => a + x.w, 0);
        let u = rng.u() * tot;
        let j = 0;
        while (j < left.length - 1 && u >= left[j]!.w) {
          u -= left[j]!.w;
          j++;
        }
        drawn.push(left.splice(j, 1)[0]!.team);
      }
      picks = [...drawn, ...left.map((x) => x.team), ...order.slice(L)];
    }
    picks.forEach((team, j) => (odds[team]![j]! += 1 / M));
  }
  return new Map(teams.map((t, i) => [t, odds[i]!]));
}

export function assetsOf(inp: AssetLeagueInput, horizon: AssetHorizon): TeamAssets[] {
  const delta = inp.deltas[horizon];
  const val = (id: string) => Math.max(0, inp.records[id]?.dv[horizon] ?? 0);
  const keyOf = (id: string) => assetKey(val(id), inp.seasonFp?.[id]);
  const rostered = new Set(Object.values(inp.rosters).flat());
  const scale = assetScale([...rostered].map(keyOf));
  // the replacement asset: the value at the 15th percentile of rostered players
  const replacement = scale[Math.floor(scale.length * 0.15)]?.[0] ?? 0;

  const nTeams = inp.teams.length;
  const rounds = Math.max(1, ...inp.picks.map((p) => p.round));
  // slot values of each future draft (k seasons out)
  const slotsBy = new Map<number, number[]>();
  const slotsAt = (k: number) => {
    let s = slotsBy.get(k);
    if (!s) {
      s = slotValues(draftPool(inp, horizon, k), nTeams * rounds);
      slotsBy.set(k, s);
    }
    return s;
  };

  // ---- players
  const strengthNow = new Map<string, number>();
  const byTeam = new Map<string, Asset[]>();
  for (const t of inp.teams) {
    const ids = inp.rosters[t] ?? [];
    const gains = ids.map((id) => Math.max(0, inp.records[id]?.eG[0] ?? 0)).sort((a, b) => b - a);
    strengthNow.set(t, gains.slice(0, 20).reduce((s, x) => s + x, 0));
    byTeam.set(t, []);
  }
  // the next draft's order: final standings around today's strength (weakest first), then the lottery
  const nextOdds =
    nTeams > 0 && inp.picks.some((p) => p.year === inp.firstSeason + 1)
      ? draftOrderOdds(strengthNow, { noise: inp.standingsNoise ?? STANDINGS_NOISE, lottery: inp.lottery ?? null })
      : new Map<string, number[]>();
  const uniform = new Array<number>(nTeams).fill(1 / Math.max(1, nTeams));

  for (const t of inp.teams) {
    for (const id of inp.rosters[t] ?? []) {
      const r = inp.records[id];
      if (!r) continue;
      const v = val(id);
      const s = assetScore(scale, keyOf(id));
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

  // ---- picks: expected value over the pick's position in its round
  const slotOf = (round: number, j: number) => {
    const pos = inp.draftOrder === "snake" && round % 2 === 0 ? nTeams - 1 - j : j;
    return Math.min(nTeams * rounds, (round - 1) * nTeams + pos + 1);
  };
  for (const p of inp.picks) {
    if (!byTeam.has(p.owner)) continue;
    const yearsOut = Math.max(1, p.year - inp.firstSeason);
    const slots = slotsAt(yearsOut);
    const odds = (p.year === inp.firstSeason + 1 ? nextOdds.get(p.original) : undefined) ?? uniform;
    let v = 0;
    let eSlot = 0;
    odds.forEach((q, j) => {
      if (!(q > 0)) return;
      const slot = slotOf(p.round, j);
      v += q * (slots[slot - 1] ?? 0);
      eSlot += q * slot;
    });
    const s = assetScore(scale, assetKey(v, null));
    byTeam.get(p.owner)!.push({
      kind: "pick",
      id: `${p.year}-${p.round}-${p.original}`,
      team: p.owner,
      name: `${p.round}${p.round === 1 ? "re" : "e"} ronde ${p.year}`,
      year: p.year,
      round: p.round,
      original: p.original,
      slot: Math.max(1, Math.round(eSlot)),
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
