import { Users } from "lucide-react";
import type { DraftBoard } from "@/lib/draft/board-types";
import {
  CATEGORY_FR,
  CATEGORY_SHORT,
  SLOT_FR,
  formatSignedFr,
  formatStat,
} from "@/lib/draft/draft-copy";
import type { CategoryStrength, MyLineup } from "@/lib/draft/team";
import { filledStarterCount, startingSeatCount } from "@/lib/draft/team";
import { STARTING_SLOTS, type LeagueCategory } from "@/lib/leagues/types";

interface DraftMyTeamProps {
  board: DraftBoard;
  lineup: MyLineup;
  strength: CategoryStrength[];
  targets: LeagueCategory[];
  myPicks: number[];
  currentPick: number;
}

/** Half-width of a strength bar in z (a full bar = 4 z ahead/behind). */
const STRENGTH_BOUND = 4;
const STRENGTH_MIN = -STRENGTH_BOUND;

export function DraftMyTeam({ board, lineup, strength, targets, myPicks, currentPick }: DraftMyTeamProps) {
  const seats = startingSeatCount(board);
  const filled = filledStarterCount(lineup);
  const benchSeats = board.league.roster.BN ?? 0;
  return (
    <section aria-labelledby="draft-team-heading" className="rounded-2xl border border-white/10 bg-white/5 p-3 sm:p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2
          id="draft-team-heading"
          className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-200"
        >
          <Users className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          Mon équipe
        </h2>
        <p className="text-xs text-slate-400">
          Alignement {filled}/{seats} · banc {lineup.bench.length}/{benchSeats}
        </p>
      </div>

      {myPicks.length > 0 ? (
        <p className="mb-3 text-xs leading-relaxed text-slate-400">
          Mes choix :{" "}
          {myPicks.map((n, i) => (
            <span
              key={n}
              className={n < currentPick ? "text-slate-600 line-through" : n === currentPick ? "font-bold text-amber-300" : "text-slate-300"}
            >
              {n}
              {i < myPicks.length - 1 ? ", " : ""}
            </span>
          ))}
        </p>
      ) : null}

      <dl className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-sm">
        {STARTING_SLOTS.filter((s) => (board.league.roster[s] ?? 0) > 0).map((slot) => {
          const count = board.league.roster[slot];
          const seated = lineup.starters[slot];
          return (
            <div key={slot} className="contents">
              <dt className="pt-1 text-xs font-semibold text-slate-400">
                {SLOT_FR[slot]}
                {count > 1 ? <span className="text-slate-600"> ×{count}</span> : null}
              </dt>
              <dd className="flex min-w-0 flex-wrap gap-1">
                {Array.from({ length: count }, (_, i) => {
                  const p = seated[i];
                  return p ? (
                    <span
                      key={p.id}
                      className="max-w-full truncate rounded-md bg-cyan-500/15 px-2 py-0.5 text-xs text-cyan-100"
                      title={`${p.name} (${p.pos.join("/")})`}
                    >
                      {p.name}
                    </span>
                  ) : (
                    <span
                      key={`empty-${i}`}
                      className="rounded-md border border-dashed border-white/15 px-2 py-0.5 text-xs text-slate-600"
                    >
                      vide
                    </span>
                  );
                })}
              </dd>
            </div>
          );
        })}
        <div className="contents">
          <dt className="pt-1 text-xs font-semibold text-slate-400">
            {SLOT_FR.BN}
            <span className="text-slate-600"> ×{benchSeats}</span>
          </dt>
          <dd className="flex min-w-0 flex-wrap gap-1">
            {Array.from({ length: benchSeats }, (_, i) => {
              const p = lineup.bench[i];
              return p ? (
                <span
                  key={p.id}
                  className="max-w-full truncate rounded-md bg-white/10 px-2 py-0.5 text-xs text-slate-200"
                  title={`${p.name} (${p.pos.join("/")})`}
                >
                  {p.name} <span className="text-slate-500">{p.pos.join("/")}</span>
                </span>
              ) : (
                <span
                  key={`bn-${i}`}
                  className="rounded-md border border-dashed border-white/15 px-2 py-0.5 text-xs text-slate-600"
                >
                  vide
                </span>
              );
            })}
          </dd>
        </div>
      </dl>
      {lineup.overflow.length > 0 ? (
        <p className="mt-2 text-xs text-amber-200">
          Hors alignement (IR+/NA ou à libérer) : {lineup.overflow.map((p) => p.name).join(", ")}
        </p>
      ) : null}

      <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Force par catégorie vs équipe moyenne
      </h3>
      <p className="mb-2 text-[11px] leading-snug text-slate-500">
        Postes vides comptés comme un partant moyen de la ligue : les barres montrent ce que vos choix changent.
      </p>
      <ul className="space-y-1">
        {strength.map((s) => {
          const share = Math.min(1, Math.abs(s.diff) / STRENGTH_BOUND) * 50;
          const good = s.diff >= 0;
          return (
            <li key={s.cat} className="grid grid-cols-[2.5rem_minmax(0,1fr)_6.5rem] items-center gap-2 text-xs">
              <span className="font-semibold text-slate-300" title={CATEGORY_FR[s.cat]}>
                {CATEGORY_SHORT[s.cat]}
              </span>
              <span
                className="relative block h-2.5 rounded-full bg-white/5"
                role="meter"
                aria-label={`${CATEGORY_FR[s.cat]} : écart avec l’équipe moyenne`}
                aria-valuemin={STRENGTH_MIN}
                aria-valuemax={STRENGTH_BOUND}
                aria-valuenow={Math.max(-STRENGTH_BOUND, Math.min(STRENGTH_BOUND, Number(s.diff.toFixed(2))))}
                aria-valuetext={`${formatSignedFr(s.diff)} z`}
              >
                <span className="absolute inset-y-0 left-1/2 w-px bg-white/25" aria-hidden="true" />
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 rounded-full ${good ? "bg-cyan-400" : "bg-rose-400"}`}
                  style={good ? { left: "50%", width: `${share}%` } : { right: "50%", width: `${share}%` }}
                />
              </span>
              <span className="text-right tabular-nums text-slate-400" title="Projection : mon équipe / équipe moyenne">
                <span className={good ? "text-cyan-200" : "text-rose-200"}>{formatStat(s.cat, s.mineTotal)}</span>
                {" / "}
                {formatStat(s.cat, s.averageTotal)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-slate-300">
        {targets.length > 0 ? (
          <>
            <span className="font-semibold text-amber-200">À cibler :</span>{" "}
            {targets.map((c) => CATEGORY_FR[c]).join(", ")}
          </>
        ) : (
          <span className="text-slate-400">Aucune catégorie en retard pour l’instant.</span>
        )}
      </p>
    </section>
  );
}
