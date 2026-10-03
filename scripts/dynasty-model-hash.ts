/**
 * Fingerprint of the NHLe prospect model's fitting procedure: the design,
 * translation and prediction code (src/lib/dynasty/nhle.ts) and the fit at
 * a date (scripts/dynasty-prospect-fit.ts). Line endings, comments and
 * blank space are ignored, so only a change of code changes it.
 *
 * The walk-forward backtest recorded in src/data/dynasty/prospect-model.json
 * (`backtest.procedureHash`) and the walk-forward fixture
 * (scripts/fixtures/dynasty-prospect-wf2019.json) carry the fingerprint of
 * the procedure they scored. scripts/test-dynasty-nhle.ts fails when either
 * no longer matches: a change to the model must be backtested again
 * (scripts/dynasty-backtest.ts + scripts/dynasty-scorecard.ts --record) and
 * its fixture refrozen (scripts/dynasty-prospect-fixture.ts) before it ships.
 */
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

export const PROCEDURE_FILES = ["src/lib/dynasty/nhle.ts", "scripts/dynasty-prospect-fit.ts"] as const;

/** Source without comments, line endings or runs of white space. */
export function normalizeSource(src: string): string {
  return src
    .replace(/\r\n?/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\/\/.*$/, "").replace(/\s+\/\/ .*$/, "").replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

export function procedureHash(root = process.cwd()): string {
  const h = createHash("sha256");
  for (const f of PROCEDURE_FILES) {
    h.update(f);
    h.update("\0");
    h.update(normalizeSource(readFileSync(join(root, f), "utf8")));
    h.update("\0");
  }
  return h.digest("hex").slice(0, 16);
}
