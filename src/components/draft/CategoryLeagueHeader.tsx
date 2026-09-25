import { SnakeDisclaimerShort } from "@/components/snake/SnakeDisclaimer";
import type { DraftBoard } from "@/lib/draft/board-types";
import { CATEGORY_FR, CATEGORY_SHORT, formatDateFr, formatDraftStartFr } from "@/lib/draft/draft-copy";

const MONTH_SHORT: Record<string, string> = {
  janvier: "janv.",
  février: "févr.",
  mars: "mars",
  avril: "avr.",
  mai: "mai",
  juin: "juin",
  juillet: "juill.",
  août: "août",
  septembre: "sept.",
  octobre: "oct.",
  novembre: "nov.",
  décembre: "déc.",
};

/** « dim. 27 sept., 14 h (HAE) » from the league's own wall-clock string. */
function shortDraftStart(iso: string): string {
  const full = formatDraftStartFr(iso); // "dimanche 27 septembre 2026, 14 h (HAE)"
  const m = /^(\p{L}+) (\d+) (\p{L}+) \d{4}, (.+)$/u.exec(full);
  if (!m) return full;
  const [, day, date, month, time] = m;
  return `${day.slice(0, 3)}. ${date} ${MONTH_SHORT[month] ?? month}, ${time}`;
}

/**
 * The Yahoo categories block of the league header: categories (Yahoo's
 * codes, French names for assistive tech), the draft, the data dates. On
 * phones one line, the rest in « Détails de la ligue », so the draft board
 * stays near the top.
 */
export function CategoryLeagueHeader({ board }: { board: DraftBoard }) {
  const cats = [...board.categories.skater, ...board.categories.goalie];
  const l = board.league;
  const details = (
    <>
      <p className="text-sm text-slate-300">
        Têtes-à-têtes par catégories :{" "}
        {cats.map((c, i) => (
          <span key={c}>
            <abbr title={CATEGORY_FR[c]} className="no-underline">
              {CATEGORY_SHORT[c]}
            </abbr>
            {i < cats.length - 1 ? ", " : ""}
          </span>
        ))}
        {" · "}repêchage serpent de {l.rounds} rondes le{" "}
        <time dateTime={l.draftStartsAt} className="text-slate-100">
          {formatDraftStartFr(l.draftStartsAt)}
        </time>{" "}
        · {l.pickSeconds}
        {" "}s par choix
      </p>
      <p className="text-xs text-slate-400">
        Projections du {formatDateFr(board.source.projectionsGeneratedAt)} · ADP Fantrax du{" "}
        {formatDateFr(board.source.adpFetchedAt)} (proxy) · aucune donnée privée de la ligue
      </p>
      <SnakeDisclaimerShort className="max-w-3xl" />
    </>
  );
  return (
    <div>
      <div className="hidden flex-col gap-2 sm:flex">{details}</div>
      <div className="sm:hidden">
        <p className="text-sm text-slate-300">
          Repêchage <time dateTime={l.draftStartsAt}>{shortDraftStart(l.draftStartsAt)}</time> · {l.rounds} rondes ·{" "}
          {l.pickSeconds}
          {" "}s par choix
        </p>
        <details className="mt-1 text-sm">
          <summary className="inline-flex min-h-11 cursor-pointer select-none items-center rounded-md font-medium text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
            Détails de la ligue
          </summary>
          <div className="mt-1 flex flex-col gap-2">{details}</div>
        </details>
      </div>
    </div>
  );
}
