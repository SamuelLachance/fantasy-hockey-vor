/** URLs for the Snake pages and data (pure). */
import dataVersion from "../../data/snake-version.json";

import { SNAKE_PATH } from "./disclaimer";

/** Route of the Snake database page (next/link adds the basePath). */
export { SNAKE_PATH };

/** Content hash of `public/snake/**`, written by `npm run snake:build`. */
export const SNAKE_DATA_VERSION: string = (dataVersion as { v?: string }).v ?? "";

/** In-app href of a player's Snake page, for next/link (no basePath). */
export function snakePlayerHref(key: string): string {
  return `${SNAKE_PATH}?p=${encodeURIComponent(key)}`;
}

/** Search string for the detail view (`?p=`), keeping other params. */
export function snakeSearch(currentSearch: string, key: string | null): string {
  const params = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);
  if (key) params.set("p", key);
  else params.delete("p");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** `?p=` value from a search string (null when absent/blank). */
export function snakeKeyFromSearch(search: string): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const p = params.get("p")?.trim();
  return p ? p.slice(0, 200) : null;
}

function withBasePath(path: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`.replace(/\/{2,}/g, "/");
}

/**
 * Data file under `public/snake/` (basePath + cache buster). The buster is
 * the data's own content hash, not the site build time: the files only
 * change on `npm run snake:build`, so the daily deploys keep them cached
 * (Pages serves them with max-age=600, then revalidates).
 */
export function snakeDataHref(file: string, version: string = SNAKE_DATA_VERSION): string {
  const base = withBasePath(`/snake/${file}`);
  const v = version.trim();
  return v ? `${base}?v=${encodeURIComponent(v)}` : base;
}

/** YouTube deep link at `seconds` (video start when 0). */
export function youtubeHref(videoId: string, seconds = 0): string {
  const base = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  return seconds > 0 ? `${base}&t=${Math.floor(seconds)}s` : base;
}

/** 915 → "15:15"; 3725 → "1:02:05". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}
