import type { PlayerDetailRecord } from "@/lib/publish-players";

let detailsPromise: Promise<Record<string, PlayerDetailRecord>> | null = null;

/** Lazy-fetch expand payload (notes + per-stat σ). Cached for the session. */
export function fetchPlayerDetails(): Promise<Record<string, PlayerDetailRecord>> {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const url = `${base}/player-details.json`.replace(/\/{2,}/g, "/");
  detailsPromise ??= fetch(url)
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}));
  return detailsPromise;
}
