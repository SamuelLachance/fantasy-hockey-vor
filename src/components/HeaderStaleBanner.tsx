import {
  staleBannerMessage,
  staleBannerRole,
} from "@/lib/stale-banner";

interface HeaderStaleBannerProps {
  ageDays: number;
  veryStale: boolean;
}

/** Warn when projection data is older than the freshness thresholds. */
export function HeaderStaleBanner({
  ageDays,
  veryStale,
}: HeaderStaleBannerProps) {
  const days = Math.floor(ageDays);
  return (
    <div
      role={staleBannerRole(veryStale)}
      aria-live={veryStale ? "assertive" : "polite"}
      aria-label={staleBannerMessage(ageDays, veryStale)}
      className={`rounded-xl px-4 py-3 text-sm ${
        veryStale
          ? "border border-rose-500/40 bg-rose-500/10 text-rose-100/90"
          : "border border-amber-500/30 bg-amber-500/10 text-amber-100/90"
      }`}
    >
      Rankings data is{" "}
      <span className="tabular-nums">{days}</span>{" "}
      {days === 1 ? "day" : "days"} old
      {veryStale ? " (refresh urgently)" : ""} — re-run{" "}
      <code className={veryStale ? "text-rose-200" : "text-amber-200"}>
        npm run generate
      </code>{" "}
      after refresh/train for current projections.
    </div>
  );
}
