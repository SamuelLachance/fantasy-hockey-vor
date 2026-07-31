import type { PlayerProjection } from "@/lib/types";

/** High-VOR skaters ranked by tightest calibrated uncertainty. */
export function steadiestSkaters(
  players: PlayerProjection[],
  opts: { minVor?: number; limit?: number } = {},
): PlayerProjection[] {
  const minVor = opts.minVor ?? 2;
  const limit = opts.limit ?? 5;
  return [...players]
    .filter(
      (p) =>
        !p.isGoalie &&
        p.vor >= minVor &&
        p.uncertainty?.total?.sigma != null,
    )
    .sort(
      (a, b) =>
        (a.uncertainty!.total.sigma - b.uncertainty!.total.sigma) ||
        b.vor - a.vor,
    )
    .slice(0, limit);
}

export function topEdgeSkaters(
  players: PlayerProjection[],
  limit = 5,
): PlayerProjection[] {
  return [...players]
    .filter((p) => !p.isGoalie && (p.draftValue ?? 0) > 0)
    .sort((a, b) => (b.draftValue ?? 0) - (a.draftValue ?? 0))
    .slice(0, limit);
}
