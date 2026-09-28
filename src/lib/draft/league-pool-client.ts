/**
 * A categories league's `pool.json` in the browser: fetched on demand, once
 * per page view (and kept across tab changes), with the build's cache
 * buster. The board stays inlined in the pages: without this file (offline
 * mid-draft, a failed fetch) the tables and the draft helper keep the board.
 */
import { leagueDataHref } from "@/lib/site";
import type { LeaguePool } from "./board-types";
import { isLeaguePool } from "./league-pool";

const promises = new Map<string, Promise<LeaguePool>>();
const values = new Map<string, LeaguePool>();

const TIMEOUT_MS = 15_000;

async function fetchPool(slug: string): Promise<LeaguePool> {
  const url = leagueDataHref(slug, "pool.json");
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal, credentials: "omit" });
      if (!res.ok) throw new Error(`pool.json HTTP ${res.status}`);
      const raw: unknown = await res.json();
      if (!isLeaguePool(raw, slug)) throw new Error("pool.json is malformed");
      return raw;
    } catch (err) {
      lastError = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
    } finally {
      globalThis.clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("pool.json failed");
}

/** The league's pool (a failed read can be retried: the next call fetches again). */
export function loadLeaguePool(slug: string): Promise<LeaguePool> {
  let p = promises.get(slug);
  if (!p) {
    const next = fetchPool(slug).then(
      (pool) => {
        values.set(slug, pool);
        return pool;
      },
      (err: unknown) => {
        if (promises.get(slug) === next) promises.delete(slug);
        throw err;
      },
    );
    promises.set(slug, next);
    p = next;
  }
  return p;
}

/** The pool when this page view already has it (a tab change paints at once). */
export function peekLeaguePool(slug: string): LeaguePool | null {
  return values.get(slug) ?? null;
}
