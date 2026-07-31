/** Rows still hidden behind progressive load. */
export function remainingBoardRows(
  filteredCount: number,
  renderCount: number,
): number {
  return Math.max(0, filteredCount - renderCount);
}
