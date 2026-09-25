/**
 * Deterministic RNG for the dynasty simulation: FNV-1a string hash seeding
 * mulberry32, plus a Box-Muller normal. Same seed → same stream on every
 * machine, so a rebuild with unchanged inputs gives the same dynasty.json.
 */

export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface Rng {
  /** Uniform on [0, 1). */
  u(): number;
  /** Standard normal. */
  n(): number;
}

export function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  const u = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = () => {
    let a = 0;
    let b = 0;
    while (!a) a = u();
    while (!b) b = u();
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
  };
  return { u, n };
}

export const rngFor = (key: string): Rng => mulberry32(hashStr(key));

export const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
export const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/** Linear-interpolated quantile of a sample (sorts a copy). */
export function quantile(sample: ArrayLike<number>, p: number): number {
  const n = sample.length;
  if (!n) return 0;
  const s = Float64Array.from(sample).sort();
  const i = p * (n - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}

/** Quantiles of an already sorted sample. */
export function sortedQuantile(s: ArrayLike<number>, p: number): number {
  const n = s.length;
  if (!n) return 0;
  const i = p * (n - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}

export function mean(a: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]!;
  return a.length ? s / a.length : 0;
}
