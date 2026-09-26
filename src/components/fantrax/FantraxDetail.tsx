"use client";

import { SnakeDetail } from "@/components/player-table/SnakeDetail";
import { NBSP } from "@/lib/dynasty/keeper-view";
import { dynastyHintText } from "@/lib/fantrax/dynasty-hint-text";
import { hintSide } from "@/lib/fantrax/dynasty-hints";
import { fmtCalendarDay, fmtNum } from "@/lib/fantrax/league-copy";
import type { FantraxCtx, FantraxRow } from "@/lib/fantrax/table";
import { iconDetails, nhlDraftLabel, sourceLabel } from "@/lib/fantrax/table-copy";
import { DynastyDetail } from "./DynastyDetail";

/**
 * A Captains table's details row: facts (birth, NHL draft, minors, flags),
 * the dynasty block (the model's sentence, six seasons, the « Conseil » from
 * the page's team's side), then Snake's take. Its own chunk, loaded when a
 * row opens (with the sentence builder), not with the tab.
 */
export function FantraxDetail({ row, ctx, idPrefix }: { row: FantraxRow; ctx: FantraxCtx; idPrefix: string }) {
  const icons = iconDetails(row.icons);
  const items: Array<[string, string]> = [["Type", sourceLabel(row.src)]];
  if (row.birthDate) {
    items.push(["Naissance", `${fmtCalendarDay(row.birthDate).replace(/^\S+ /, "")} ${row.birthDate.slice(0, 4)}`]);
  }
  items.push(
    ["Repêchage LNH", row.nhlDraft ? nhlDraftLabel(row.nhlDraft) : "non repêché ou inconnu"],
    ["Mineures", row.minorsEligible ? "admissible aux postes des mineures de la ligue" : "non admissible"],
  );
  if (row.gp !== null) items.push(["Matchs projetés", fmtNum(row.gp, 0)]);
  if (icons.length) items.push(["Fantrax", icons.join(", ")]);
  const s = row.snake;
  return (
    <>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {items.map(([k, v]) => (
          <div key={k} className="flex min-w-0 gap-2">
            <dt className="shrink-0 text-slate-400">{`${k}${NBSP}:`}</dt>
            <dd className="min-w-0 text-slate-200">{v}</dd>
          </div>
        ))}
      </dl>
      {row.dynasty || row.dynZero ? (
        <DynastyDetail
          d={row.dynasty}
          zero={row.dynZero}
          hint={row.dynasty ? dynastyHintText(row.dynasty, hintSide(row.owner, ctx.teamId)) : null}
          mode={ctx.mode}
          idPrefix={idPrefix}
        />
      ) : ctx.dynastyIn ? (
        <p className="mt-3 border-t border-white/10 pt-3 text-slate-300">
          {`Valeur dynastie${NBSP}: non évaluée (joueur absent des données du modèle).`}
        </p>
      ) : null}
      {s ? <SnakeDetail snakeKey={s.key} verdict={s.verdict} trend={s.trend} probable={s.probable} idPrefix={idPrefix} /> : null}
    </>
  );
}
