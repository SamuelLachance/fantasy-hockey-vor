/**
 * Draft helper: value over next available (VONA) for the user's next pick.
 *
 *   VONA(pos) = best available at pos now − expected best at pos by my
 *               following pick
 *
 * The "expected" board removes the picks other teams make in between, taken
 * in Fantrax ADP order (meaningful to about ADP 290; players without ADP are
 * assumed to survive). Only `poolShare` of those picks come out of the pool:
 * in a dynasty draft many go to unprojected prospects who are not in it. This league's draft runs in a FIXED order (not snake,
 * whatever the API says), so pick numbers come straight from `draftPicks`.
 *
 * Value = season FP, plus up to +50% when the roster has empty D / G slots.
 * This is a redraft number; age and Ros% ride along as dynasty hints only.
 */

export type DraftGroup = "C" | "W" | "D" | "G";
export const DRAFT_GROUPS: readonly DraftGroup[] = ["C", "W", "D", "G"];

export interface DraftPickInfo {
  pick: number;
  round: number;
  pickInRound?: number;
  teamId: string;
  playerId?: string;
}

export interface DraftPoolPlayer {
  id: string;
  groups: readonly DraftGroup[];
  seasonFp: number;
  /** Lower = drafted earlier across Fantrax; Infinity when unranked. */
  adp: number;
}

export interface DraftBoardRow {
  id: string;
  value: number;
  seasonFp: number;
  groups: readonly DraftGroup[];
  /** Largest VONA among his groups. */
  vona: number | null;
  /** Likely taken by others before your next pick (ADP simulation). */
  likelyGone: boolean;
}

export interface DraftOutlook {
  state: "not-started" | "running" | "done";
  made: number;
  total: number;
  current: DraftPickInfo | null;
  next: DraftPickInfo | null;
  following: DraftPickInfo | null;
  /** Picks other teams make before `next`. */
  picksBefore: number;
  remaining: DraftPickInfo[];
  vona: Record<DraftGroup, { bestId: string | null; now: number; later: number; vona: number | null }>;
  board: DraftBoardRow[];
}

/** 0..1 share of a position's active slots that are empty or dead. */
export type NeedWeights = Partial<Record<DraftGroup, number>>;

export const NEED_BONUS = 0.5;

export function draftValue(p: DraftPoolPlayer, need: NeedWeights): number {
  const w = Math.max(0, ...p.groups.map((g) => need[g] ?? 0));
  return p.seasonFp * (1 + NEED_BONUS * w);
}

function bestIn(pool: DraftPoolPlayer[], g: DraftGroup, need: NeedWeights) {
  let best: DraftPoolPlayer | null = null;
  let bestV = 0;
  for (const p of pool) {
    if (!p.groups.includes(g)) continue;
    const v = draftValue(p, need);
    if (v > bestV) {
      best = p;
      bestV = v;
    }
  }
  return { best, value: bestV };
}

/** Remove the next `n` players others take, in ADP order. */
function removeByAdp(pool: DraftPoolPlayer[], picks: number, share: number): DraftPoolPlayer[] {
  const n = Math.round(picks * share);
  if (n <= 0) return pool;
  const taken = new Set(
    [...pool]
      .filter((p) => Number.isFinite(p.adp))
      .sort((a, b) => a.adp - b.adp)
      .slice(0, n)
      .map((p) => p.id),
  );
  return pool.filter((p) => !taken.has(p.id));
}

export interface DraftOutlookOptions {
  boardSize?: number;
  /** Share (0..1) of other teams' picks expected to come out of `pool`. */
  poolShare?: number;
}

export function draftOutlook(
  picks: DraftPickInfo[],
  myTeamId: string,
  pool: DraftPoolPlayer[],
  need: NeedWeights = {},
  opts: DraftOutlookOptions = {},
): DraftOutlook {
  const boardSize = opts.boardSize ?? 15;
  const share = Math.min(1, Math.max(0, opts.poolShare ?? 1));
  const ordered = [...picks].sort((a, b) => a.pick - b.pick);
  const made = ordered.filter((p) => p.playerId).length;
  const open = ordered.filter((p) => !p.playerId);
  const drafted = new Set(ordered.map((p) => p.playerId).filter((x): x is string => !!x));
  const available = pool.filter((p) => !drafted.has(p.id));
  const current = open[0] ?? null;
  const remaining = open.filter((p) => p.teamId === myTeamId);
  const next = remaining[0] ?? null;
  const following = remaining[1] ?? null;
  const state = made === 0 ? "not-started" : open.length === 0 ? "done" : "running";

  const picksBefore = current && next ? next.pick - current.pick : 0;
  const atNext = removeByAdp(available, picksBefore, share);
  const atFollowing =
    next && following ? removeByAdp(atNext, following.pick - next.pick - 1, share) : null;

  const vona = {} as DraftOutlook["vona"];
  for (const g of DRAFT_GROUPS) {
    const now = bestIn(atNext, g, need);
    const later = atFollowing ? bestIn(atFollowing, g, need) : null;
    vona[g] = {
      bestId: now.best?.id ?? null,
      now: now.value,
      later: later?.value ?? 0,
      vona: later ? now.value - later.value : null,
    };
  }

  const atNextIds = new Set(atNext.map((p) => p.id));
  const board = available
    .map((p) => {
      const vs = p.groups.map((g) => vona[g].vona).filter((v): v is number => v != null);
      return {
        id: p.id,
        value: draftValue(p, need),
        seasonFp: p.seasonFp,
        groups: p.groups,
        vona: vs.length ? Math.max(...vs) : null,
        likelyGone: !atNextIds.has(p.id),
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, boardSize);

  return {
    state,
    made,
    total: ordered.length,
    current,
    next,
    following,
    picksBefore,
    remaining,
    vona,
    board,
  };
}
