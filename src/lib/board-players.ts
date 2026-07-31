/** Whether `id` exists in the current board player list. */
export function boardHasPlayerId(
  players: readonly { id: number }[],
  id: number | null | undefined,
): boolean {
  if (id == null || !Number.isFinite(id)) return false;
  return players.some((p) => p.id === id);
}
