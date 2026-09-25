/**
 * « Conseil » column of the Captains player table: a rough keep / trade
 * hint from the dynasty value and career phase. Dormant until a pipeline
 * publishes `public/fantrax/dynasty.json` (the column needs both fields).
 * Percentiles are over the players rostered in the league.
 */
export type DynastyHint = "Pilier" | "Vendre haut" | "Espoir à protéger" | "Remplaçable" | "À garder";

interface HintInput {
  id: string;
  owner: string | null;
  dynasty: { value?: number; phase?: string; pNhl?: number } | null;
}

const LATE = new Set(["déclin", "fin de carrière"]);
const YOUNG = new Set(["espoir", "en ascension"]);

/** Value at quantile q (0..1) of sorted values, linear between ranks. */
export function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * One hint per player with dynasty data (in this order: the first rule
 * that fits wins):
 * - « Pilier »: value ≥ p80;
 * - « Vendre haut »: in decline or late career, value ≥ p50;
 * - « Espoir à protéger »: prospect or rising, P(NHL) ≥ 50 %;
 * - « Remplaçable »: value < p25, not a prospect or rising;
 * - otherwise « À garder » (players with a value).
 */
export function dynastyHints(rows: readonly HintInput[]): Map<string, DynastyHint> {
  const values = rows
    .filter((r) => r.owner !== null && r.dynasty?.value !== undefined)
    .map((r) => r.dynasty!.value!)
    .sort((a, b) => a - b);
  const p25 = quantile(values, 0.25);
  const p50 = quantile(values, 0.5);
  const p80 = quantile(values, 0.8);
  const out = new Map<string, DynastyHint>();
  for (const r of rows) {
    const d = r.dynasty;
    if (!d) continue;
    const v = d.value;
    const phase = d.phase ?? "";
    let hint: DynastyHint | null = null;
    if (v !== undefined && p80 !== null && v >= p80) hint = "Pilier";
    else if (v !== undefined && p50 !== null && LATE.has(phase) && v >= p50) hint = "Vendre haut";
    else if (YOUNG.has(phase) && (d.pNhl ?? 0) >= 0.5) hint = "Espoir à protéger";
    else if (v !== undefined && p25 !== null && v < p25 && !YOUNG.has(phase)) hint = "Remplaçable";
    else if (v !== undefined) hint = "À garder";
    if (hint) out.set(r.id, hint);
  }
  return out;
}
