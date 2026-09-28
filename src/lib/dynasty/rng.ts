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

/** Standard normal quantile (Acklam's rational approximation, relative error < 1.2e-9), p clamped to (1e-12, 1 − 1e-12). */
export function normalQuantile(p: number): number {
  const q0 = clamp(p, 1e-12, 1 - 1e-12);
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const tail = (q: number) =>
    (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  if (q0 < 0.02425) return tail(Math.sqrt(-2 * Math.log(q0)));
  if (q0 > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - q0)));
  const q = q0 - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}
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
