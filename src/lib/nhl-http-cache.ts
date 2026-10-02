/**
 * Disk cache for public NHL responses (node scripts only): one file per URL,
 * named sha1(url).json, with the URL beside it in sha1(url).json.url. A
 * cached URL is never requested again, so rebuilding the ML dataset is
 * reproducible and does not hit the API twice for the same season.
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { setNhlHttpCache } from "./nhl-api";

export function nhlCacheFile(dir: string, url: string): string {
  return join(dir, `${createHash("sha1").update(url).digest("hex")}.json`);
}

export function installNhlHttpDiskCache(dir: string): { hits: () => number; stored: () => number } {
  mkdirSync(dir, { recursive: true });
  let hits = 0;
  let stored = 0;
  setNhlHttpCache({
    get(url) {
      const f = nhlCacheFile(dir, url);
      if (!existsSync(f)) return null;
      hits++;
      return readFileSync(f, "utf8");
    },
    set(url, body) {
      const f = nhlCacheFile(dir, url);
      writeFileSync(f, body);
      writeFileSync(`${f}.url`, url);
      stored++;
    },
  });
  return { hits: () => hits, stored: () => stored };
}
