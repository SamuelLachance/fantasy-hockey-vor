/** Next expanded player id for j/k / arrow navigation on the board. */
export function nextExpandedPlayerId(
  playerIds: readonly number[],
  expandedId: number | null,
  direction: 1 | -1,
): number | null {
  if (playerIds.length === 0) return null;
  if (expandedId == null) {
    return direction > 0 ? playerIds[0]! : playerIds[playerIds.length - 1]!;
  }
  const idx = playerIds.indexOf(expandedId);
  if (idx < 0) {
    return direction > 0 ? playerIds[0]! : playerIds[playerIds.length - 1]!;
  }
  const next = idx + direction;
  if (next < 0 || next >= playerIds.length) return expandedId;
  return playerIds[next]!;
}

/** Enter / Space toggles an expanded rankings row. */
export function isBoardRowToggleKey(key: string): boolean {
  return key === "Enter" || key === " ";
}
