import { Search } from "lucide-react";
import { headerRosterCopy, headerRosterNoteLabel } from "@/lib/header-roster-copy";

/** Compact league roster / category reminder under the hero. */
export function HeaderRosterNote() {
  return (
    <div
      className="flex items-start gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-sm text-cyan-100/90"
      role="note"
      aria-label={headerRosterNoteLabel()}
    >
      <Search className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" aria-hidden="true" />
      <p>{headerRosterCopy()}</p>
    </div>
  );
}
