/** Role for the stale rankings banner. */
export function staleBannerRole(veryStale: boolean): "alert" | "status" {
  return veryStale ? "alert" : "status";
}

/** Visible + aria-live copy for stale projection age. */
export function staleBannerMessage(ageDays: number, veryStale: boolean): string {
  const days = Math.floor(ageDays);
  const unit = days === 1 ? "day" : "days";
  const urgency = veryStale ? " (refresh urgently)" : "";
  return `Rankings data is ${days} ${unit} old${urgency} — re-run npm run generate after refresh/train for current projections.`;
}
