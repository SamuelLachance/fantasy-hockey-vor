"use client";

import { CalendarDays, Plus, Shield, Sparkles, Swords, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { DraftBoard, DraftBoardPlayer } from "@/lib/draft/board-types";
import { myPickIds, pickedIds } from "@/lib/draft/draft-state";
import { getDraftStore } from "@/lib/draft/draft-store";
import { loadLeaguePool } from "@/lib/draft/league-pool-client";
import { leaguePlayers } from "@/lib/draft/league-pool";
import { slotPickIds, toSimGoalie, toSimSkater, toSimTeam } from "@/lib/matchup/board-adapter";
import { addDays, clubsByDate, gamesPerClub, leagueDate, mondayOf, weekDays, type ScheduleGame } from "@/lib/matchup/schedule";
import { baseTotals, simulateWeek, type MatchupCat, type SimDay, type SimResult } from "@/lib/matchup/simulate";
import { goaliePlans, recommendGoaliePlan, scoreCandidate, type GoaliePlan, type SwapResult } from "@/lib/matchup/stream";
import { fantraxDataHref, leagueDataHref } from "@/lib/site";
import { foldSearchText as foldSearch } from "@/lib/search-fold";

const CAT_FR: Record<MatchupCat, string> = {
  G: "Buts",
  A: "Passes",
  PPP: "Points en avantage numérique",
  SOG: "Tirs",
  HIT: "Mises en échec",
  BLK: "Tirs bloqués",
  W: "Victoires",
  GAA: "Moyenne de buts alloués",
  SVP: "% d’arrêts",
  SHO: "Blanchissages",
};
const SIMS = 2000;
const STREAM_SIMS = 600;
const SCHEDULE_FILE = "schedule-20262027.json";
const pct = (x: number) => `${Math.round(x * 100)}${" "}%`;
const fmt1 = (x: number) => (Number.isFinite(x) ? x.toLocaleString("fr-CA", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : "—");
const fmtCat = (c: MatchupCat, x: number) =>
  !Number.isFinite(x) ? "—" : c === "SVP" ? x.toLocaleString("fr-CA", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : c === "GAA" ? x.toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : fmt1(x);
const signedCats = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Saved {
  v: 1;
  /** null = the players marked « Moi » in the draft helper. */
  mine: number[] | null;
  oppSlot: number | null;
  /** The opponent's roster when typed by hand (null = his draft slot's picks). */
  opp: number[] | null;
  out: number[];
  base: { mine: Record<string, number>; theirs: Record<string, number> } | null;
}
const EMPTY: Saved = { v: 1, mine: null, oppSlot: null, opp: null, out: [], base: null };
const key = (slug: string) => `duel:${slug}:v1`;
function readSaved(slug: string): Saved {
  try {
    const raw = window.localStorage.getItem(key(slug));
    const v = raw ? (JSON.parse(raw) as Saved) : null;
    return v && v.v === 1 ? { ...EMPTY, ...v } : EMPTY;
  } catch {
    return EMPTY;
  }
}
function writeSaved(slug: string, s: Saved) {
  try {
    window.localStorage.setItem(key(slug), JSON.stringify(s));
  } catch {
    // private window: the duel lives for this visit only
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Light the Lamp · Duel de la semaine: the user's roster (from the draft
 * helper, editable) against an opponent's (his draft slot's picks, editable),
 * the week simulated game by game (`src/lib/matchup`): odds of each
 * category and of the week, the best free agents to stream, the goalie plan.
 * Yahoo is not readable: rosters and the week's score so far are the user's.
 */
export function DuelTab({ slug }: { slug: string }) {
  const [board, setBoard] = useState<DraftBoard | null>(null);
  const [players, setPlayers] = useState<readonly DraftBoardPlayer[] | null>(null);
  const [games, setGames] = useState<ScheduleGame[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved>(EMPTY);
  const [today, setToday] = useState<string | null>(null);
  const [monday, setMonday] = useState<string | null>(null);
  const [fromToday, setFromToday] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // the browser's own clock and storage (the page is prerendered)
    const t = leagueDate(Date.now());
    Promise.resolve().then(() => {
      if (cancelled) return;
      setSaved(readSaved(slug));
      setToday(t);
      setMonday(mondayOf(t));
    });
    getJson<DraftBoard>(leagueDataHref(slug, "board.json"))
      .then((b) => {
        if (cancelled) return;
        setBoard(b);
        return loadLeaguePool(slug).then(
          (pool) => !cancelled && setPlayers(leaguePlayers(b, pool)),
          () => !cancelled && setPlayers(b.players),
        );
      })
      .catch(() => !cancelled && setErr("La liste des joueurs n’a pas pu être lue."));
    getJson<{ games: ScheduleGame[] }>(fantraxDataHref(SCHEDULE_FILE)).then(
      (s) => !cancelled && setGames(s.games),
      () => !cancelled && setErr("Le calendrier de la LNH n’a pas pu être lu."),
    );
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const update = (f: (s: Saved) => Saved) =>
    setSaved((s) => {
      const n = f(s);
      writeSaved(slug, n);
      return n;
    });

  const teams = board?.league.teams ?? 12;
  const store = getDraftStore(slug, teams);
  const draft = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const byId = useMemo(() => new Map((players ?? []).map((p) => [p.id, p])), [players]);
  const myIds = saved.mine ?? myPickIds(draft);
  const oppIds = saved.opp ?? (saved.oppSlot ? slotPickIds(draft, saved.oppSlot, teams) : []);
  const mine = myIds.map((id) => byId.get(id)).filter((p): p is DraftBoardPlayer => p != null);
  const theirs = oppIds.map((id) => byId.get(id)).filter((p): p is DraftBoardPlayer => p != null);
  const out = useMemo(() => new Set(saved.out), [saved.out]);

  const days: SimDay[] | null = useMemo(() => {
    if (!games || !monday || !today) return null;
    const by = clubsByDate(games);
    const from = fromToday && today > monday && today <= addDays(monday, 6) ? today : monday;
    return weekDays(by, from, addDays(monday, 6));
  }, [games, monday, today, fromToday]);

  const inputs = useMemo(() => {
    if (!days) return null;
    const a = toSimTeam(mine, out);
    const b = toSimTeam(theirs, out);
    const base = saved.base;
    const num = (r: Record<string, number> | undefined, k: string) => Number(r?.[k] ?? 0) || 0;
    const tot = (r: Record<string, number> | undefined) =>
      baseTotals({
        G: num(r, "G"), A: num(r, "A"), PPP: num(r, "PPP"), SOG: num(r, "SOG"), HIT: num(r, "HIT"), BLK: num(r, "BLK"),
        W: num(r, "W"), SHO: num(r, "SHO"), apps: num(r, "apps"), gaa: num(r, "GAA"), svp: num(r, "SVP"),
      });
    if (base && fromToday) {
      a.base = tot(base.mine);
      b.base = tot(base.theirs);
    }
    return { a, b };
  }, [days, mine, theirs, out, saved.base, fromToday]);

  // the week's simulation, off the first paint
  const [result, setResult] = useState<{ sig: string; r: SimResult; plans: GoaliePlan[] } | null>(null);
  const sig = inputs && days ? JSON.stringify([days.map((d) => d.date), myIds, oppIds, saved.out, saved.base, fromToday]) : "";
  useEffect(() => {
    if (!inputs || !days || !inputs.a.skaters.length || !inputs.b.skaters.length) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      const r = simulateWeek(inputs.a, inputs.b, days, { sims: SIMS, seed: sig });
      const plans = goaliePlans(inputs.a, inputs.b, days, { sims: STREAM_SIMS, seed: sig });
      if (!cancelled) setResult({ sig, r, plans });
    }, 20);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [inputs, days, sig]);

  // streaming: undrafted players with a game left, best value first, scored one by one
  const [stream, setStream] = useState<{ sig: string; done: number; total: number; list: SwapResult[] } | null>(null);
  useEffect(() => {
    if (!inputs || !days || !players || !inputs.a.skaters.length || !inputs.b.skaters.length) return;
    const taken = new Set([...pickedIds(draft), ...myIds, ...oppIds]);
    const per = gamesPerClub(days);
    const cands = players
      .filter((p) => !taken.has(p.id) && !out.has(p.id) && (per.get(p.team) ?? 0) > 0)
      .map((p) => ({ p, s: toSimSkater(p), g: toSimGoalie(p) }))
      .filter((x) => x.s || x.g)
      .sort((x, y) => y.p.value - x.p.value)
      .slice(0, 24);
    let cancelled = false;
    let i = 0;
    const list: SwapResult[] = [];
    const base = simulateWeek(inputs.a, inputs.b, days, { sims: STREAM_SIMS, seed: sig });
    const step = () => {
      if (cancelled) return;
      const c = cands[i];
      if (!c) return;
      const add = c.s ? ({ kind: "skater", p: c.s } as const) : ({ kind: "goalie", p: c.g! } as const);
      const r = scoreCandidate(inputs.a, inputs.b, days, add, base, { sims: STREAM_SIMS, seed: sig, drops: 2 });
      if (r) list.push(r);
      i++;
      setStream({ sig, done: i, total: cands.length, list: [...list].sort((x, y) => y.dExpCats - x.dExpCats) });
      window.setTimeout(step, 0);
    };
    const id = window.setTimeout(step, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sig` stands for the inputs
  }, [sig, players]);

  if (err) return <p className="text-sm text-rose-200">{err} Actualisez la page pour réessayer.</p>;
  if (!board || !players || !days || !monday) return <p className="text-sm text-slate-400">Chargement des joueurs et du calendrier…</p>;

  const current = result?.sig === sig ? result : null;
  const per = gamesPerClub(days);
  const plan = current ? recommendGoaliePlan(current.plans) : null;

  return (
    <div className="grid gap-6">
      <section aria-labelledby="duel-semaine" className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-4 sm:p-6">
        <h2 id="duel-semaine" className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
          <CalendarDays className="h-5 w-5 text-violet-300" aria-hidden="true" />
          La semaine
        </h2>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-slate-400">Semaine du lundi</span>
            <input
              type="date"
              value={monday}
              onChange={(e) => e.target.value && setMonday(mondayOf(e.target.value))}
              className="min-h-11 rounded-md border border-white/10 bg-slate-900 px-2 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            />
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={fromToday} onChange={(e) => setFromToday(e.target.checked)} className="h-4 w-4 accent-violet-400" />
            <span className="text-slate-300">Seulement les jours qui restent (à partir d’aujourd’hui)</span>
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {days.length} jour{days.length > 1 ? "s" : ""} simulé{days.length > 1 ? "s" : ""} ({days[0]?.date} au {days[days.length - 1]?.date}),{" "}
          {days.reduce((s, d) => s + d.teams.size / 2, 0)} matchs de la LNH. Yahoo ne peut pas être lu : les effectifs et le score déjà acquis sont les vôtres.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <RosterCard
          title="Mon équipe"
          note={saved.mine ? "Effectif saisi à la main." : "Vos choix marqués « Moi » dans l’onglet Repêchage."}
          roster={mine}
          per={per}
          out={out}
          all={players}
          onToggleOut={(id) => update((s) => ({ ...s, out: s.out.includes(id) ? s.out.filter((x) => x !== id) : [...s.out, id] }))}
          onRemove={(id) => update((s) => ({ ...s, mine: (s.mine ?? myIds).filter((x) => x !== id) }))}
          onAdd={(id) => update((s) => ({ ...s, mine: [...(s.mine ?? myIds).filter((x) => x !== id), id] }))}
          onReset={saved.mine ? () => update((s) => ({ ...s, mine: null })) : null}
        />
        <RosterCard
          title="Adversaire"
          note={saved.opp ? "Effectif saisi à la main." : saved.oppSlot ? `Les choix de la position ${saved.oppSlot} au repêchage.` : "Choisissez sa position au repêchage, ou ajoutez ses joueurs."}
          roster={theirs}
          per={per}
          out={out}
          all={players}
          onToggleOut={(id) => update((s) => ({ ...s, out: s.out.includes(id) ? s.out.filter((x) => x !== id) : [...s.out, id] }))}
          onRemove={(id) => update((s) => ({ ...s, opp: (s.opp ?? oppIds).filter((x) => x !== id) }))}
          onAdd={(id) => update((s) => ({ ...s, opp: [...(s.opp ?? oppIds).filter((x) => x !== id), id] }))}
          onReset={saved.opp ? () => update((s) => ({ ...s, opp: null })) : null}
          extra={
            <label className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">Position au repêchage</span>
              <select
                value={saved.oppSlot ?? ""}
                onChange={(e) => update((s) => ({ ...s, oppSlot: e.target.value ? Number(e.target.value) : null, opp: null }))}
                className="min-h-11 rounded-md border border-white/10 bg-slate-900 px-2 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                <option value="">—</option>
                {Array.from({ length: teams }, (_, i) => i + 1)
                  .filter((n) => n !== draft.slot)
                  .map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
              </select>
            </label>
          }
        />
      </div>

      <ScoreSoFar saved={saved} update={update} enabled={fromToday} />

      <section aria-labelledby="duel-odds" className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-4 sm:p-6">
        <h2 id="duel-odds" className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
          <Swords className="h-5 w-5 text-violet-300" aria-hidden="true" />
          Chances, catégorie par catégorie
        </h2>
        {!mine.length || !theirs.length ? (
          <p className="text-sm text-slate-400">Il faut les deux effectifs pour simuler le duel.</p>
        ) : !current ? (
          <p className="text-sm text-slate-400">Simulation de {SIMS.toLocaleString("fr-CA")} semaines…</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-300">
              <span className="text-2xl font-semibold text-white">{pct(current.r.win + current.r.tie / 2)}</span> de chances de gagner la semaine (nulle
              comptée à moitié) · {fmt1(current.r.expCats)} catégories gagnées en moyenne sur 10 · apparitions de gardien : {fmt1(current.r.apps.mine)} contre{" "}
              {fmt1(current.r.apps.theirs)} (minimum de 4 atteint : {pct(current.r.apps.pMinMine)}).
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <caption className="sr-only">Probabilité de gagner chaque catégorie et totaux attendus</caption>
                <thead>
                  <tr className="text-xs text-slate-400">
                    <th scope="col" className="py-1 pr-2 text-left font-medium">Catégorie</th>
                    <th scope="col" className="py-1 pr-2 text-right font-medium">Moi</th>
                    <th scope="col" className="py-1 pr-2 text-right font-medium">Adversaire</th>
                    <th scope="col" className="py-1 text-left font-medium">Chances de gagner</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {current.r.cats.map((c) => (
                    <tr key={c.cat} className="border-t border-white/5">
                      <th scope="row" className="py-1 pr-2 text-left font-normal text-slate-200">{CAT_FR[c.cat]}</th>
                      <td className="py-1 pr-2 text-right text-white">{fmtCat(c.cat, c.mine)}</td>
                      <td className="py-1 pr-2 text-right text-slate-300">{fmtCat(c.cat, c.theirs)}</td>
                      <td className="py-1">
                        <span className="flex items-center gap-2">
                          <span className="flex h-2 w-28 overflow-hidden rounded-full bg-rose-500/40" aria-hidden="true">
                            <span className="h-full bg-emerald-400" style={{ width: `${c.win * 100}%` }} />
                            <span className="h-full bg-slate-400" style={{ width: `${c.tie * 100}%` }} />
                          </span>
                          <span className="text-xs text-slate-200">
                            {pct(c.win)}
                            {c.tie >= 0.03 ? ` (nulle ${pct(c.tie)})` : ""}
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Fiabilité : sur 1 272 duels rejoués de 2024-25 et 2025-26 (ligues fictives de 12 équipes repêchées à partir des projections Marcel, pas
              les données de Light the Lamp), les catégories annoncées autour de 75 % ont été gagnées 73 % du temps, et celles annoncées
              autour de 25 %, 29 % du temps.
            </p>
          </>
        )}
      </section>

      {current && plan ? (
        <section aria-labelledby="duel-gardiens" className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-4 sm:p-6">
          <h2 id="duel-gardiens" className="mb-2 flex items-center gap-2 text-lg font-semibold text-white">
            <Shield className="h-5 w-5 text-violet-300" aria-hidden="true" />
            Plan des gardiens
          </h2>
          <p className="mb-2 text-sm text-slate-300">
            {plan.cap === Infinity
              ? "Alignez tous vos gardiens qui commencent : arrêter plus tôt pour protéger la moyenne et le % d’arrêts ne rapporte rien de plus cette semaine."
              : `Arrêtez d’aligner vos gardiens après ${plan.cap} apparitions : vous protégez la moyenne et le % d’arrêts (${signedCats(plan.expCats - current.plans.find((p) => p.cap === Infinity)!.expCats)} catégorie en moyenne).`}
          </p>
          <p className="mb-2 text-xs text-slate-400">
            Validation : sur 318 semaines rejouées, arrêter plus tôt n’a pas battu « toujours aligner » de façon significative (au
            mieux +0,003 catégorie par semaine, sans marge de prudence), et l’outil ne l’a
            jamais conseillé. Un conseil d’arrêter tôt n’a donc aucun test derrière lui.
          </p>
          <ul className="grid gap-1 text-xs text-slate-400 sm:grid-cols-2">
            {current.plans.map((p) => (
              <li key={String(p.cap)}>
                {p.cap === Infinity ? "Toujours aligner" : `Arrêter à ${p.cap}`} : {fmt1(p.expCats)} catégories, {fmt1(p.apps)} apparitions, minimum atteint {pct(p.pMin)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {current ? (
        <section aria-labelledby="duel-ajouts" className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-4 sm:p-6">
          <h2 id="duel-ajouts" className="mb-2 flex items-center gap-2 text-lg font-semibold text-white">
            <Sparkles className="h-5 w-5 text-emerald-300" aria-hidden="true" />
            Ajouts pour la semaine
          </h2>
          <p className="mb-3 text-xs text-slate-400">
            Les joueurs que personne n’a repêchés (d’après l’onglet Repêchage), ajoutés à la place de votre joueur le moins utile de la même sorte, chaque semaine
            re-simulée avec les mêmes tirages : le gain en catégories gagnées tient compte des matchs qu’il lui reste, de la place qu’il aurait dans
            l’alignement et des catégories serrées. Sur deux saisons rejouées (mêmes ligues fictives), ce choix a rapporté 0,17 catégorie de plus
            par semaine que le meilleur autonome au classement, mais pas mieux, de façon significative, que de prendre l’autonome qui a le plus de matchs parmi les 10 meilleurs (+0,07 catégorie, intervalle de −0,01 à +0,14).
          </p>
          {stream?.sig === sig ? (
            <>
              {stream.done < stream.total ? (
                <p className="mb-2 text-xs text-slate-400" role="status">
                  Analyse {stream.done}/{stream.total}…
                </p>
              ) : null}
              <ol className="space-y-1 text-sm">
                {stream.list.slice(0, 8).map((s) => (
                  <li key={s.add.p.id} className="flex flex-wrap items-baseline gap-x-3 rounded-lg bg-white/5 px-3 py-1.5">
                    <span className="min-w-0 flex-1 text-white">
                      Ajouter <strong>{s.add.p.name}</strong> <span className="text-xs text-slate-400">({s.add.p.team}, {per.get(s.add.p.team) ?? 0} match{(per.get(s.add.p.team) ?? 0) > 1 ? "s" : ""})</span>
                      <span className="text-slate-400"> · libérer {s.dropName}</span>
                    </span>
                    <span className={`tabular-nums text-xs ${s.dExpCats > 0 ? "text-emerald-300" : "text-slate-400"}`}>
                      {signedCats(s.dExpCats)} catégorie · victoire {signedCats(s.dWin * 100).replace(/,\d+$/, "")} pts de %
                    </span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="text-sm text-slate-400">Analyse des joueurs autonomes…</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

function RosterCard({
  title,
  note,
  roster,
  per,
  out,
  all,
  onToggleOut,
  onRemove,
  onAdd,
  onReset,
  extra,
}: {
  title: string;
  note: string;
  roster: readonly DraftBoardPlayer[];
  per: ReadonlyMap<string, number>;
  out: ReadonlySet<number>;
  all: readonly DraftBoardPlayer[];
  onToggleOut: (id: number) => void;
  onRemove: (id: number) => void;
  onAdd: (id: number) => void;
  onReset: (() => void) | null;
  extra?: React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const fq = foldSearch(q.trim());
  const matches = fq.length >= 2 ? all.filter((p) => !p.noProj && foldSearch(p.name).includes(fq) && !roster.some((r) => r.id === p.id)).slice(0, 6) : [];
  const sorted = [...roster].sort((a, b) => Number(a.pos.includes("G")) - Number(b.pos.includes("G")) || b.value - a.value);
  return (
    <section className="min-w-0 rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-4" aria-label={title}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <Users className="h-5 w-5 text-violet-300" aria-hidden="true" />
          {title}
        </h2>
        {extra}
      </div>
      <p className="mb-2 text-xs text-slate-400">
        {note}
        {onReset ? (
          <button type="button" onClick={onReset} className="ml-2 min-h-11 text-violet-300 underline-offset-2 hover:underline">
            Revenir au repêchage
          </button>
        ) : null}
      </p>
      <ul className="max-h-96 space-y-0.5 overflow-y-auto text-sm">
        {sorted.map((p) => (
          <li key={p.id} className={`flex items-center gap-2 rounded-md px-1 ${out.has(p.id) ? "opacity-50" : ""}`}>
            <span className="min-w-0 flex-1 truncate text-white">
              {p.name} <span className="text-xs text-slate-400">{p.team} · {p.pos.join(", ")}</span>
            </span>
            <span className="text-xs tabular-nums text-slate-300" title="Matchs de son équipe dans les jours simulés">
              {per.get(p.team) ?? 0} m.
            </span>
            <label className="flex min-h-11 items-center gap-1 text-xs text-slate-400">
              <input type="checkbox" checked={out.has(p.id)} onChange={() => onToggleOut(p.id)} className="h-4 w-4 accent-rose-400" />
              absent
            </label>
            <button
              type="button"
              onClick={() => onRemove(p.id)}
              aria-label={`Retirer ${p.name}`}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ajouter un joueur…"
          aria-label={`Ajouter un joueur : ${title}`}
          className="min-h-11 w-full rounded-md border border-white/10 bg-slate-900 px-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        />
        {matches.length ? (
          <ul className="mt-1 space-y-0.5 text-sm">
            {matches.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    onAdd(p.id);
                    setQ("");
                  }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-left text-slate-200 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                >
                  <Plus className="h-4 w-4 text-violet-300" aria-hidden="true" />
                  {p.name} <span className="text-xs text-slate-400">{p.team} · {p.pos.join(", ")}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

const BASE_FIELDS: Array<[string, string]> = [
  ["G", "Buts"],
  ["A", "Passes"],
  ["PPP", "PPA"],
  ["SOG", "Tirs"],
  ["HIT", "Mises en échec"],
  ["BLK", "Tirs bloqués"],
  ["W", "Victoires"],
  ["GAA", "Moyenne"],
  ["SVP", "% d’arrêts"],
  ["SHO", "Blanchissages"],
  ["apps", "Apparitions G"],
];

function ScoreSoFar({ saved, update, enabled }: { saved: Saved; update: (f: (s: Saved) => Saved) => void; enabled: boolean }) {
  const set = (side: "mine" | "theirs", k: string, v: string) =>
    update((s) => {
      const base = s.base ?? { mine: {}, theirs: {} };
      const x = Number(v.replace(",", "."));
      return { ...s, base: { ...base, [side]: { ...base[side], [k]: Number.isFinite(x) ? x : 0 } } };
    });
  return (
    <details className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
      <summary className="min-h-11 cursor-pointer font-semibold text-white">Score déjà acquis cette semaine (facultatif)</summary>
      <p className="mt-2 text-xs text-slate-400">
        Recopiez les totaux de Yahoo pour les jours déjà joués; seuls les jours qui restent sont simulés.{enabled ? "" : " (Cochez « Seulement les jours qui restent » pour qu’ils comptent.)"}
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-[36rem] text-xs">
          <thead>
            <tr className="text-slate-400">
              <th scope="col" className="pr-2 text-left font-medium" />
              {BASE_FIELDS.map(([k, label]) => (
                <th key={k} scope="col" className="px-1 text-left font-medium">
                  {label}
                </th>
              ))}
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {(["mine", "theirs"] as const).map((side) => (
              <tr key={side}>
                <th scope="row" className="pr-2 text-left font-normal text-slate-300">
                  {side === "mine" ? "Moi" : "Adversaire"}
                </th>
                {BASE_FIELDS.map(([k, label]) => (
                  <td key={k} className="px-1 py-1">
                    <input
                      inputMode="decimal"
                      aria-label={`${label} (${side === "mine" ? "moi" : "adversaire"})`}
                      defaultValue={saved.base?.[side]?.[k] ?? ""}
                      onBlur={(e) => set(side, k, e.target.value)}
                      className="min-h-11 w-16 rounded-md border border-white/10 bg-slate-900 px-1 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                    />
                  </td>
                ))}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {saved.base ? (
        <button type="button" onClick={() => update((s) => ({ ...s, base: null }))} className="mt-2 min-h-11 text-violet-300 underline-offset-2 hover:underline">
          Effacer le score
        </button>
      ) : null}
    </details>
  );
}
