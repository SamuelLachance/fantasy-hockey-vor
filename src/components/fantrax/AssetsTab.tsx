"use client";

import { BookOpen, Briefcase, Crosshair, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  assetsOf,
  tradeTargets,
  type Asset,
  type AssetHorizon,
  type AssetLeague,
  type AssetRecord,
  type PickInput,
  type TeamAssets,
} from "@/lib/dynasty/asset-score";
import { fxeaGet } from "@/lib/fantrax/client";
import { fantraxPublicFile } from "@/lib/fantrax/config";
import { fetchSnapshotFile } from "@/lib/fantrax/snapshot-fetch";
import { PlayerCardLink } from "@/components/player-card/PlayerCardLink";
import { useFantraxLeague } from "./fantrax-league-context";
import { LeagueCard, Tag } from "./LeagueCard";

/** How each dynasty league turns over (the pick pool and the keeper risk follow it). */
const LEAGUE_KIND: Record<string, AssetLeague> = { "captains-dynasty": "keeper" };
const HORIZON_FR: Record<AssetHorizon, string> = { winNow: "Gagner maintenant", balanced: "Équilibré", longTerm: "Long terme" };
/** Discount per season of each horizon (the dynasty engine's modes). */
const DELTAS: Record<AssetHorizon, number> = { winNow: 0.35, balanced: 0.75, longTerm: 0.95 };
const FIRST_SEASON = 2026;
const TIER_TONE = { Élite: "violet", Pilier: "emerald", Solide: "cyan", Utile: "slate", Marginal: "slate" } as const;
const ACTION_TONE: Record<string, "slate" | "amber" | "rose" | "emerald" | "violet" | "cyan"> = {
  Garder: "emerald",
  "Garder (pièce d’échange)": "cyan",
  "Vendre haut": "amber",
  "Vendre maintenant": "amber",
  "Échanger avant l’écrémage": "rose",
  Remplaçable: "slate",
};
const TIMELINE_FR = { maintenant: "valeur surtout maintenant", durable: "valeur durable", avenir: "valeur surtout à venir" };
const fmt0 = (x: number) => Math.round(x).toLocaleString("fr-CA");
const ord = (n: number) => (n === 1 ? "1er" : `${n}e`);

interface FxeaPicks {
  futureDraftPicks?: Array<{ currentOwnerTeamId: string; originalOwnerTeamId: string; round: number; year: number }>;
}

function ScoreBar({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={`Score ${score} : meilleur que ${score} % des joueurs possédés de la ligue`}>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <span className="block h-full rounded-full bg-cyan-400" style={{ width: `${score}%` }} />
      </span>
      <span className="w-7 text-right font-semibold text-white">{score}</span>
    </span>
  );
}

/**
 * The « Actifs » tab of a dynasty league: every player and future draft pick
 * of every team scored 0-100 (src/lib/dynasty/asset-score.ts) on the league's
 * own dynasty values, each team's window (Aspirant / Entre-deux /
 * Reconstruction), what to do with each asset, and trade targets for the
 * user's team.
 */
export function AssetsTab() {
  const { config, teamId, chooseTeam, state, live, teamName, teams } = useFantraxLeague();
  const [records, setRecords] = useState<Record<string, AssetRecord> | null>(null);
  const [picks, setPicks] = useState<PickInput[] | null>(null);
  const [picksState, setPicksState] = useState<"loading" | "ready" | "error">("loading");
  const [err, setErr] = useState(false);
  const [horizon, setHorizon] = useState<AssetHorizon>("balanced");

  useEffect(() => {
    let cancelled = false;
    fetchSnapshotFile<{ players: Record<string, AssetRecord> }>(fantraxPublicFile(config, "dynasty-table.json")).then(
      (f) => !cancelled && setRecords(f.players),
      () => !cancelled && setErr(true),
    );
    fxeaGet<FxeaPicks>("getDraftPicks", { leagueId: config.leagueId }, { retries: 2, timeoutMs: 8_000 }).then(
      (j) => {
        if (cancelled) return;
        setPicks(
          (j.futureDraftPicks ?? []).map((p) => ({ year: p.year, round: p.round, owner: p.currentOwnerTeamId, original: p.originalOwnerTeamId })),
        );
        setPicksState("ready");
      },
      () => {
        if (cancelled) return;
        setPicks([]);
        setPicksState("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [config]);

  const kind: AssetLeague = LEAGUE_KIND[config.slug] ?? "dynasty";
  const all: TeamAssets[] | null = useMemo(() => {
    if (!records || !state || !picks) return null;
    const rosters: Record<string, string[]> = {};
    const src = live?.rosters ?? state.rosters;
    for (const t of teams) rosters[t.id] = (src[t.id] ?? []).map((e) => e.id);
    return assetsOf(
      { kind, firstSeason: FIRST_SEASON, teams: teams.map((t) => t.id), rosters, records, picks, deltas: DELTAS, keepers: 10 },
      horizon,
    );
  }, [records, state, live, picks, teams, kind, horizon]);

  if (err) return <p className="text-sm text-rose-200">Les valeurs dynastie n’ont pas pu être lues. Actualisez la page pour réessayer.</p>;
  if (!all) return <p className="text-sm text-slate-400">Calcul des actifs de chaque équipe…</p>;

  const ranked = [...all].sort((a, b) => a.ranks.total - b.ranks.total);
  const mine = all.find((t) => t.team === teamId) ?? ranked[0]!;
  const targets = tradeTargets(all, mine.team);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-400">Horizon</span>
        {(Object.keys(HORIZON_FR) as AssetHorizon[]).map((h) => (
          <button
            key={h}
            type="button"
            aria-pressed={horizon === h}
            onClick={() => setHorizon(h)}
            className={`rounded-full px-2.5 py-1 ring-1 ${horizon === h ? "bg-cyan-500/20 text-cyan-100 ring-cyan-400/50" : "text-slate-300 ring-white/10 hover:bg-white/5"}`}
          >
            {HORIZON_FR[h]}
          </button>
        ))}
        {picksState === "error" ? <Tag tone="amber">choix de repêchage indisponibles (Fantrax n’a pas répondu)</Tag> : null}
      </div>

      <LeagueCard
        id="actifs-ligue"
        icon={<Trophy className="h-5 w-5" />}
        title="Les équipes par valeur de leurs actifs"
        accentClass="text-amber-300"
        description="Valeur totale = joueurs + choix de repêchage, en valeur dynastie de la ligue. « Maintenant » : force de cette saison; « Avenir » : valeur long terme des 25 meilleurs. Cliquez une équipe pour voir ses actifs."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">Classement des équipes par valeur de leurs actifs</caption>
            <thead>
              <tr className="text-xs text-slate-400">
                <th scope="col" className="py-1 pr-2 text-left font-medium">
                  #
                </th>
                <th scope="col" className="py-1 pr-2 text-left font-medium">
                  Équipe
                </th>
                <th scope="col" className="py-1 pr-2 text-left font-medium">
                  Fenêtre
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">
                  Valeur totale
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">
                  dont choix
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">
                  Maintenant
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Avenir
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {ranked.map((t) => (
                <tr key={t.team} className={`border-t border-white/5 ${t.team === mine.team ? "bg-cyan-500/5" : ""}`}>
                  <td className="py-1 pr-2 text-slate-400">{t.ranks.total}</td>
                  <th scope="row" className="py-1 pr-2 text-left font-normal">
                    <button type="button" className="text-left text-white hover:underline" onClick={() => chooseTeam(t.team)}>
                      {teamName(t.team)}
                    </button>
                  </th>
                  <td className="py-1 pr-2">
                    <Tag tone={t.window === "Aspirant" ? "emerald" : t.window === "En montée" ? "cyan" : t.window === "Reconstruction" ? "violet" : "slate"}>{t.window}</Tag>
                  </td>
                  <td className="py-1 pr-2 text-right font-semibold text-white">{fmt0(t.total)}</td>
                  <td className="py-1 pr-2 text-right text-slate-300">{fmt0(t.pickValue)}</td>
                  <td className="py-1 pr-2 text-right text-slate-300">{ord(t.ranks.now)}</td>
                  <td className="py-1 text-right text-slate-300">{ord(t.ranks.future)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LeagueCard>

      <LeagueCard
        id="actifs-equipe"
        icon={<Briefcase className="h-5 w-5" />}
        title={`Actifs de ${teamName(mine.team)}`}
        accentClass="text-cyan-300"
        description={`${mine.window} (${ord(mine.ranks.now)} maintenant, ${ord(mine.ranks.future)} pour l’avenir, ${ord(mine.ranks.total)} au total). Score 0-100 : meilleur que ce pourcentage des joueurs possédés de la ligue.`}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <caption className="sr-only">Score, valeur et action conseillée pour chaque actif de l’équipe</caption>
            <thead>
              <tr className="text-xs text-slate-400">
                <th scope="col" className="py-1 pr-2 text-left font-medium">
                  Actif
                </th>
                <th scope="col" className="py-1 pr-2 text-left font-medium">
                  Score
                </th>
                <th scope="col" className="py-1 pr-2 text-left font-medium">
                  Rang
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">
                  Valeur
                </th>
                <th scope="col" className="py-1 pr-2 text-left font-medium">
                  Action
                </th>
                <th scope="col" className="py-1 text-left font-medium">
                  Pourquoi
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {mine.assets.map((a: Asset) => (
                <tr key={`${a.kind}-${a.id}`} className="border-t border-white/5 align-top">
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                    <span className="block font-medium text-white">
                      {a.kind === "player" ? (
                        <PlayerCardLink fx={a.id} league={config.slug}>
                          {a.name}
                        </PlayerCardLink>
                      ) : (
                        a.name
                      )}
                    </span>
                    <span className="text-xs text-slate-400">
                      {a.kind === "pick"
                        ? `choix de repêchage${a.original !== a.team ? ` (de ${teamName(a.original)})` : ""} · ~${a.slot}e au total`
                        : TIMELINE_FR[a.timeline]}
                    </span>
                  </th>
                  <td className="py-1.5 pr-2">
                    <ScoreBar score={a.score} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Tag tone={TIER_TONE[a.tier]}>{a.tier}</Tag>
                  </td>
                  <td className="py-1.5 pr-2 text-right text-slate-200">{fmt0(a.value)}</td>
                  <td className="py-1.5 pr-2">
                    <Tag tone={ACTION_TONE[a.action] ?? "slate"} wrap>
                      {a.action}
                    </Tag>
                  </td>
                  <td className="py-1.5 text-xs text-slate-300">
                    {a.why}
                    {a.kind === "player" && a.flags.length ? <span className="block text-slate-400">{a.flags.join(" · ")}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LeagueCard>

      {mine.team === teamId ? (
        <LeagueCard
          id="actifs-cibles"
          icon={<Crosshair className="h-5 w-5" />}
          title="Cibles d’échange"
          accentClass="text-emerald-300"
          description={`Joueurs d’autres équipes que le marché sous-estime et dont le profil convient à une équipe « ${mine.window} ».`}
        >
          {targets.length ? (
            <ul className="divide-y divide-white/5 text-sm">
              {targets.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
                  <span className="min-w-0 flex-1 font-medium text-white">
                    <PlayerCardLink fx={a.id} league={config.slug}>
                      {a.name}
                    </PlayerCardLink>
                  </span>
                  <span className="text-xs text-slate-400">{teamName(a.team)}</span>
                  <ScoreBar score={a.score} />
                  <span className="text-xs text-slate-300">{TIMELINE_FR[a.timeline]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">Aucune cible évidente pour l’instant.</p>
          )}
        </LeagueCard>
      ) : null}

      <LeagueCard id="actifs-methode" icon={<BookOpen className="h-5 w-5" />} title="Comment le score est calculé" accentClass="text-slate-300">
        <div className="space-y-2 text-sm text-slate-300">
          <p>
            <strong className="text-white">Joueurs.</strong> La valeur est la valeur dynastie de la ligue pour l’horizon choisi : son barème, ses règles
            d’effectif
            {kind === "keeper"
              ? ", et l’écrémage keeper 10 (un joueur qui ne sera pas protégé ne vaut que ce qu’il rapporte d’ici là, sauf s’il peut aller aux mineures)"
              : ", le plafond salarial et les contrats de ligue (un salaire au-dessus de sa production réduit sa valeur, et il part comme agent libre à la fin de son contrôle)"}
            . Le score est son rang centile parmi tous les joueurs possédés de la ligue.
          </p>
          <p>
            <strong className="text-white">Choix de repêchage.</strong> Un choix vaut le joueur qu’on peut s’attendre à y prendre :{" "}
            {kind === "keeper"
              ? "les joueurs non protégés à l’écrémage"
              : "les joueurs qu’aucune équipe ne possède"}{" "}
            et une nouvelle cuvée du repêchage LNH semblable à la dernière, du meilleur au moins bon, actualisé selon l’année du choix. Le rang dans la
            ronde de l’an prochain suit la force actuelle de l’équipe d’origine (la plus faible choisit en premier); les années suivantes, le milieu de
            la ronde. Propriétaires des choix lus en direct sur Fantrax.
          </p>
          <p>
            <strong className="text-white">Actions.</strong> La fenêtre d’une équipe vient de sa force cette saison (premier tiers : Aspirant; sinon premier tiers pour l’avenir : En montée; seconde moitié des deux : Reconstruction). « Vendre haut » quand le marché le paie nettement plus que sa valeur pour la ligue;{" "}
            {kind === "keeper" ? "« Échanger avant l’écrémage » quand il risque de ne pas être protégé; " : ""}« Vendre maintenant » pour un joueur dont la
            valeur est surtout immédiate dans une équipe en reconstruction; « Remplaçable » quand un joueur disponible vaut autant.
          </p>
        </div>
      </LeagueCard>
    </div>
  );
}
