import { SNAKE_TRIMMED_NOTE, formatSnakeDate, plural, snakeDerivedNote } from "@/lib/snake/copy";
import type { SnakeRow } from "@/lib/snake/types";
import { SnakeProbableMark, SnakeTrendBadge, SnakeVerdictChip } from "./SnakeBadges";

function Bullets({ label, items, tone }: { label: string; items: string[]; tone: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <dt className={`text-xs font-semibold uppercase tracking-wider ${tone}`}>{label}</dt>
      <dd className="mt-1">
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-300 marker:text-slate-600">
          {items.map((it) => (
            <li key={it}>{it}</li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

/** Snake's synthesis for one player (verdict, trend, projection, strengths…). */
export function SnakeSynthesisCard({ row }: { row: SnakeRow }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <SnakeVerdictChip verdict={row.v} prefix="Verdict" />
        <SnakeTrendBadge trend={row.td} />
        {row.pr ? <SnakeProbableMark /> : null}
      </div>
      {row.dv ? (
        <p className="mt-3 text-xs text-amber-200/90">{snakeDerivedNote(row.sd, !!row.pr)}</p>
      ) : row.tr ? (
        <p className="mt-3 text-xs text-slate-400">{SNAKE_TRIMMED_NOTE}</p>
      ) : null}
      <p className="mt-3 text-base leading-relaxed text-slate-100">{row.s}</p>
      {row.pj ? (
        <p className="mt-3 text-sm text-slate-300">
          <span className="font-semibold text-violet-200">Projection :</span> {row.pj}
        </p>
      ) : null}
      {row.f.length + row.w.length + row.c.length > 0 ? (
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <Bullets label="Forces" items={row.f} tone="text-emerald-300" />
          <Bullets label="Faiblesses" items={row.w} tone="text-rose-300" />
          <Bullets label="Comparables" items={row.c} tone="text-sky-300" />
        </dl>
      ) : null}
      {row.x ? (
        <p className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-3 text-sm text-slate-300">
          <span className="font-semibold text-amber-200">Nuances et contradictions :</span> {row.x}
        </p>
      ) : null}
      <p className="mt-4 text-xs text-slate-400">
        {plural(row.oc, "opinion publiée", "opinions publiées")} dans {plural(row.vc, "vidéo", "vidéos")}, du{" "}
        <time dateTime={row.fs}>{formatSnakeDate(row.fs)}</time> au{" "}
        <time dateTime={row.ls}>{formatSnakeDate(row.ls)}</time>
        {row.pc > 0 && !row.pr ? `, dont ${plural(row.pc, "à l'attribution probable", "à l'attribution probable")}` : ""}.
      </p>
    </div>
  );
}
