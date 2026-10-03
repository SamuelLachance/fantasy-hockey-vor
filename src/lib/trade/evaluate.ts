/**
 * A proposed trade, scored for both teams (any number of players and future
 * picks each way):
 *
 * - dynasty value per horizon, as a TEAM (`rosterValue`: a 2-for-1 costs the
 *   receiver his cheapest player, the sender gains an open spot);
 * - this season's points of each team's best lineup (`lineupPoints`), so a
 *   player who fills a hole counts more than one who would sit on the bench;
 * - each team judged on ITS horizon (its window: a contender wins now, a
 *   rebuilding team plays the long game), plus the season fit: the lineup
 *   gain beyond the players' own points (positional need), counted at the
 *   horizon's weight of this season;
 * - the market's view (what the other manager probably sees: Fantrax ADP /
 *   rostered %, mapped onto the league's value curve);
 * - a salary-cap league: each team's committed cap hits season by season,
 *   before and after (the cap-counted players re-chosen by value).
 *
 * Then: fair counter-offers (one asset added or removed on either side) and
 * the best trade to offer each other team (1-for-1, 2-for-1, 1-for-2 among
 * their best assets and yours), ranked by your gain subject to theirs.
 *
 * Pure.
 */
import {
  HORIZONS,
  lineupPoints,
  rosterValue,
  type Horizon,
  type LineupRules,
  type RosterRules,
  type TeamPlayer,
} from "./team-value";

export interface TradePick {
  id: string;
  name: string;
  owner: string;
  /** The team whose pick it was (its slot follows that team's finish). */
  original?: string;
  value: Readonly<Record<Horizon, number>>;
}

export interface CapInputs {
  seasons: number[];
  cap: number[];
  /** Cap hit per season (M$) by player id; absent = unknown (0). */
  hits: (id: string) => readonly number[] | undefined;
  /** Players counted against the cap. */
  spots: number;
  /** A player counts toward the cap now (Active / Reserve). */
  counted: (team: string, id: string) => boolean;
}

export interface TradeContext {
  teams: readonly string[];
  rosters: Readonly<Record<string, readonly string[]>>;
  players: Readonly<Record<string, TeamPlayer>>;
  picks: Readonly<Record<string, TradePick>>;
  /** Each team's horizon (its window). */
  horizonOf: Readonly<Record<string, Horizon>>;
  roster: RosterRules;
  lineup: LineupRules;
  /** Free agents' values per horizon, best first. */
  faValues: Readonly<Record<Horizon, readonly number[]>>;
  /** Best free agent's points per seat. */
  faBySlot: Readonly<Record<string, number>>;
  /** Market value of a player per horizon (null: the model's own). */
  market?: (id: string, h: Horizon) => number | null;
  cap?: CapInputs | null;
}

export interface TradeSide {
  team: string;
  players: readonly string[];
  picks: readonly string[];
}

/** A trade: `a` sends its assets to `b`, `b` sends its own to `a`. */
export interface Trade {
  a: TradeSide;
  b: TradeSide;
}

/** Weight of this season in each horizon (the dynasty engine's modes: w0 · δ⁰). */
export const SEASON_WEIGHT: Record<Horizon, number> = { winNow: 1, balanced: 1, longTerm: 0.2 };

export interface SideEval {
  team: string;
  horizon: Horizon;
  /** Change in team dynasty value, per horizon (roster-aware). */
  dv: Record<Horizon, number>;
  /** Change in this season's best-lineup points. */
  season: number;
  /** The lineup gain beyond the players' own points (positional fit, bench). */
  fit: number;
  /** The verdict number: dv on its own horizon + the season fit at that horizon's weight. */
  gain: number;
  /** The same, as the market sees the players (no fit). */
  marketGain: number;
  /** Players released to make room (own horizon). */
  dropped: string[];
  /** Assets received / sent, their value on the team's horizon (for the receipt). */
  received: Array<{ id: string; name: string; value: number; kind: "player" | "pick" }>;
  sent: Array<{ id: string; name: string; value: number; kind: "player" | "pick" }>;
  cap: { before: number[]; after: number[]; cap: number[]; over: boolean[] } | null;
}

export interface TradeEval {
  a: SideEval;
  b: SideEval;
  /** Both gain on their own horizon. */
  winWin: boolean;
  /** `a`'s gain minus `b`'s (positive: a wins the trade). */
  balance: number;
}

function after(ctx: TradeContext, t: Trade, team: string): { players: string[]; picks: string[] } {
  const side = t.a.team === team ? t.a : t.b;
  const other = t.a.team === team ? t.b : t.a;
  const mine = (ctx.rosters[team] ?? []).filter((id) => !side.players.includes(id));
  const picks = Object.values(ctx.picks)
    .filter((p) => p.owner === team && !side.picks.includes(p.id))
    .map((p) => p.id);
  return { players: [...mine, ...other.players], picks: [...picks, ...other.picks] };
}

const tp = (ctx: TradeContext, ids: readonly string[]) => ids.map((id) => ctx.players[id]).filter((p): p is TeamPlayer => p != null);

/** Team value per horizon (roster-aware players + picks) and its lineup points. */
export interface TeamState {
  dv: Record<Horizon, number>;
  dropped: Record<Horizon, string[]>;
  points: number;
  rawFp: number;
}

export function teamState(ctx: TradeContext, players: readonly string[], picks: readonly string[]): TeamState {
  const ps = tp(ctx, players);
  const dv = {} as Record<Horizon, number>;
  const dropped = {} as Record<Horizon, string[]>;
  for (const h of HORIZONS) {
    const r = rosterValue(ps, h, ctx.roster, ctx.faValues[h]);
    dv[h] = r.value + picks.reduce((s, id) => s + Math.max(0, ctx.picks[id]?.value[h] ?? 0), 0);
    dropped[h] = r.dropped;
  }
  const lp = lineupPoints(ps, ctx.lineup, ctx.faBySlot);
  return { dv, dropped, points: lp.points, rawFp: ps.reduce((s, p) => s + p.fp, 0) };
}

function capLine(ctx: TradeContext, team: string, ids: readonly string[], movedIn: ReadonlySet<string>): number[] | null {
  const cap = ctx.cap;
  if (!cap) return null;
  // counted now (or arriving: a traded player takes a counted spot), best `spots` by balanced value
  const counted = ids
    .filter((id) => movedIn.has(id) || cap.counted(team, id))
    .sort((x, y) => (ctx.players[y]?.dv.balanced ?? 0) - (ctx.players[x]?.dv.balanced ?? 0))
    .slice(0, cap.spots);
  return cap.seasons.map((_, t) => counted.reduce((s, id) => s + (cap.hits(id)?.[t] ?? 0), 0));
}

function marketValue(ctx: TradeContext, id: string, h: Horizon): number {
  const m = ctx.market?.(id, h);
  return m != null ? m : Math.max(0, ctx.players[id]?.dv[h] ?? 0);
}

function sideEval(ctx: TradeContext, t: Trade, team: string, base?: TeamState): SideEval {
  const side = t.a.team === team ? t.a : t.b;
  const other = t.a.team === team ? t.b : t.a;
  const h = ctx.horizonOf[team] ?? "balanced";
  const before = base ?? teamState(ctx, ctx.rosters[team] ?? [], Object.values(ctx.picks).filter((p) => p.owner === team).map((p) => p.id));
  const aft = after(ctx, t, team);
  const now = teamState(ctx, aft.players, aft.picks);
  const dv = {} as Record<Horizon, number>;
  for (const x of HORIZONS) dv[x] = now.dv[x] - before.dv[x];
  const season = now.points - before.points;
  const inFp = tp(ctx, other.players).reduce((s, p) => s + p.fp, 0);
  const outFp = tp(ctx, side.players).reduce((s, p) => s + p.fp, 0);
  const fit = season - (inFp - outFp);
  const gain = dv[h] + SEASON_WEIGHT[h] * fit;
  const mv = (ids: readonly string[], pk: readonly string[]) =>
    ids.reduce((s, id) => s + marketValue(ctx, id, h), 0) + pk.reduce((s, id) => s + Math.max(0, ctx.picks[id]?.value[h] ?? 0), 0);
  const marketGain = mv(other.players, other.picks) - mv(side.players, side.picks);
  const val = (id: string, kind: "player" | "pick") =>
    kind === "player"
      ? { id, name: ctx.players[id]?.name ?? id, value: Math.max(0, ctx.players[id]?.dv[h] ?? 0), kind }
      : { id, name: ctx.picks[id]?.name ?? id, value: Math.max(0, ctx.picks[id]?.value[h] ?? 0), kind };
  let cap: SideEval["cap"] = null;
  if (ctx.cap) {
    const b = capLine(ctx, team, ctx.rosters[team] ?? [], new Set())!;
    const a = capLine(ctx, team, aft.players, new Set(other.players))!;
    cap = { before: b, after: a, cap: ctx.cap.cap, over: a.map((x, i) => x > (ctx.cap!.cap[i] ?? Infinity) + 1e-9) };
  }
  return {
    team,
    horizon: h,
    dv,
    season,
    fit,
    gain,
    marketGain,
    dropped: now.dropped[h].filter((id) => !before.dropped[h].includes(id)),
    received: [...other.players.map((id) => val(id, "player")), ...other.picks.map((id) => val(id, "pick"))],
    sent: [...side.players.map((id) => val(id, "player")), ...side.picks.map((id) => val(id, "pick"))],
    cap,
  };
}

export function evaluateTrade(ctx: TradeContext, t: Trade, bases?: ReadonlyMap<string, TeamState>): TradeEval {
  const a = sideEval(ctx, t, t.a.team, bases?.get(t.a.team));
  const b = sideEval(ctx, t, t.b.team, bases?.get(t.b.team));
  return { a, b, winWin: a.gain >= 0 && b.gain >= 0, balance: a.gain - b.gain };
}

/** Every team's state now (computed once for the searches). */
export function baseStates(ctx: TradeContext): Map<string, TeamState> {
  const out = new Map<string, TeamState>();
  for (const t of ctx.teams) {
    out.set(t, teamState(ctx, ctx.rosters[t] ?? [], Object.values(ctx.picks).filter((p) => p.owner === t).map((p) => p.id)));
  }
  return out;
}

/** A cap trade must leave both teams under the cap this season. */
function capOk(e: TradeEval): boolean {
  return !(e.a.cap?.over[0] || e.b.cap?.over[0]);
}

/**
 * Would the other manager say yes?
 * - "modele" (default): the trade gains for HIM on his own horizon, by the
 *   league's model — a win-win when the user gains too, the kind of offer a
 *   rational manager accepts;
 * - "marche": also when the market (Fantrax ADP / rostered %) says he gains,
 *   as long as the model's loss for him stays under a third of what he sends
 *   (the offers that use the market's mistakes without fleecing him). Never in
 *   a cap league: the market knows nothing of the league's contracts.
 */
export type AcceptMode = "modele" | "marche";

export function acceptable(e: TradeEval, mode: AcceptMode = "modele"): boolean {
  if (e.b.gain >= 0) return true;
  if (mode !== "marche" || e.b.cap) return false;
  const sent = e.b.sent.reduce((s, x) => s + x.value, 0);
  return e.b.marketGain >= 0 && e.b.gain >= -sent / 3;
}

export interface Proposal {
  trade: Trade;
  eval: TradeEval;
  /** What changed from the trade on the table (counter-offers), French. */
  note?: string;
}

function assetsOf(ctx: TradeContext, team: string, limit: number, h: Horizon): Array<{ kind: "player" | "pick"; id: string; v: number }> {
  const pl = (ctx.rosters[team] ?? []).map((id) => ({ kind: "player" as const, id, v: Math.max(0, ctx.players[id]?.dv[h] ?? 0) }));
  const pk = Object.values(ctx.picks)
    .filter((p) => p.owner === team)
    .map((p) => ({ kind: "pick" as const, id: p.id, v: Math.max(0, p.value[h]) }));
  return [...pl, ...pk].filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, limit);
}

const withAsset = (s: TradeSide, x: { kind: "player" | "pick"; id: string }): TradeSide =>
  x.kind === "player" ? { ...s, players: [...s.players, x.id] } : { ...s, picks: [...s.picks, x.id] };
const withoutAsset = (s: TradeSide, x: { kind: "player" | "pick"; id: string }): TradeSide =>
  x.kind === "player" ? { ...s, players: s.players.filter((y) => y !== x.id) } : { ...s, picks: s.picks.filter((y) => y !== x.id) };

/**
 * Counter-offers to a trade (`a` = the user): one asset added to or removed
 * from either side, kept when the other manager would accept and the user
 * gains; best gain first. With nothing better, the trade itself if it
 * already works.
 */
export function counterOffers(ctx: TradeContext, t: Trade, limit = 4, bases = baseStates(ctx), mode: AcceptMode = "modele"): Proposal[] {
  const out: Proposal[] = [];
  const hA = ctx.horizonOf[t.a.team] ?? "balanced";
  const hB = ctx.horizonOf[t.b.team] ?? "balanced";
  const name = (x: { kind: string; id: string }) => (x.kind === "player" ? ctx.players[x.id]?.name : ctx.picks[x.id]?.name) ?? x.id;
  const tryTrade = (trade: Trade, note: string) => {
    if (!trade.a.players.length && !trade.a.picks.length) return;
    if (!trade.b.players.length && !trade.b.picks.length) return;
    const e = evaluateTrade(ctx, trade, bases);
    if (!capOk(e) || !acceptable(e, mode) || e.a.gain <= 0) return;
    out.push({ trade, eval: e, note });
  };
  const inTrade = new Set([...t.a.players, ...t.a.picks, ...t.b.players, ...t.b.picks]);
  // add one of mine (sweetener)
  for (const x of assetsOf(ctx, t.a.team, 25, hB)) if (!inTrade.has(x.id)) tryTrade({ ...t, a: withAsset(t.a, x) }, `ajouter ${name(x)} de votre côté`);
  // ask for one more of theirs
  for (const x of assetsOf(ctx, t.b.team, 25, hA)) if (!inTrade.has(x.id)) tryTrade({ ...t, b: withAsset(t.b, x) }, `demander aussi ${name(x)}`);
  // remove one of mine / one of theirs
  for (const id of t.a.players) tryTrade({ ...t, a: withoutAsset(t.a, { kind: "player", id }) }, `retirer ${ctx.players[id]?.name ?? id} de votre côté`);
  for (const id of t.a.picks) tryTrade({ ...t, a: withoutAsset(t.a, { kind: "pick", id }) }, `retirer ${ctx.picks[id]?.name ?? id} de votre côté`);
  for (const id of t.b.players) tryTrade({ ...t, b: withoutAsset(t.b, { kind: "player", id }) }, `ne pas demander ${ctx.players[id]?.name ?? id}`);
  for (const id of t.b.picks) tryTrade({ ...t, b: withoutAsset(t.b, { kind: "pick", id }) }, `ne pas demander ${ctx.picks[id]?.name ?? id}`);
  out.sort((x, y) => y.eval.a.gain - x.eval.a.gain);
  return out.slice(0, limit);
}

/**
 * The best trades to offer `other` (`me` the user): 1-for-1, 2-for-1 and
 * 1-for-2 among the `depth` best assets of each side (players and picks),
 * kept when the other manager would accept, ranked by the user's gain (own
 * horizon, season fit included).
 */
export function bestOffers(
  ctx: TradeContext,
  me: string,
  other: string,
  opts: { depth?: number; limit?: number; bases?: Map<string, TeamState>; mode?: AcceptMode } = {},
): Proposal[] {
  const depth = opts.depth ?? 14;
  const bases = opts.bases ?? baseStates(ctx);
  const hMe = ctx.horizonOf[me] ?? "balanced";
  const hOt = ctx.horizonOf[other] ?? "balanced";
  const mine = assetsOf(ctx, me, depth, hOt);
  const theirs = assetsOf(ctx, other, depth, hMe);
  const out: Proposal[] = [];
  const side = (team: string, xs: Array<{ kind: "player" | "pick"; id: string }>): TradeSide => ({
    team,
    players: xs.filter((x) => x.kind === "player").map((x) => x.id),
    picks: xs.filter((x) => x.kind === "pick").map((x) => x.id),
  });
  const consider = (give: Array<{ kind: "player" | "pick"; id: string; v: number }>, get: Array<{ kind: "player" | "pick"; id: string; v: number }>) => {
    // the market roughly balanced (offers nobody would read twice are skipped)
    const gv = give.reduce((s, x) => s + x.v, 0);
    const tv = get.reduce((s, x) => s + x.v, 0);
    if (gv < 0.5 * tv || gv > 2.5 * tv) return;
    const trade: Trade = { a: side(me, give), b: side(other, get) };
    const e = evaluateTrade(ctx, trade, bases);
    if (!capOk(e) || !acceptable(e, opts.mode) || e.a.gain <= 0) return;
    out.push({ trade, eval: e });
  };
  for (const g of mine) for (const x of theirs) consider([g], [x]);
  const top = (xs: typeof mine, n: number) => xs.slice(0, n);
  for (const x of top(theirs, 8))
    for (let i = 0; i < Math.min(10, mine.length); i++) for (let j = i + 1; j < Math.min(10, mine.length); j++) consider([mine[i]!, mine[j]!], [x]);
  for (const g of top(mine, 8))
    for (let i = 0; i < Math.min(10, theirs.length); i++) for (let j = i + 1; j < Math.min(10, theirs.length); j++) consider([g], [theirs[i]!, theirs[j]!]);
  out.sort((x, y) => y.eval.a.gain - x.eval.a.gain);
  // one proposal per asset received first (variety)
  const seen = new Set<string>();
  const picked: Proposal[] = [];
  for (const p of out) {
    const key = [...p.trade.b.players, ...p.trade.b.picks].sort().join("+");
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(p);
    if (picked.length >= (opts.limit ?? 3)) break;
  }
  return picked;
}
