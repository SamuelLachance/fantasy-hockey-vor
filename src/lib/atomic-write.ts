import { mkdirSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname } from "path";

/**
 * Write via temp file + rename so a crash mid-write can never leave a
 * truncated JSON artifact behind.
 */
export function writeFileAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, contents);
  try {
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}
