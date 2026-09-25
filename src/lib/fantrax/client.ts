/**
 * Read-only Fantrax HTTP helpers. The tool never logs in and never writes:
 * every call here is an unauthenticated GET/POST read.
 *
 * - `fxeaGet` / `fxeaPost` are browser-safe (`credentials: "omit"` — the
 *   `*` CORS origin is rejected together with credentials).
 * - `fxpaPost` is for build-time scripts only: fxpa sends no CORS header.
 *
 * All requests share one throttle (>= 1 s apart) and mirror the retry shape
 * of `fetchJson` in nhl-api.ts, with shorter backoff since Fantrax has shown
 * no rate limiting.
 */
import type { FxpaEnvelope, FxpaMessage } from "./api-types";
import { FANTRAX_LEAGUE_ID } from "./config";

export const FXEA_BASE = "https://www.fantrax.com/fxea/general/";
export const FXPA_URL = "https://www.fantrax.com/fxpa/req";

export interface FantraxRequestOptions {
  /** Node only; browsers drop the header. */
  userAgent?: string;
  retries?: number;
  timeoutMs?: number;
  /** Minimum gap between any two Fantrax requests. */
  minIntervalMs?: number;
}

/** fxpa answers HTTP 200 with a `pageError` instead of a status code. */
export class FantraxApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "FantraxApiError";
  }
}

let lastRequestAt = 0;

async function throttle(minIntervalMs: number): Promise<void> {
  const wait = lastRequestAt + minIntervalMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

async function requestText(
  url: string,
  init: RequestInit,
  opts: FantraxRequestOptions,
): Promise<string> {
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  for (let attempt = 0; attempt < retries; attempt++) {
    await throttle(opts.minIntervalMs ?? 1_000);
    let res: Response | null = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      res = await fetch(url, { ...init, signal: controller.signal });
    } catch {
      res = null; // network hiccup or timeout — retryable
    } finally {
      clearTimeout(timer);
    }
    const retryable = !res || res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries - 1) {
      await new Promise((r) => setTimeout(r, 2_000 * 2 ** attempt));
      continue;
    }
    if (!res || !res.ok) {
      throw new FantraxApiError(`Fantrax HTTP ${res?.status ?? "network"}: ${url}`);
    }
    return res.text();
  }
  throw new FantraxApiError(`Fantrax failed after retries: ${url}`);
}

function headers(opts: FantraxRequestOptions, contentType?: string): HeadersInit {
  const h: Record<string, string> = { Accept: "application/json" };
  if (contentType) h["Content-Type"] = contentType;
  if (opts.userAgent) h["User-Agent"] = opts.userAgent;
  return h;
}

function parseJson<T>(text: string, what: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new FantraxApiError(`Fantrax ${what}: response is not JSON`);
  }
}

/** fxea "Unable to find method" comes back as 200 + `{ error }`. */
function assertNoFxeaError(body: unknown, method: string): void {
  if (body && typeof body === "object" && !Array.isArray(body) && "error" in body) {
    throw new FantraxApiError(
      `fxea ${method}: ${String((body as { error: unknown }).error)}`,
    );
  }
}

export async function fxeaGet<T>(
  method: string,
  params: Record<string, string | number>,
  opts: FantraxRequestOptions = {},
): Promise<T> {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  const url = `${FXEA_BASE}${method}${qs ? `?${qs}` : ""}`;
  const text = await requestText(
    url,
    { method: "GET", credentials: "omit", headers: headers(opts) },
    opts,
  );
  const body = parseJson<T>(text, method);
  assertNoFxeaError(body, method);
  return body;
}

export async function fxeaPost<T>(
  method: string,
  body: Record<string, unknown>,
  opts: FantraxRequestOptions = {},
): Promise<T> {
  const text = await requestText(
    `${FXEA_BASE}${method}`,
    {
      method: "POST",
      credentials: "omit",
      headers: headers(opts, "application/json"),
      body: JSON.stringify(body),
    },
    opts,
  );
  const parsed = parseJson<T>(text, method);
  assertNoFxeaError(parsed, method);
  return parsed;
}

/**
 * One batched fxpa POST: `{"msgs":[…]}` in, one `responses[i].data` per
 * message out, in order. Entries without `data` come back as `null` so the
 * caller can degrade per message instead of failing the whole batch.
 */
export async function fxpaPost(
  msgs: FxpaMessage[],
  opts: FantraxRequestOptions = {},
  leagueId = FANTRAX_LEAGUE_ID,
): Promise<Array<unknown | null>> {
  const text = await requestText(
    `${FXPA_URL}?leagueId=${encodeURIComponent(leagueId)}`,
    {
      method: "POST",
      credentials: "omit",
      // The web app posts a JSON string body; text/plain keeps it a simple
      // request should this ever run where CORS preflight matters.
      headers: headers(opts, "text/plain;charset=UTF-8"),
      body: JSON.stringify({ msgs }),
    },
    opts,
  );
  const env = parseJson<FxpaEnvelope>(text, "fxpa");
  if (env.pageError?.code) {
    throw new FantraxApiError(
      `fxpa ${msgs.map((m) => m.method).join(",")}: ${env.pageError.code}`,
      env.pageError.code,
    );
  }
  const responses = env.responses ?? [];
  if (responses.length !== msgs.length) {
    throw new FantraxApiError(
      `fxpa returned ${responses.length} responses for ${msgs.length} messages`,
    );
  }
  return responses.map((r) => (r && r.data !== undefined ? r.data : null));
}
