import { ChevronLeft, ChevronRight } from "lucide-react";
import { TABLE_COPY } from "@/lib/player-table/copy";

const PAGER_BUTTON =
  "inline-flex min-h-11 items-center gap-1 rounded-xl border border-white/15 bg-white/5 px-3 font-medium hover:border-cyan-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:border-white/15";

/** « Précédente · Page n sur N · Suivante » and the page size. */
export function PlayerTablePager({
  page,
  pages,
  perPage,
  perPageOptions,
  onPage,
  onPerPage,
}: {
  page: number;
  pages: number;
  perPage: number;
  perPageOptions: readonly number[];
  onPage: (n: number) => void;
  onPerPage: (n: number) => void;
}) {
  return (
    <nav aria-label={TABLE_COPY.pages} className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
      <div className="flex items-center gap-2">
        {/* aria-disabled, not disabled: a disabled button drops the
            keyboard focus to <body> on the first or last page. */}
        <button
          type="button"
          onClick={() => {
            if (page > 1) onPage(page - 1);
          }}
          aria-disabled={page <= 1 || undefined}
          className={PAGER_BUTTON}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {TABLE_COPY.previous}
        </button>
        <span className="tabular-nums text-slate-400">
          Page {page} sur {pages}
        </span>
        <button
          type="button"
          onClick={() => {
            if (page < pages) onPage(page + 1);
          }}
          aria-disabled={page >= pages || undefined}
          className={PAGER_BUTTON}
        >
          {TABLE_COPY.next}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <label className="flex items-center gap-2 text-slate-400">
        {TABLE_COPY.perPage}
        <select
          value={perPage}
          onChange={(e) => onPerPage(Number(e.target.value))}
          className="min-h-11 rounded-xl border border-white/15 bg-slate-900 px-3 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          {perPageOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}
