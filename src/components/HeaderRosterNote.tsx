import { Search } from "lucide-react";

/** Compact league roster / category reminder under the hero. */
export function HeaderRosterNote() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-sm text-cyan-100/90">
      <Search className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
      <p>
        Roster: 2C · 2LW · 2RW · 4D · 2G daily. Skater cats: G, A, SOG, BLK,
        HIT, PPP, PIM, FOW. Goalie cats: W, SO, SV, SV%.
      </p>
    </div>
  );
}
