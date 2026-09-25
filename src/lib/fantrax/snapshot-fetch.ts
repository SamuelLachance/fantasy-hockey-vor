/**
 * GETs of the Fantrax files the sync publishes under `public/fantrax/`
 * (build-time cache buster, no credentials). Shared by the league data
 * layer (`league-client.ts`) and the player table's (`pool-client.ts`).
 */
import { fantraxDataHref } from "@/lib/site";

/** A published file (required): 8 s timeout, one retry. */
export async function fetchSnapshotFile<T>(file: string): Promise<T> {
  const url = fantraxDataHref(file);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(url, { signal: controller.signal, credentials: "omit" });
      if (!res.ok) throw new Error(`${file} HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 150));
    } finally {
      globalThis.clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to load ${file}`);
}

/**
 * One GET for a file that may not exist: 404, a non-JSON body (Pages' 404
 * page), a network error or a timeout all mean "not published" → null.
 */
export async function fetchOptionalJson(url: string, timeoutMs = 15_000): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, credentials: "omit" });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timer);
  }
}
