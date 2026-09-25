import type { Position } from "@/lib/types";

/** Position badge colors (the draft board's position chips). */
export const POSITION_COLORS: Record<Position, string> = {
  C: "bg-cyan-500/20 text-cyan-300 ring-cyan-500/30",
  LW: "bg-sky-500/20 text-sky-300 ring-sky-500/30",
  RW: "bg-blue-500/20 text-blue-300 ring-blue-500/30",
  D: "bg-indigo-500/20 text-indigo-300 ring-indigo-500/30",
  G: "bg-violet-500/20 text-violet-300 ring-violet-500/30",
};
