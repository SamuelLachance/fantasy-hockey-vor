/**
 * `98,4 M$` (one decimal from 10 M$, two below). Built by hand like the other
 * numbers of league-copy.ts: the page hydrates in whatever browser opens it.
 * Its own module so the cap league's words (cap-league-copy.ts, loaded with
 * that league's shell) do not pull the rest of salary-copy.ts along.
 */
const NBSP = " ";
const MINUS = "−";

export function fmtMoney(m: number): string {
  const abs = Math.abs(m);
  const d = abs >= 10 ? 1 : 2;
  // Round half up first: 0.975.toFixed(2) is "0.97" in binary floating point.
  const s = (Math.round(abs * 10 ** d) / 10 ** d).toFixed(d).replace(".", ",");
  return `${m < 0 ? MINUS : ""}${s}${NBSP}M$`;
}
