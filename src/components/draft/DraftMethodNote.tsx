import type { DraftBoard } from "@/lib/draft/board-types";
import {
  CATEGORY_SHORT,
  DRAFT_SHORTCUTS,
  formatDateFr,
  formatFr,
  formatSignedFr,
} from "@/lib/draft/draft-copy";

/** "1er", "15e" (French ordinal for ranks). */
function ordinal(rank: number | null): string {
  if (rank == null) return "—";
  return rank === 1 ? "1er" : `${rank}e`;
}

/**
 * How the board is built (French), plus the draft helper's keyboard
 * shortcuts (`shortcuts`, on by default: the Joueurs tab has no use for them).
 */
export function DraftMethodNote({
  board,
  shortcuts = true,
  summary = "Comment ce classement est calculé",
}: {
  board: DraftBoard;
  shortcuts?: boolean;
  summary?: string;
}) {
  const gw = board.goalieWeight;
  const cats = [...board.categories.skater, ...board.categories.goalie].map((c) => CATEGORY_SHORT[c]);
  const skaterIndex = (c: string) => (board.categories.skater as readonly string[]).indexOf(c);
  const dBlk = board.skaterGroupOffset.D[skaterIndex("blocks")] ?? 0;
  const dGoals = board.skaterGroupOffset.D[skaterIndex("goals")] ?? 0;
  return (
    <div className="space-y-3">
      {shortcuts ? (
      <details className="group rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300 sm:p-4">
        <summary className="cursor-pointer select-none font-semibold text-slate-200">
          Raccourcis clavier
        </summary>
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
          {DRAFT_SHORTCUTS.map((s) => (
            <div key={s.keys} className="contents">
              <dt>
                <kbd className="rounded border border-white/20 bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] text-slate-100">
                  {s.keys}
                </kbd>
              </dt>
              <dd className="text-slate-400">{s.label}</dd>
            </div>
          ))}
        </dl>
      </details>
      ) : null}

      <details className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300 sm:p-4">
        <summary className="cursor-pointer select-none font-semibold text-slate-200">
          {summary}
        </summary>
        <div className="mt-3 space-y-2 text-xs leading-relaxed text-slate-400">
          <p>
            <strong className="text-slate-200">Projections</strong> : celles du site (ensemble
            ML, saison {board.season}), admissibilités Yahoo. Seules les {cats.length} catégories de la ligue
            comptent : {cats.join(", ")} — pas de PIM ni de mises au jeu.
          </p>
          <p>
            <strong className="text-slate-200">Valeur</strong> : chaque catégorie vaut un point de match, donc
            une cote z par catégorie, à poids égal, mesurée contre les joueurs réellement repêchés. Les cotes des
            patineurs ont un centre commun (attaquants et défenseurs se disputent le poste Util) : un défenseur
            part avec environ {formatSignedFr(dBlk, 1)} en BLK et {formatSignedFr(dGoals, 1)} en G par rapport
            à ce centre. Ce décalage de groupe compte dans sa valeur, mais les petites barres de chaque joueur
            montrent l’écart avec ses pairs (attaquants, défenseurs ou gardiens) : c’est là que l’on voit s’il
            aide ou nuit dans une catégorie. HIT et BLK sont plafonnés en douceur (tanh, 2,75 z au-dessus des
            pairs) : un frappeur à 250 mises en échec ne dépasse pas un marqueur d’élite.
          </p>
          <p>
            <strong className="text-slate-200">Gardiens</strong> : SV% compte en arrêts au-dessus de la
            moyenne (le volume compte : ,915 sur 55 matchs pèse plus que ,918 sur 20), GAA en buts évités
            par rapport à la moyenne sur les matchs joués (buts alloués = arrêts ÷ SV% − arrêts). Les
            blanchissages projetés sont arrondis à l’entier ; ils sont lissés (moitié projection, moitié
            matchs joués × probabilité de blanchissage selon la GAA), d’où les décimales. La valeur d’un
            gardien est multipliée par {formatFr(gw.weight, 2)} = levier hebdomadaire{" "}
            {formatFr(gw.leverageRatio, 2)} (calculé : deux gardiens portent 4 catégories, douze patineurs se
            partagent les 6 autres ; le minimum de {board.league.minGoalieAppearancesPerWeek} départs fixe le
            volume) × prévisibilité {formatFr(gw.predictabilityRatio, 2)}. Ce second facteur est un choix de
            modèle : les projections de gardiens battent à peine la moyenne, celles des patineurs expliquent
            75 à 85 % de la variance, et l’escompte (0,75 + 0,25 × R² par catégorie) est appliqué tel quel.
            Sensibilité : escompte adouci de moitié ({formatFr(gw.alt.predictabilityRatio, 2)},
            poids {formatFr(gw.alt.weight, 2)}), le premier gardien passerait du {ordinal(gw.firstGoalieRank)} au{" "}
            {ordinal(gw.alt.firstGoalieRank)} rang ({gw.goaliesInTop100} → {gw.alt.goaliesInTop100} gardiens
            dans le top 100).
          </p>
          <p>
            <strong className="text-slate-200">Remplacement (VOR)</strong> : on remplit de façon optimale les
            alignements des {board.league.teams} équipes (C, LW, RW, F, D, Util, G) en tenant compte des
            admissibilités multiples et des postes flexibles (F = tout attaquant, Util = tout patineur), puis
            les bancs (un 3<sup>e</sup> gardien et 3 patineurs par équipe). Le remplaçant à un poste est le
            meilleur joueur laissé au ballottage, ou celui d’un poste flexible quand ce poste y aligne déjà un
            joueur admissible (perdre un centre, c’est faire glisser le centre du poste F et prendre le
            meilleur attaquant libre) ; VOR = valeur − remplaçant au meilleur poste.
          </p>
          <p>
            <strong className="text-slate-200">Suggestions</strong> : gain réel pour votre alignement (un poste
            n’est occupé que si le joueur bat le remplaçant ; sinon il va au banc, qui ne vaut qu’une part de
            sa valeur), + la moitié de l’écart avec le meilleur joueur attendu au même poste à votre choix
            suivant (rareté), + un petit bonus pour ce qu’il ajoute dans vos catégories faibles par rapport au
            joueur moyen du poste qu’il occupe.
          </p>
          <p>
            <strong className="text-slate-200">ADP</strong> : ADP publique Fantrax du{" "}
            {formatDateFr(board.source.adpFetchedAt)}, surtout des ligues à points — un proxy approximatif du
            marché d’une ligue Yahoo à catégories (les frappeurs y sont souvent sous-estimés). Sans ADP, la
            disponibilité utilise notre rang, avec plus d’incertitude.
          </p>
        </div>
      </details>
    </div>
  );
}
