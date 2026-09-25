/**
 * Verbatim guard (pure): published Snake text must be a paraphrase, never a
 * run of the captions' own words. A run of `VERBATIM_MAX_RUN` or more
 * consecutive words (accents, case and punctuation folded) shared with the
 * episode's transcript fails the local check. The transcripts themselves
 * never enter the repo: the scripts read them from `SNAKE_TRANSCRIPTS_DIR`
 * and skip the guard when it is not set.
 */
import type { SnakeBuildOutput } from "./build";

/** Shortest shared run that fails the guard. */
export const VERBATIM_MAX_RUN = 10;

/** Folded word list: accents off, lowercase, apostrophes split words. */
export function verbatimWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** Words of a transcript file: header lines (#) and [hh:mm:ss] marks dropped. */
export function transcriptWords(raw: string): string[] {
  const body = raw
    .split(/\r?\n/)
    .filter((l) => !l.startsWith("#"))
    .map((l) => l.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, ""))
    .join(" ");
  return verbatimWords(body);
}

/** Every `n`-word window of `words`. */
export function ngramSet(words: readonly string[], n = VERBATIM_MAX_RUN): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}

/**
 * Longest run of `text` found word for word in any of `sets` (0 when it
 * shares no `n`-word window).
 */
export function longestSharedRun(
  text: string,
  sets: ReadonlyArray<ReadonlySet<string> | null>,
  n = VERBATIM_MAX_RUN,
): { length: number; run: string } {
  const w = verbatimWords(text);
  let best = { length: 0, run: "" };
  let start = -1;
  for (let i = 0; i + n <= w.length + 1; i++) {
    const hit = i + n <= w.length && sets.some((s) => s?.has(w.slice(i, i + n).join(" ")));
    if (hit && start < 0) start = i;
    if (!hit && start >= 0) {
      const length = i - 1 - start + n;
      if (length > best.length) best = { length, run: w.slice(start, start + length).join(" ") };
      start = -1;
    }
  }
  return best;
}

export interface VerbatimHit {
  /** Where: `opinion <key> <vid>@<t> <field>`, `synthesis <key> <field>`, `ranking <vid>`. */
  where: string;
  length: number;
  run: string;
}

/**
 * Every published text field with a run of `n`+ words from its episode's
 * transcript. `grams(vid)` returns the video's n-gram set (null when its
 * transcript is missing: that text is not checked).
 */
export function findVerbatimRuns(
  out: Pick<SnakeBuildOutput, "shards" | "rankings">,
  grams: (vid: string) => ReadonlySet<string> | null,
  n = VERBATIM_MAX_RUN,
): VerbatimHit[] {
  const hits: VerbatimHit[] = [];
  const check = (where: string, text: string | null | undefined, sets: ReadonlyArray<ReadonlySet<string> | null>) => {
    if (!text) return;
    const r = longestSharedRun(text, sets, n);
    if (r.length >= n) hits.push({ where, ...r });
  };
  for (const shard of out.shards) {
    for (const [key, { r, o }] of Object.entries(shard.players)) {
      for (const op of o) {
        const sets = [grams(op.vid)];
        const at = `opinion ${key} ${op.vid}@${op.t}`;
        check(`${at} o`, op.o, sets);
        check(`${at} cx`, op.cx, sets);
        check(`${at} pj`, op.pj, sets);
        op.f.forEach((t, i) => check(`${at} f${i}`, t, sets));
        op.w.forEach((t, i) => check(`${at} w${i}`, t, sets));
        op.c.forEach((t, i) => check(`${at} c${i}`, t, sets));
      }
      if (r.dv) continue; // a stand-in row repeats an opinion checked above
      const sets = [...new Set(o.map((op) => op.vid))].map(grams);
      check(`synthesis ${key} s`, r.s, sets);
      check(`synthesis ${key} x`, r.x, sets);
      check(`synthesis ${key} pj`, r.pj, sets);
      r.f.forEach((t, i) => check(`synthesis ${key} f${i}`, t, sets));
      r.w.forEach((t, i) => check(`synthesis ${key} w${i}`, t, sets));
      r.c.forEach((t, i) => check(`synthesis ${key} c${i}`, t, sets));
    }
  }
  for (const rk of out.rankings.rankings) check(`ranking ${rk.vid} ${rk.ti.slice(0, 40)}`, rk.ti, [grams(rk.vid)]);
  return hits;
}
