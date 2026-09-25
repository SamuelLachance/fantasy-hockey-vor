/**
 * Live-draft state: the ordered list of picks marked so far plus our slot.
 * The pick counter is derived (picks.length + 1), so undo and "remove this
 * pick" can never desynchronise it.
 */

/** id 0 = a player that is not on the board ("hors liste"). */
export const UNLISTED_PLAYER_ID = 0;

export interface DraftPick {
  id: number;
  mine: boolean;
}

export interface DraftState {
  v: 1;
  /** Our 1-based slot in the snake order; null until entered. */
  slot: number | null;
  picks: DraftPick[];
}

export const EMPTY_DRAFT_STATE: DraftState = Object.freeze({
  v: 1,
  slot: null,
  picks: Object.freeze([]) as unknown as DraftPick[],
}) as DraftState;

export function currentPickNumber(state: DraftState): number {
  return state.picks.length + 1;
}

export function pickedIds(state: DraftState): Set<number> {
  const ids = new Set<number>();
  for (const p of state.picks) if (p.id !== UNLISTED_PLAYER_ID) ids.add(p.id);
  return ids;
}

export function myPickIds(state: DraftState): number[] {
  return state.picks.filter((p) => p.mine && p.id !== UNLISTED_PLAYER_ID).map((p) => p.id);
}

/** Append a pick; a listed player can only be drafted once. */
export function markPick(state: DraftState, id: number, mine: boolean): DraftState {
  if (!Number.isInteger(id) || id < 0) return state;
  if (id !== UNLISTED_PLAYER_ID && state.picks.some((p) => p.id === id)) return state;
  return { ...state, picks: [...state.picks, { id, mine }] };
}

export function undoLastPick(state: DraftState): DraftState {
  if (state.picks.length === 0) return state;
  return { ...state, picks: state.picks.slice(0, -1) };
}

/** Remove the pick at `index` (fixing a mis-click earlier in the draft). */
export function removePickAt(state: DraftState, index: number): DraftState {
  if (index < 0 || index >= state.picks.length) return state;
  return { ...state, picks: state.picks.filter((_, i) => i !== index) };
}

/** Flip who made the pick at `index` (fixing "Entrée" vs "Maj + Entrée"). */
export function setPickMine(state: DraftState, index: number, mine: boolean): DraftState {
  const pick = state.picks[index];
  if (!pick || pick.mine === mine) return state;
  return { ...state, picks: state.picks.map((p, i) => (i === index ? { ...p, mine } : p)) };
}

export function setDraftSlot(state: DraftState, slot: number | null, teams: number): DraftState {
  const next = slot != null && Number.isInteger(slot) && slot >= 1 && slot <= teams ? slot : null;
  if (next === state.slot) return state;
  return { ...state, slot: next };
}

/**
 * Plain-text export, readable and short enough to paste in a chat:
 *   repechage:light-the-lamp:v1;position=12;choix=8477934m,8478402,0
 * `m` marks our own picks, 0 an unlisted player.
 */
export function serializeDraftState(state: DraftState, slug: string): string {
  const picks = state.picks.map((p) => `${p.id}${p.mine ? "m" : ""}`).join(",");
  return `repechage:${slug}:v1;position=${state.slot ?? ""};choix=${picks}`;
}

export type ParseResult =
  | { ok: true; state: DraftState; dropped: number }
  | { ok: false; error: string };

/**
 * Parse an export. Ids not on the board (`knownIds`) are kept as unlisted
 * picks so the pick counter stays right; duplicates are dropped.
 */
export function parseDraftState(
  text: string,
  slug: string,
  teams: number,
  knownIds?: ReadonlySet<number>,
): ParseResult {
  const trimmed = text.trim();
  const prefix = `repechage:${slug}:v1;`;
  if (!trimmed.startsWith(prefix)) {
    return { ok: false, error: `Le texte doit commencer par « ${prefix} ».` };
  }
  const fields = new Map<string, string>();
  for (const part of trimmed.slice(prefix.length).split(";")) {
    const i = part.indexOf("=");
    if (i > 0) fields.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  const slotRaw = fields.get("position") ?? "";
  let slot: number | null = null;
  if (slotRaw !== "") {
    const n = Number(slotRaw);
    if (!Number.isInteger(n) || n < 1 || n > teams) {
      return { ok: false, error: `Position invalide : ${slotRaw}.` };
    }
    slot = n;
  }
  const picks: DraftPick[] = [];
  const seen = new Set<number>();
  let dropped = 0;
  const list = fields.get("choix") ?? "";
  for (const token of list.split(",").map((t) => t.trim()).filter(Boolean)) {
    const m = /^(\d+)(m?)$/.exec(token);
    if (!m) return { ok: false, error: `Choix illisible : « ${token} ».` };
    let id = Number(m[1]);
    const mine = m[2] === "m";
    if (id !== UNLISTED_PLAYER_ID && knownIds && !knownIds.has(id)) {
      id = UNLISTED_PLAYER_ID;
      dropped++;
    }
    if (id !== UNLISTED_PLAYER_ID) {
      if (seen.has(id)) {
        dropped++;
        continue;
      }
      seen.add(id);
    }
    picks.push({ id, mine });
  }
  return { ok: true, state: { v: 1, slot, picks }, dropped };
}

/** Validate a localStorage payload; anything odd yields the empty state. */
export function parseStoredDraftState(raw: string | null, teams: number): DraftState {
  if (!raw) return EMPTY_DRAFT_STATE;
  try {
    const data = JSON.parse(raw) as Partial<DraftState>;
    if (data?.v !== 1 || !Array.isArray(data.picks)) return EMPTY_DRAFT_STATE;
    let state: DraftState = { v: 1, slot: null, picks: [] };
    state = setDraftSlot(state, typeof data.slot === "number" ? data.slot : null, teams);
    for (const p of data.picks) {
      if (p && typeof p.id === "number" && typeof p.mine === "boolean") {
        state = markPick(state, p.id, p.mine);
      }
    }
    return state;
  } catch (_error) {
    return EMPTY_DRAFT_STATE;
  }
}
