/** Role for the stale rankings banner. */
export function staleBannerRole(veryStale: boolean): "alert" | "status" {
  return veryStale ? "alert" : "status";
}

/** Structured parts for the stale rankings banner (visible + aria). */
export function staleBannerParts(
  ageDays: number,
  veryStale: boolean,
): {
  days: number;
  unit: "day" | "days";
  urgency: string;
  command: string;
} {
  const days = Math.floor(ageDays);
  return {
    days,
    unit: days === 1 ? "day" : "days",
    urgency: veryStale ? " (refresh urgently)" : "",
    command: "npm run generate",
  };
}

/** Visible + aria-live copy for stale projection age. */
export function staleBannerMessage(ageDays: number, veryStale: boolean): string {
  const { days, unit, urgency, command } = staleBannerParts(ageDays, veryStale);
  return (
    `Rankings data is ${days} ${unit} old${urgency} — re-run ${command} ` +
    "after refresh/train for current projections."
  );
}
