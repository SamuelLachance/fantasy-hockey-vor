import { ExternalLink } from "lucide-react";
import { formatSnakeDate, rankOrdinal } from "@/lib/snake/copy";
import type { SnakeOpinion, SnakeVideoRef } from "@/lib/snake/types";
import { formatClock, youtubeHref } from "@/lib/snake/url";
import { SnakeProbableMark, SnakeVerdictChip } from "./SnakeBadges";

function InlineList({ label, items, tone }: { label: string; items: string[]; tone: string }) {
  if (items.length === 0) return null;
  return (
    <p className="text-xs text-slate-400">
      <span className={`font-semibold ${tone}`}>{label} :</span> {items.join(" · ")}
    </p>
  );
}

/** One dated opinion of the timeline, linked to the video at the passage. */
export function SnakeOpinionItem({
  opinion: o,
  video,
  headingLevel = 3,
  headingId,
}: {
  opinion: SnakeOpinion;
  video: SnakeVideoRef | undefined;
  headingLevel?: 3 | 4;
  /** Focus target after "Afficher … de plus" (programmatic focus only). */
  headingId?: string;
}) {
  const show = video?.[1] ?? "Émission inconnue";
  const title = video?.[2] ?? "";
  const Heading = headingLevel === 3 ? "h3" : "h4";
  return (
    <article className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
      <Heading id={headingId} tabIndex={headingId ? -1 : undefined} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80">
        <time dateTime={o.d} className="font-semibold text-white">
          {formatSnakeDate(o.d)}
        </time>
        <span className="text-slate-400" aria-hidden="true">
          ·
        </span>
        <span className="font-medium text-cyan-200">{show}</span>
      </Heading>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <SnakeVerdictChip verdict={o.st} />
        {o.p ? <SnakeProbableMark /> : null}
      </div>
      {title ? <p className="mt-1.5 break-words text-xs text-slate-400">{title}</p> : null}
      {o.cx ? (
        <p className="mt-2 text-xs text-slate-400">
          <span className="font-semibold text-slate-300">Contexte :</span> {o.cx}
        </p>
      ) : null}
      <p className="mt-2 text-sm leading-relaxed text-slate-200">{o.o}</p>
      {o.pj ? (
        <p className="mt-2 text-xs text-slate-300">
          <span className="font-semibold text-violet-200">Projection :</span> {o.pj}
        </p>
      ) : null}
      <div className="mt-2 space-y-1">
        <InlineList label="Forces" items={o.f} tone="text-emerald-300" />
        <InlineList label="Faiblesses" items={o.w} tone="text-rose-300" />
        <InlineList label="Comparables" items={o.c} tone="text-sky-300" />
        {o.rk.length > 0 ? (
          <p className="text-xs text-slate-400">
            <span className="font-semibold text-amber-200">Rang :</span>{" "}
            {o.rk.map(([rank, list]) => `${rankOrdinal(rank)} — ${list}`).join(" · ")}
          </p>
        ) : null}
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <a
          href={youtubeHref(o.vid, o.t)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 font-semibold text-cyan-200 transition motion-reduce:transition-none hover:border-cyan-400/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
        >
          Écouter à {formatClock(o.t)}
          <span className="sr-only"> sur YouTube (nouvel onglet)</span>
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
        {o.ts && o.ts.length > 0 ? (
          <span className="flex flex-wrap items-center gap-x-2 text-slate-400">
            aussi à
            {o.ts.map((t) => (
              <a
                key={t}
                href={youtubeHref(o.vid, t)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center rounded-sm text-cyan-300/90 underline underline-offset-2 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
              >
                {formatClock(t)}
                <span className="sr-only"> (YouTube, nouvel onglet)</span>
              </a>
            ))}
          </span>
        ) : null}
      </p>
    </article>
  );
}
