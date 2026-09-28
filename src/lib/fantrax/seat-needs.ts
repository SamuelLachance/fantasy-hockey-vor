/**
 * The starting seats a drafting roster still has to fill (C4 LW4 RW4 D6 G2
 * in Slapshot), shared by the site's Repêchage board and the stand-alone
 * draft page (`scripts/slapshot-draft/template.html` carries the same
 * function in plain JavaScript; `scripts/test-slapshot-draft.ts` runs both
 * on the same rosters and fails on any difference).
 *
 * A maximum fill (augmenting paths: a player seated earlier moves to another
 * of his positions when that seats one more), players in priority order.
 * Wingers who play both sides make « LW 4/4, RW 0/4 » a lie: two of those
 * four could move to the right. So the wings are also read as one pool of
 * seats (« Ailiers 4/8 ») with how many one-sided players each side could
 * still take (a dummy LW-only, then another, until none fits).
 */

export interface SeatCount {
  filled: number;
  max: number;
  empty: number;
}

export interface WingNeed extends SeatCount {
  /** LW-only players the roster could still seat (after moving its LW/RW players right). */
  lw: number;
  /** RW-only players it could still seat. */
  rw: number;
  /** Seated wingers who play both sides. */
  flex: number;
}

export interface SeatNeedsResult {
  slots: Record<string, SeatCount>;
  /** Both LW and RW exist: the wings as one pool of seats. */
  wing: WingNeed | null;
  /** Slot of each seated player. */
  seatOf: Record<string, string>;
}

/**
 * `players` in priority order (the stand-alone page and the board: season
 * points, then dynasty value); positions outside `slots` are ignored.
 */
export function seatNeeds(
  players: ReadonlyArray<{ id: string; pos: readonly string[] }>,
  slots: Readonly<Record<string, number>>,
): SeatNeedsResult {
  const names = Object.keys(slots);
  const posOf: Record<string, string[]> = {};
  const fill = (list: ReadonlyArray<{ id: string; pos: readonly string[] }>) => {
    const holders: Record<string, string[]> = {};
    for (const s of names) holders[s] = [];
    const seatOf: Record<string, string> = {};
    const tryPlace = (id: string, pos: readonly string[], seen: Record<string, boolean>): boolean => {
      for (const s of pos) {
        if (!seen[s] && holders[s]!.length < slots[s]!) {
          holders[s]!.push(id);
          seatOf[id] = s;
          return true;
        }
      }
      for (const s of pos) {
        if (seen[s]) continue;
        seen[s] = true;
        const hs = holders[s]!;
        for (let k = 0; k < hs.length; k++) {
          const h = hs[k]!;
          if (tryPlace(h, posOf[h]!.filter((x) => x !== s), seen)) {
            hs[k] = id;
            seatOf[id] = s;
            return true;
          }
        }
      }
      return false;
    };
    for (const p of list) {
      if (!posOf[p.id]) posOf[p.id] = names.filter((s) => p.pos.includes(s));
      tryPlace(p.id, posOf[p.id]!, {});
    }
    return { holders, seatOf, tryPlace };
  };
  const base = fill(players);
  const out: Record<string, SeatCount> = {};
  for (const s of names) {
    const filled = base.holders[s]!.length;
    out[s] = { filled, max: slots[s]!, empty: slots[s]! - filled };
  }
  let wing: WingNeed | null = null;
  if (slots.LW !== undefined && slots.RW !== undefined) {
    const room = (side: string) => {
      const extra: Array<{ id: string; pos: string[] }> = [];
      for (let k = 0; k < slots.LW! + slots.RW!; k++) extra.push({ id: `\u0000${side}${k}`, pos: [side] });
      const f = fill([...players, ...extra]);
      return extra.filter((x) => f.seatOf[x.id]).length;
    };
    const seated = [...base.holders.LW!, ...base.holders.RW!];
    const filled = seated.length;
    const max = slots.LW! + slots.RW!;
    wing = {
      filled,
      max,
      empty: max - filled,
      lw: room("LW"),
      rw: room("RW"),
      flex: seated.filter((id) => posOf[id]!.includes("LW") && posOf[id]!.includes("RW")).length,
    };
  }
  return { slots: out, wing, seatOf: base.seatOf };
}

/**
 * The wings' sentence under the need tiles (the board and the stand-alone
 * page: the template carries the same function, compared by
 * test-slapshot-draft.ts). « un LW ou un RW comble un poste » only while BOTH
 * sides still seat a one-sided player: four LW-only players on the left make
 * an LW pick a bench player however many LW/RW the roster has.
 */
export function wingSentence(w: WingNeed): string {
  if (w.empty <= 0) return `Ailiers : les ${w.max} postes sont pris; un ailier de plus ne serait pas partant.`;
  if (w.lw > 0 && w.rw > 0) {
    return w.flex > 0
      ? `Ailiers : ${w.flex} des vôtres jouent à gauche comme à droite, donc un LW ou un RW comble un poste (au plus ${w.lw} LW et ${w.rw} RW de plus).`
      : "Ailiers : 4 LW et 4 RW; « LW ≤ n » = combien de LW de plus trouveraient un poste.";
  }
  const side = w.lw > 0 ? "LW" : "RW";
  const full = side === "LW" ? "RW" : "LW";
  return `Ailiers : plus de poste pour un ${full} seul; seul un ${side} (ou un LW/RW) comble encore un poste, ${side === "LW" ? w.lw : w.rw} au plus.`;
}
