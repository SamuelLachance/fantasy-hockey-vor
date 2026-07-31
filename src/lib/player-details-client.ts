import type { PlayerDetailRecord } from "@/lib/publish-players";
import { playerDetailsHref } from "@/lib/site";

let detailsPromise: Promise<Record<string, PlayerDetailRecord>> | null = null;

async function loadDetailsOnce(): Promise<Record<string, PlayerDetailRecord>> {
  const url = playerDetailsHref();
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`player-details.json HTTP ${res.status}`);
      }
      const data = (await res.json()) as Record<string, PlayerDetailRecord>;
      return data && typeof data === "object" ? data : {};
    } catch (err) {
      lastError = err;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to load player-details.json");
}

/** Lazy-fetch expand payload (notes + per-stat σ). Cached for the session; retries once on failure. */
export function fetchPlayerDetails(): Promise<Record<string, PlayerDetailRecord>> {
  if (!detailsPromise) {
    detailsPromise = loadDetailsOnce().catch((err) => {
      detailsPromise = null;
      throw err;
    });
  }
  return detailsPromise;
}

/** Test/helpers: clear the in-memory cache so the next fetch hits the network. */
export function resetPlayerDetailsCache(): void {
  detailsPromise = null;
}
