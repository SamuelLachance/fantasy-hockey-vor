import { mkdirSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname } from "path";

const RENAME_RETRIES = 5;

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Busy-wait: writes are rare and callers are synchronous scripts.
  }
}

/**
 * Write via temp file + rename so a crash mid-write can never leave a
 * truncated JSON artifact behind. Retries the rename — Windows AV/indexer
 * scans transiently lock destination files (EPERM/EBUSY).
 */
export function writeFileAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, contents);
  for (let attempt = 0; attempt < RENAME_RETRIES; attempt++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const retryable = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (!retryable || attempt === RENAME_RETRIES - 1) {
        rmSync(tmp, { force: true });
        throw error;
      }
      sleepSync(200 * (attempt + 1));
    }
  }
}
