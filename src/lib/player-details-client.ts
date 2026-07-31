import type { PlayerDetailRecord } from "@/lib/publish-players";
import { playerDetailsHref } from "@/lib/site";

let detailsPromise: Promise<Record<string, PlayerDetailRecord>> | null = null;

/** Keep only id→record maps with string reasoning/summary fields. */
export function normalizePlayerDetailsPayload(
  raw: unknown,
): Record<string, PlayerDetailRecord> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, PlayerDetailRecord> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const rec = value as Record<string, unknown>;
    const reasoning = typeof rec.reasoning === "string" ? rec.reasoning : "";
    const profileSummary =
      typeof rec.profileSummary === "string" ? rec.profileSummary : "";
    const next: PlayerDetailRecord = { reasoning, profileSummary };
    if (rec.perStatSigma && typeof rec.perStatSigma === "object") {
      next.perStatSigma = rec.perStatSigma as PlayerDetailRecord["perStatSigma"];
    }
    if (rec.perStatUncertainty && typeof rec.perStatUncertainty === "object") {
      next.perStatUncertainty =
        rec.perStatUncertainty as PlayerDetailRecord["perStatUncertainty"];
    }
    if (rec.marketEdge && typeof rec.marketEdge === "object") {
      next.marketEdge = rec.marketEdge as PlayerDetailRecord["marketEdge"];
    }
    out[id] = next;
  }
  return out;
}

async function loadDetailsOnce(): Promise<Record<string, PlayerDetailRecord>> {
  const url = playerDetailsHref();
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`player-details.json HTTP ${res.status}`);
      }
      return normalizePlayerDetailsPayload(await res.json());
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
export function fetchPlayerDetails(): Promise<
  Record<string, PlayerDetailRecord>
> {
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
