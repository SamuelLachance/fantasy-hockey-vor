"use client";

import { ArrowLeftRight, BookOpen, Crosshair, Lightbulb, Scale } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { assetsOf, CAPTAINS_LOTTERY, type AssetLeague, type AssetRecord, type PickInput, type TeamAssets } from "@/lib/dynasty/asset-score";
import { fxeaGet } from "@/lib/fantrax/client";
import { fantraxPublicFile } from "@/lib/fantrax/config";
import { fmtMoney } from "@/lib/fantrax/money";
import { capSeasonLabel } from "@/lib/fantrax/salary-copy";
import { fetchSnapshotFile } from "@/lib/fantrax/snapshot-fetch";
import { buildTradeContext, remainingShares, type TradeRecord } from "@/lib/trade/context";
import { baseStates, bestOffers, counterOffers, evaluateTrade, type AcceptMode, type Proposal, type SideEval, type Trade, type TradeContext } from "@/lib/trade/evaluate";
import { HORIZONS, lineupPoints, seatNeeds, type Horizon } from "@/lib/trade/team-value";
import { PlayerCardLink } from "@/components/player-card/PlayerCardLink";
import { useFantraxLeague } from "@/components/fantrax/fantrax-league-context";
import { LeagueCard, Tag } from "@/components/fantrax/LeagueCard";

const LEAGUE_KIND: Record<string, AssetLeague> = { "captains-dynasty": "keeper" };
const DELTAS: Record<Horizon, number> = { winNow: 0.35, balanced: 0.75, longTerm: 0.95 };
const FIRST_SEASON = 2026;
const HORIZON_FR: Record<Horizon, string> = { winNow: "Gagner maintenant", balanced: "Équilibré", longTerm: "Long terme" };
const NBSP = " ";
const MINUS = "−";
const fmt0 = (x: number) => Math.round(x).toLocaleString("fr-CA");
const signed = (x: number) => `${x > 0.5 ? "+" : x < -0.5 ? MINUS : ""}${Math.abs(Math.round(x)).toLocaleString("fr-CA")}`;
const tone = (x: number) => (x > 0.5 ? "text-emerald-300" : x < -0.5 ? "text-rose-300" : "text-slate-300");

interface FxeaPicks {
  futureDraftPicks?: Array<{ currentOwnerTeamId: string; originalOwnerTeamId: string; round: number; year: number }>;
}

/**
 * « Échanges » of a Fantrax dynasty league: build a trade (any players and
 * future picks, both sides), read what it does to each team — dynasty value
 * on every horizon as a TEAM (roster limits included), this season's lineup
 * points (positional need), each team judged on its own window, the market's
 * view, and in a cap league the payroll season by season — then fair
 * counter-offers and the best trade to offer each other team.
 */
export function TradeTab() {
  const { config, teamId, state, live, teams, teamName, bundle, nowMs } = useFantraxLeague();
  const [records, setRecords] = useState<Record<string, TradeRecord> | null>(null);
  const [picks, setPicks] = useState<PickInput[] | null>(null);
  const [picksErr, setPicksErr] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSnapshotFile<{ players: Record<string, TradeRecord> }>(fantraxPublicFile(config, "dynasty-table.json")).then(
      (f) => !cancelled && setRecords(f.players),
      () => !cancelled && setErr(true),
    );
    fxeaGet<FxeaPicks>("getDraftPicks", { leagueId: config.leagueId }, { retries: 2, timeoutMs: 8_000 }).then(
      (j) =>
        !cancelled &&
        setPicks((j.futureDraftPicks ?? []).map((p) => ({ year: p.year, round: p.round, owner: p.currentOwnerTeamId, original: p.originalOwnerTeamId }))),
      () => {
        if (cancelled) return;
        setPicks([]);
        setPicksErr(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [config]);

  const rosters = useMemo(() => {
    if (!state) return null;
    const src = live?.rosters ?? state.rosters;
    const out: Record<string, Array<{ id: string; status: string }>> = {};
    for (const t of teams) out[t.id] = (src[t.id] ?? []).map((e) => ({ id: e.id, status: e.status }));
    return out;
  }, [state, live, teams]);

  const assets = useMemo(() => {
    if (!records || !rosters || !picks) return null;
    const ids: Record<string, string[]> = {};
    for (const t of teams) ids[t.id] = (rosters[t.id] ?? []).map((e) => e.id);
    const input = {
      kind: LEAGUE_KIND[config.slug] ?? ("dynasty" as AssetLeague),
      firstSeason: FIRST_SEASON,
      teams: teams.map((t) => t.id),
      rosters: ids,
      records: records as Record<string, AssetRecord>,
      picks,
      deltas: DELTAS,
      keepers: 10,
      lottery: config.slug === "captains-dynasty" ? CAPTAINS_LOTTERY : null,
      draftOrder: "fixed" as const,
    };
    return { winNow: assetsOf(input, "winNow"), balanced: assetsOf(input, "balanced"), longTerm: assetsOf(input, "longTerm") } as Record<Horizon, TeamAssets[]>;
  }, [records, rosters, picks, teams, config.slug]);

  const [override, setOverride] = useState<Record<string, Horizon>>({});
  const ctx: TradeContext | null = useMemo(() => {
    if (!assets || !records || !rosters || !bundle || nowMs == null) return null;
    return buildTradeContext({
      config,
      teams: teams.map((t) => t.id),
      rosters,
      records,
      values: bundle.values.players,
      remaining: remainingShares(bundle.schedule.games, bundle.league.startDate, bundle.league.endDate, nowMs),
      assets,
      contracts: bundle.contracts,
      horizonOverride: override,
    });
  }, [assets, records, rosters, bundle, nowMs, config, teams, override]);
  const bases = useMemo(() => (ctx ? baseStates(ctx) : null), [ctx]);
  // who says yes: the model on his horizon (win-win), or also the market (never with a cap: it ignores the league's contracts)
  const [modeChoice, setMode] = useState<AcceptMode>("modele");
  const mode: AcceptMode = config.salaryCap ? "modele" : modeChoice;

  const others = teams.filter((t) => t.id !== teamId);
  const [partner, setPartner] = useState<string>("");
  const other = partner && partner !== teamId ? partner : (others[0]?.id ?? "");
  // the trade on the table belongs to one pair of teams: another pair starts empty
  const pairKey = `${teamId}|${other}`;
  const [sel, setSel] = useState<{ key: string; give: string[]; get: string[] }>({ key: "", give: [], get: [] });
  const give = useMemo(() => (sel.key === pairKey ? sel.give : []), [sel, pairKey]);
  const get = useMemo(() => (sel.key === pairKey ? sel.get : []), [sel, pairKey]);
  const setGive = (f: (x: string[]) => string[]) => setSel((s) => ({ key: pairKey, give: f(s.key === pairKey ? s.give : []), get: s.key === pairKey ? s.get : [] }));
  const setGet = (f: (x: string[]) => string[]) => setSel((s) => ({ key: pairKey, get: f(s.key === pairKey ? s.get : []), give: s.key === pairKey ? s.give : [] }));

  const evaluated = useMemo(() => {
    if (!ctx || !bases) return null;
    const split = (xs: readonly string[]) => ({
      players: xs.filter((x) => !x.startsWith("pick:")),
      picks: xs.filter((x) => x.startsWith("pick:")).map((x) => x.slice(5)),
    });
    const [me, them] = sel.key.split("|");
    if (sel.key !== pairKey || !me || !them || (!sel.give.length && !sel.get.length)) return null;
    const trade: Trade = { a: { team: me, ...split(sel.give) }, b: { team: them, ...split(sel.get) } };
    return {
      evaluation: evaluateTrade(ctx, trade, bases),
      counters: sel.give.length && sel.get.length ? counterOffers(ctx, trade, 4, bases, mode) : [],
    };
  }, [ctx, bases, sel, pairKey, mode]);
  const evaluation = evaluated?.evaluation ?? null;
  const counters = evaluated?.counters ?? [];

  // best offers to the partner, then (on demand) to every team
  const [offers, setOffers] = useState<{ key: string; list: Proposal[] } | null>(null);
  const offersKey = ctx ? `${teamId}|${other}|${mode}|${JSON.stringify(override)}` : "";
  useEffect(() => {
    if (!ctx || !bases || !other) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      const list = bestOffers(ctx, teamId, other, { bases, limit: 3, mode });
      if (!cancelled) setOffers({ key: offersKey, list });
    }, 30);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [ctx, bases, teamId, other, offersKey, mode]);
  const [league, setLeague] = useState<{ key: string; rows: Array<{ team: string; best: Proposal | null }>; done: boolean } | null>(null);
  const scanAll = () => {
    if (!ctx || !bases) return;
    const key = offersKey;
    const rows: Array<{ team: string; best: Proposal | null }> = [];
    setLeague({ key, rows: [], done: false });
    let i = 0;
    const step = () => {
      const t = others[i];
      if (!t) {
        setLeague({ key, rows: [...rows].sort((a, b) => (b.best?.eval.a.gain ?? -1e9) - (a.best?.eval.a.gain ?? -1e9)), done: true });
        return;
      }
      rows.push({ team: t.id, best: bestOffers(ctx, teamId, t.id, { bases, limit: 1, depth: 12, mode })[0] ?? null });
      i++;
      setLeague({ key, rows: [...rows], done: false });
      window.setTimeout(step, 0);
    };
    window.setTimeout(step, 0);
  };

  const needs = useMemo(() => {
    if (!ctx) return null;
    const all = ctx.teams.map((t) => lineupPoints((ctx.rosters[t] ?? []).map((id) => ctx.players[id]!).filter(Boolean), ctx.lineup, ctx.faBySlot));
    const byTeam = new Map(ctx.teams.map((t, i) => [t, all[i]!]));
    return (t: string) => {
      const me = byTeam.get(t);
      return me ? seatNeeds(me, all, ctx.lineup.seats).filter((n) => n.share < 0.85) : [];
    };
  }, [ctx]);

  if (err) return <p className="text-sm text-rose-200">Les valeurs dynastie n’ont pas pu être lues. Actualisez la page pour réessayer.</p>;
  if (!ctx || !assets) return <p className="text-sm text-slate-400">Chargement des valeurs, des effectifs et des choix de repêchage…</p>;

  const windowOf = (t: string) => assets.balanced.find((x) => x.team === t)?.window ?? "Entre-deux";
  const pickLabel = (id: string) => {
    const p = ctx.picks[id];
    if (!p) return id;
    return p.original && p.original !== p.owner ? `${p.name} (de ${teamName(p.original)})` : p.name;
  };
  const apply = (t: Trade) => {
    setSel({ key: `${t.a.team}|${t.b.team}`, give: [...t.a.players, ...t.a.picks.map((p) => `pick:${p}`)], get: [...t.b.players, ...t.b.picks.map((p) => `pick:${p}`)] });
    if (t.b.team !== other) setPartner(t.b.team);
  };
  const describe = (t: Trade) => {
    const names = (s: Trade["a"]) => [...s.players.map((id) => ctx.players[id]?.name ?? id), ...s.picks.map(pickLabel)].join(", ");
    return { give: names(t.a), get: names(t.b) };
  };

  return (
    <div className="grid gap-6">
      <LeagueCard
        id="echange-montage"
        icon={<ArrowLeftRight className="h-5 w-5" />}
        title="Monter un échange"
        accentClass="text-cyan-300"
        description="Cochez ce que vous donnez et ce que vous recevez (joueurs et choix de repêchage, autant que vous voulez de chaque côté). L’évaluation se met à jour aussitôt."
        headerExtra={picksErr ? <Tag tone="amber">choix de repêchage indisponibles (Fantrax n’a pas répondu)</Tag> : null}
      >
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-slate-400">Partenaire</span>
            <select
              value={other}
              onChange={(e) => setPartner(e.target.value)}
              className="min-h-11 rounded-md border border-white/10 bg-slate-900 px-2 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              {others.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          {[teamId, other].map((t) => (
            <label key={t} className="flex items-center gap-2">
              <span className="text-slate-400">Horizon de {teamName(t)}</span>
              <select
                value={ctx.horizonOf[t] ?? "balanced"}
                onChange={(e) => setOverride((o) => ({ ...o, [t]: e.target.value as Horizon }))}
                className="min-h-11 rounded-md border border-white/10 bg-slate-900 px-2 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                {HORIZONS.map((h) => (
                  <option key={h} value={h}>
                    {HORIZON_FR[h]}
                  </option>
                ))}
              </select>
              <Tag>{windowOf(t)}</Tag>
            </label>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <AssetPicker
            title={`Vous donnez (${teamName(teamId)})`}
            ctx={ctx}
            team={teamId}
            horizon={ctx.horizonOf[other] ?? "balanced"}
            chosen={give}
            setChosen={setGive}
            pickLabel={pickLabel}
            needs={needs?.(teamId) ?? []}
            slug={config.slug}
          />
          <AssetPicker
            title={`Vous recevez (${teamName(other)})`}
            ctx={ctx}
            team={other}
            horizon={ctx.horizonOf[teamId] ?? "balanced"}
            chosen={get}
            setChosen={setGet}
            pickLabel={pickLabel}
            needs={needs?.(other) ?? []}
            slug={config.slug}
          />
        </div>
      </LeagueCard>

      {evaluation ? (
        <LeagueCard
          id="echange-verdict"
          icon={<Scale className="h-5 w-5" />}
          title={
            evaluation.winWin
              ? "Gagnant-gagnant"
              : evaluation.a.gain >= 0
                ? `Avantage ${teamName(teamId)}`
                : evaluation.b.gain >= 0
                  ? `Avantage ${teamName(other)}`
                  : "Perdant des deux côtés"
          }
          accentClass={evaluation.a.gain >= 0 ? "text-emerald-300" : "text-rose-300"}
          description="Chaque équipe est jugée sur son propre horizon. « Gain » = valeur dynastie de l’équipe (limites d’effectif incluses) + l’effet sur l’alignement de cette saison au-delà des points des joueurs eux-mêmes (besoin par position)."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <SideCard side={evaluation.a} name={teamName(evaluation.a.team)} ctx={ctx} pickLabel={pickLabel} />
            <SideCard side={evaluation.b} name={teamName(evaluation.b.team)} ctx={ctx} pickLabel={pickLabel} />
          </div>
          {counters.length ? (
            <div className="mt-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                <Lightbulb className="h-4 w-4 text-amber-300" aria-hidden="true" />
                Contre-offres équitables
              </h3>
              <ul className="space-y-2 text-sm">
                {counters.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/5 px-3 py-2">
                    <span className="min-w-0 flex-1 text-slate-200">{c.note}</span>
                    <span className="text-xs text-slate-400">
                      vous {signed(c.eval.a.gain)} · eux {signed(c.eval.b.gain)} (marché {signed(c.eval.b.marketGain)})
                    </span>
                    <button
                      type="button"
                      onClick={() => apply(c.trade)}
                      className="min-h-11 rounded-md px-3 text-cyan-300 ring-1 ring-cyan-500/40 hover:bg-cyan-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                    >
                      Appliquer
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </LeagueCard>
      ) : null}

      <LeagueCard
        id="echange-cibles"
        icon={<Crosshair className="h-5 w-5" />}
        title={`Offres à faire à ${teamName(other)}`}
        accentClass="text-emerald-300"
        description={
          mode === "modele"
            ? "Les échanges 1 pour 1, 2 pour 1 et 1 pour 2 parmi les meilleurs actifs des deux équipes qui vous font gagner le plus, parmi ceux où l’autre équipe gagne aussi sur son propre horizon (gagnant-gagnant : besoins et fenêtres différents)."
            : "Les échanges 1 pour 1, 2 pour 1 et 1 pour 2 qui vous font gagner le plus, parmi ceux que l’autre équipe gagne sur son horizon ou que le marché juge en sa faveur (sans qu’elle y perde plus du tiers de ce qu’elle donne)."
        }
        headerExtra={
          <button
            type="button"
            onClick={scanAll}
            disabled={league?.key === offersKey && !league.done}
            className="min-h-11 rounded-md px-3 text-sm text-emerald-200 ring-1 ring-emerald-500/40 hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50"
          >
            {league?.key === offersKey && !league.done ? `Analyse… ${league.rows.length}/${others.length}` : "Analyser toutes les équipes"}
          </button>
        }
      >
        {config.salaryCap ? null : (
          <fieldset className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <legend className="sr-only">Quelles offres l’autre équipe accepterait</legend>
            {(["modele", "marche"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`min-h-11 rounded-full px-3 ring-1 ${mode === m ? "bg-emerald-500/20 text-emerald-100 ring-emerald-400/50" : "text-slate-300 ring-white/10 hover:bg-white/5"}`}
              >
                {m === "modele" ? "Gagnant-gagnant (modèle)" : "Aussi ce que le marché accepte"}
              </button>
            ))}
          </fieldset>
        )}
        {offers?.key === offersKey ? (
          offers.list.length ? (
            <OfferList list={offers.list} describe={describe} apply={apply} />
          ) : (
            <p className="text-sm text-slate-400">Aucun échange avantageux et acceptable trouvé avec cette équipe.</p>
          )
        ) : (
          <p className="text-sm text-slate-400">Recherche des meilleures offres…</p>
        )}
        {league?.key === offersKey && league.rows.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <caption className="sr-only">Meilleure offre à faire à chaque équipe</caption>
              <thead>
                <tr className="text-xs text-slate-400">
                  <th scope="col" className="py-1 pr-2 text-left font-medium">Équipe</th>
                  <th scope="col" className="py-1 pr-2 text-left font-medium">Fenêtre · besoins</th>
                  <th scope="col" className="py-1 pr-2 text-left font-medium">Offre</th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">Vous</th>
                  <th scope="col" className="py-1 text-right font-medium">Eux</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {league.rows.map(({ team, best }) => {
                  const d = best ? describe(best.trade) : null;
                  return (
                    <tr key={team} className="border-t border-white/5 align-top">
                      <th scope="row" className="py-1.5 pr-2 text-left font-normal text-white">{teamName(team)}</th>
                      <td className="py-1.5 pr-2 text-xs text-slate-300">
                        {windowOf(team)}
                        {needs?.(team).length ? ` · besoin : ${needs(team).map((n) => n.slot).join(", ")}` : ""}
                      </td>
                      <td className="py-1.5 pr-2 text-xs text-slate-200">
                        {d && best ? (
                          <button type="button" className="text-left hover:underline" onClick={() => apply(best.trade)}>
                            Donner {d.give} · recevoir {d.get}
                          </button>
                        ) : (
                          <span className="text-slate-400">rien d’avantageux</span>
                        )}
                      </td>
                      <td className={`py-1.5 pr-2 text-right ${tone(best?.eval.a.gain ?? 0)}`}>{best ? signed(best.eval.a.gain) : "—"}</td>
                      <td className={`py-1.5 text-right ${tone(best?.eval.b.gain ?? 0)}`}>{best ? signed(best.eval.b.gain) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </LeagueCard>

      <LeagueCard id="echange-methode" icon={<BookOpen className="h-5 w-5" />} title="Comment l’échange est évalué" accentClass="text-slate-300">
        <div className="space-y-2 text-sm text-slate-300">
          <p>
            <strong className="text-white">Valeur d’équipe, pas somme de joueurs.</strong> Chaque joueur vaut sa valeur dynastie de la ligue (la même que l’onglet
            Actifs), mais une équipe ne peut garder que ce que son effectif contient : qui reçoit deux joueurs pour un doit libérer son joueur le moins utile (sa
            valeur part avec lui); qui en envoie deux pour un gagne une place, comblée par le meilleur joueur autonome.
            {config.features.minorsAnyPlayer ? "" : " Les espoirs admissibles aux mineures n’y prennent pas de place."}
          </p>
          <p>
            <strong className="text-white">Cette saison.</strong> Les points du reste de la saison du meilleur alignement de chaque équipe (postes, admissibilité,
            banc qui joue quand un partant a congé{config.features.gamesCaps ? " sous les plafonds de matchs" : ""}
            {config.features.captainSlot ? ", capitaine" : ""}). Un joueur qui comble un trou vaut plus qu’un joueur qui resterait sur le banc : c’est la ligne
            « ajustement » (le besoin par position).
          </p>
          <p>
            <strong className="text-white">Validation.</strong> Sur trois saisons LNH rejouées jour par jour (9 000 échanges simulés, ligue à la Slapshot), ce calcul
            classe mieux les échanges que la simple addition des points projetés (corrélation de rang 0,33 contre 0,25; bon sens du gain 60,6 % contre 57,9 %;
            écart moyen aux points réels 89,8 contre 92,6), pour chaque type d’échange et surtout pour les 1 pour 2. Ce test valide les points de la saison; la
            valeur dynastie elle-même vient du modèle de la ligue.
          </p>
          {ctx.cap ? (
            <p>
              <strong className="text-white">Plafond.</strong> La masse salariale engagée de chaque équipe, saison par saison, avant et après : les 23 joueurs comptés
              (Actifs + Réserve) choisis par valeur, avec les contrats de ligue confirmés et les contrats projetés ensuite. Un échange qui ferait dépasser le
              plafond cette saison n’est jamais proposé.
            </p>
          ) : null}
        </div>
      </LeagueCard>
    </div>
  );
}

function AssetPicker({
  title,
  ctx,
  team,
  horizon,
  chosen,
  setChosen,
  pickLabel,
  needs,
  slug,
}: {
  title: string;
  ctx: TradeContext;
  team: string;
  horizon: Horizon;
  chosen: string[];
  setChosen: (f: (x: string[]) => string[]) => void;
  pickLabel: (id: string) => string;
  needs: Array<{ slot: string; share: number }>;
  slug: string;
}) {
  const [q, setQ] = useState("");
  const players = (ctx.rosters[team] ?? [])
    .map((id) => ctx.players[id]!)
    .filter(Boolean)
    .sort((a, b) => b.dv[horizon] - a.dv[horizon]);
  const picks = Object.values(ctx.picks)
    .filter((p) => p.owner === team)
    .sort((a, b) => b.value[horizon] - a.value[horizon]);
  const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const show = (name: string) => !q || fold(name).includes(fold(q));
  const toggle = (key: string) => setChosen((xs) => (xs.includes(key) ? xs.filter((x) => x !== key) : [...xs, key]));
  return (
    <fieldset className="min-w-0 rounded-xl border border-white/10 p-3">
      <legend className="px-1 text-sm font-semibold text-white">{title}</legend>
      {needs.length ? <p className="mb-2 text-xs text-amber-200">Besoins : {needs.map((n) => `${n.slot} (${Math.round(n.share * 100)} % de la médiane)`).join(", ")}</p> : null}
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filtrer…"
        aria-label={`Filtrer : ${title}`}
        className="mb-2 min-h-11 w-full rounded-md border border-white/10 bg-slate-900 px-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
      />
      <ul className="max-h-80 space-y-0.5 overflow-y-auto text-sm">
        {players.filter((p) => show(p.name)).map((p) => (
          <li key={p.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-1 hover:bg-white/5">
              <input type="checkbox" aria-label={p.name} checked={chosen.includes(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4 accent-cyan-400" />
              <span className="min-w-0 flex-1 truncate text-white">
                <PlayerCardLink fx={p.id} league={slug}>
                  {p.name}
                </PlayerCardLink>
                <span className="ml-1 text-xs text-slate-400">{p.pos.filter((t) => t !== "F" && t !== "Skt").join(", ")}</span>
              </span>
              <span className="tabular-nums text-xs text-slate-300" title="Valeur dynastie (horizon de l’équipe qui le reçoit)">
                {fmt0(p.dv[horizon])}
              </span>
              <span className="w-14 text-right tabular-nums text-xs text-slate-400" title="Points projetés du reste de la saison">
                {p.fp > 0 ? `${fmt0(p.fp)}${NBSP}pts` : "—"}
              </span>
            </label>
          </li>
        ))}
        {picks.filter((p) => show(pickLabel(p.id))).map((p) => (
          <li key={p.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-1 hover:bg-white/5">
              <input
                type="checkbox"
                aria-label={pickLabel(p.id)}
                checked={chosen.includes(`pick:${p.id}`)}
                onChange={() => toggle(`pick:${p.id}`)}
                className="h-4 w-4 accent-cyan-400"
              />
              <span className="min-w-0 flex-1 truncate text-slate-200">{pickLabel(p.id)}</span>
              <span className="tabular-nums text-xs text-slate-300">{fmt0(p.value[horizon])}</span>
              <span className="w-14" />
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function SideCard({ side, name, ctx, pickLabel }: { side: SideEval; name: string; ctx: TradeContext; pickLabel: (id: string) => string }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 p-3 text-sm">
      <h3 className="mb-1 font-semibold text-white">{name}</h3>
      <p className="mb-2 text-xs text-slate-400">Horizon : {HORIZON_FR[side.horizon]}</p>
      <p className={`text-2xl font-semibold tabular-nums ${tone(side.gain)}`}>
        {signed(side.gain)} <span className="text-sm font-normal text-slate-400">gain</span>
      </p>
      <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
        {HORIZONS.map((h) => (
          <div key={h} className="contents">
            <dt className="text-slate-400">Valeur · {HORIZON_FR[h]}</dt>
            <dd className={`tabular-nums ${tone(side.dv[h])}`}>{signed(side.dv[h])}</dd>
          </div>
        ))}
        <dt className="text-slate-400">Points cette saison (alignement)</dt>
        <dd className={`tabular-nums ${tone(side.season)}`}>{signed(side.season)}</dd>
        <dt className="text-slate-400">dont ajustement (besoin, banc)</dt>
        <dd className={`tabular-nums ${tone(side.fit)}`}>{signed(side.fit)}</dd>
        <dt className="text-slate-400">Vu par le marché</dt>
        <dd className={`tabular-nums ${tone(side.marketGain)}`}>{signed(side.marketGain)}</dd>
      </dl>
      {side.dropped.length ? (
        <p className="mt-2 text-xs text-amber-200">
          Doit libérer : {side.dropped.map((id) => ctx.players[id]?.name ?? id).join(", ")}
        </p>
      ) : null}
      <p className="mt-2 text-xs text-slate-400">
        Reçoit : {side.received.map((r) => (r.kind === "pick" ? pickLabel(r.id) : r.name)).join(", ") || "rien"}
      </p>
      {side.cap ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[18rem] text-xs">
            <caption className="sr-only">Masse salariale comptée avant et après, par saison</caption>
            <thead>
              <tr className="text-slate-400">
                <th scope="col" className="py-0.5 pr-2 text-left font-medium">Saison</th>
                <th scope="col" className="py-0.5 pr-2 text-right font-medium">Avant</th>
                <th scope="col" className="py-0.5 pr-2 text-right font-medium">Après</th>
                <th scope="col" className="py-0.5 text-right font-medium">Plafond</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {side.cap.after.map((x, i) => (
                <tr key={i} className="border-t border-white/5">
                  <th scope="row" className="py-0.5 pr-2 text-left font-normal text-slate-300">{capSeasonLabel(ctx.cap!.seasons[i]!)}</th>
                  <td className="py-0.5 pr-2 text-right text-slate-300">{fmtMoney(side.cap!.before[i]!)}</td>
                  <td className={`py-0.5 pr-2 text-right ${side.cap!.over[i] ? "text-rose-300" : "text-white"}`}>{fmtMoney(x)}</td>
                  <td className="py-0.5 text-right text-slate-400">{fmtMoney(side.cap!.cap[i]!)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {side.cap.over[0] ? <p className="mt-1 text-xs text-rose-200">Dépasse le plafond cette saison : échange impossible tel quel.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function OfferList({ list, describe, apply }: { list: Proposal[]; describe: (t: Trade) => { give: string; get: string }; apply: (t: Trade) => void }) {
  return (
    <ul className="space-y-2 text-sm">
      {list.map((p, i) => {
        const d = describe(p.trade);
        return (
          <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/5 px-3 py-2">
            <span className="min-w-0 flex-1 text-slate-200">
              Donner <strong className="text-white">{d.give}</strong> · recevoir <strong className="text-white">{d.get}</strong>
            </span>
            <span className="text-xs text-slate-400">
              vous {signed(p.eval.a.gain)} · eux {signed(p.eval.b.gain)} (marché {signed(p.eval.b.marketGain)})
              {p.eval.winWin ? " · gagnant-gagnant" : ""}
            </span>
            <button
              type="button"
              onClick={() => apply(p.trade)}
              className="min-h-11 rounded-md px-3 text-cyan-300 ring-1 ring-cyan-500/40 hover:bg-cyan-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Évaluer
            </button>
          </li>
        );
      })}
    </ul>
  );
}
