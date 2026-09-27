/**
 * Hand rank adjustments of a categories league board
 * (`src/data/leagues/<slug>/rank-adjustments.json`), applied after the
 * category engine has ranked the board (`buildLeagueBoard`).
 *
 * They exist for projection defects that live in the shared `players.json`
 * (the Fantrax league, the dynasty build and the main table read it too),
 * so the correction stays local to one league's board and is written down,
 * with a French reason the site shows next to the row.
 *
 * The algorithm is the one the pasted Yahoo pre-draft list was built with:
 * remove every adjusted row from the engine order, then re-insert each at
 * index `insertAt - 1` (clamped to the end), deepest `insertAt` first. A
 * shallower re-insert pushes the deeper ones down, so a row can end a few
 * ranks below its `insertAt` (Landeskog: insertAt 189, final rank 196).
 *
 * Pure: no fs, no engine imports.
 */

export interface RankAdjustment {
  /** NHL id. */
  id: number;
  /** Board name (a guard against a mistyped id). */
  name: string;
  /** Engine rank the move was decided against (drift is reported, not fatal). */
  engineRank: number;
  /** Target index (1-based) in the list with every adjusted row removed. */
  insertAt: number;
  /** Why (French, shown on the site). */
  reason: string;
}

export interface RankAdjustmentsFile {
  schema: 1;
  league: string;
  decidedAt: string;
  note?: string;
  adjustments: RankAdjustment[];
}

const isPositiveInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x > 0;

/** Shape errors of an adjustments file (empty = valid). */
export function rankAdjustmentErrors(raw: unknown, slug: string): string[] {
  const errors: string[] = [];
  const f = raw as Partial<RankAdjustmentsFile> | null;
  if (!f || typeof f !== "object") return ["not an object"];
  if (f.schema !== 1) errors.push(`schema ${String(f.schema)}`);
  if (f.league !== slug) errors.push(`league ${String(f.league)} ≠ ${slug}`);
  if (typeof f.decidedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f.decidedAt)) errors.push("decidedAt");
  if (!Array.isArray(f.adjustments)) return [...errors, "adjustments is not an array"];
  const ids = new Set<number>();
  const targets = new Set<number>();
  f.adjustments.forEach((a, i) => {
    const at = `adjustments[${i}]${a && typeof a.name === "string" ? ` (${a.name})` : ""}`;
    if (!a || typeof a !== "object") {
      errors.push(`${at}: not an object`);
      return;
    }
    if (!isPositiveInt(a.id)) errors.push(`${at}: id`);
    else if (ids.has(a.id)) errors.push(`${at}: duplicate id ${a.id}`);
    else ids.add(a.id);
    if (typeof a.name !== "string" || a.name.trim() === "") errors.push(`${at}: name`);
    if (!isPositiveInt(a.engineRank)) errors.push(`${at}: engineRank`);
    if (!isPositiveInt(a.insertAt)) errors.push(`${at}: insertAt`);
    // Two rows aiming at one index would be ordered by their place in the file.
    else if (targets.has(a.insertAt)) errors.push(`${at}: duplicate insertAt ${a.insertAt}`);
    else targets.add(a.insertAt);
    if (typeof a.reason !== "string" || a.reason.trim().length < 10) errors.push(`${at}: reason missing or too short`);
  });
  return errors;
}

/** Parse and validate (throws with every shape error). */
export function parseRankAdjustments(raw: unknown, slug: string): RankAdjustmentsFile {
  const errors = rankAdjustmentErrors(raw, slug);
  if (errors.length > 0) throw new Error(`rank adjustments of ${slug}: ${errors.join("; ")}`);
  return raw as RankAdjustmentsFile;
}

/**
 * The adjusted order: every listed row removed, then re-inserted deepest
 * `insertAt` first at index `insertAt - 1`. Listed ids missing from `order`
 * are skipped and returned (the build and the board check both warn: a
 * projection refresh must never block a deploy on its own).
 */
export function applyRankAdjustments<T>(
  order: readonly T[],
  adjustments: readonly Pick<RankAdjustment, "id" | "insertAt">[],
  idOf: (row: T) => number,
): { order: T[]; missing: number[] } {
  const list = [...order];
  const moved: Array<{ row: T; insertAt: number }> = [];
  const missing: number[] = [];
  for (const a of adjustments) {
    const i = list.findIndex((r) => idOf(r) === a.id);
    if (i < 0) {
      missing.push(a.id);
      continue;
    }
    moved.push({ row: list.splice(i, 1)[0]!, insertAt: a.insertAt });
  }
  // Stable sort: equal targets keep the file's order (the file check forbids them anyway).
  moved.sort((a, b) => b.insertAt - a.insertAt);
  for (const m of moved) list.splice(Math.min(m.insertAt - 1, list.length), 0, m.row);
  return { order: list, missing };
}

/**
 * Values that follow a hand-made order: each run of adjusted rows gets
 * values spaced evenly between its nearest unadjusted neighbours (the one
 * above and the one below), so a sort by value agrees with the order. A run
 * at the top or the bottom takes its only neighbour's value.
 */
export function bridgeValues(values: readonly number[], adjusted: readonly boolean[]): number[] {
  const out = [...values];
  let i = 0;
  while (i < values.length) {
    if (!adjusted[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < values.length && adjusted[j]) j++;
    const above = i > 0 ? values[i - 1] : undefined;
    const below = j < values.length ? values[j] : undefined;
    for (let k = i; k < j; k++) {
      if (above !== undefined && below !== undefined) {
        out[k] = above + ((below - above) * (k - i + 1)) / (j - i + 1);
      } else {
        out[k] = above ?? below ?? values[k]!;
      }
    }
    i = j;
  }
  return out;
}
