"use client";

import { ChevronRight } from "lucide-react";
import { capGrowthText, fmtMoney } from "@/lib/fantrax/salary-copy";
import { withBasePath } from "@/lib/site";
import { useFantraxLeague } from "./fantrax-league-context";

/** Under the Repêchage table: the stand-alone live draft page (public/slapshot-draft.html). */
export function SlapshotLightPageLink() {
  return (
    <p className="text-xs text-slate-400">
      Sur un téléphone lent ou pendant une longue séance :{" "}
      <a
        href={withBasePath("/slapshot-draft.html")}
        className="text-cyan-300 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
      >
        la page légère du repêchage en direct
      </a>{" "}
      (mêmes valeurs, relue toutes les 20 secondes).
    </p>
  );
}

const NBSP = " ";
const num = (x: number, d = 2) => x.toFixed(d).replace(".", ",");

/**
 * « Méthode » of a salary-cap dynasty league (Slapshot), folded: what the
 * dynasty value is, and every assumption behind the cap numbers — the cap's
 * growth (the one knob, from the contracts file), the league minimum salary,
 * the entry-level deal of a prospect without a contract, the cap's shadow
 * price λ, the roster-spot rent, and the roster rules.
 */
export function SlapshotMethodNote({ id = "methode" }: { id?: string }) {
  const { bundle, config } = useFantraxLeague();
  const c = bundle?.contracts ?? null;
  const L = config.limits;
  const cap = config.salaryCap;
  if (!cap) return null;
  return (
    <details id={id} className="group rounded-2xl border border-white/10 bg-white/[0.03] text-sm text-slate-300">
      <summary className="flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-2xl px-4 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
        <ChevronRight
          className="h-4 w-4 shrink-0 text-slate-400 transition-transform motion-reduce:transition-none group-open:rotate-90"
          aria-hidden="true"
        />
        Méthode et hypothèses
      </summary>
      <ul className="list-disc space-y-1.5 border-t border-white/10 px-8 py-3">
        <li>
          <strong className="text-slate-100">Valeur dynastie</strong>
          {`${NBSP}: les points de fantasy au-dessus du remplacement que le joueur devrait rapporter sur les 12 prochaines saisons (barème Slapshot${NBSP}: but 3,5, passe 2,5, point en avantage numérique 0,5, but en infériorité 1, tir 0,25, mises en échec et tirs bloqués 0; gardiens${NBSP}: victoire 3, arrêt 0,25, but accordé −1, blanchissage 5, passe 3), moins le coût de son salaire sous le plafond. Chaque saison, son propriétaire le fait jouer (valeur moins coût) ou l’envoie aux mineures (0 point, 0${NBSP}$). Carrières simulées (vieillissement, progression des jeunes, chances LNH des espoirs).`}
        </li>
        <li>
          <strong className="text-slate-100">Horizons</strong>
          {`${NBSP}: Gagner maintenant, Équilibré et Long terme sont la même projection, les saisons lointaines pesant de moins en moins (Gagner maintenant) ou presque autant que la prochaine (Long terme).`}
        </li>
        <li>
          <strong className="text-slate-100">Plafond salarial</strong>
          {`${NBSP}: ${fmtMoney(cap.base)} en ${cap.firstSeason}-${String((cap.firstSeason + 1) % 100).padStart(2, "0")}, compté seulement sur les ${cap.countedSpots} joueurs Actifs + Réserve (mineures et blessés hors plafond). `}
          {c ? capGrowthText(c) : "Croissance : le plafond de la LNH, puis une hausse annuelle supposée."}
        </li>
        <li>
          <strong className="text-slate-100">Salaire</strong>
          {`${NBSP}: la moyenne annuelle réelle de son contrat LNH pour la saison (source${NBSP}: capwages); après l’échéance, son prochain contrat est projeté (la moyenne des contrats signés depuis 2023 par des joueurs de même niveau, âge et statut JAS ou JAC, vedettes comprises) et affiché en italique; un espoir sans contrat LNH ne compte rien avant son arrivée prévue. Salaire minimum de la ligue${NBSP}: ${c ? fmtMoney(c.min[0]!) : `0,85${NBSP}M$`}, qui croît avec le plafond.`}
        </li>
        <li>
          <strong className="text-slate-100">Espoirs sans contrat LNH</strong>
          {`${NBSP}: contrat d’entrée supposé de ${fmtMoney(c?.elc?.capHit ?? 0.975)} pour ${c?.elc?.years ?? 3} saisons à partir de leur arrivée prévue; aux mineures d’ici là, ils ne coûtent rien.`}
        </li>
        <li>
          <strong className="text-slate-100">Prix du plafond (λ)</strong>
          {c
            ? `${NBSP}: ${num(c.lambda[0]!)} point par M$ au-dessus du minimum en ${cap.firstSeason}-${String((cap.firstSeason + 1) % 100).padStart(2, "0")}, ${num(c.lambda[1] ?? 0)} ensuite (moins contraignant à mesure que le plafond monte et que les contrats projetés remplacent les vrais). Estimé en simulant le repêchage des ${config.teams} équipes : les points qu’une équipe au-dessus du plafond perd par M$ économisé en remplaçant des partants.`
            : `${NBSP}: les points qu’une équipe au-dessus du plafond perd par M$ économisé.`}
        </li>
        {c?.rosterSpot ? (
          <li>
            <strong className="text-slate-100">Place dans l’effectif</strong>
            {`${NBSP}: garder un joueur coûte environ ${num(c.rosterSpot, 1)} points par saison à partir de 2027-28 (la valeur du dernier joueur gardé parmi les ${config.teams} × ${L.maxTotal ?? 40} places de la ligue); sous ce seuil, le modèle le libère.`}
          </li>
        ) : null}
        <li>
          <strong className="text-slate-100">Effectif</strong>
          {`${NBSP}: C4 LW4 RW4 D6 G2 actifs + ${L.maxReserve} réserve, ${L.maxTotal ?? 40} joueurs au plus (hors IR), IR ${L.maxIr}, mineures ${L.maxMinors} (tout joueur). Les alignements se verrouillent ${config.cadence.lock?.minutesBefore ?? 5} minutes avant chaque match. Remplacement${NBSP}: le dernier partant d’un remplissage optimal des ${config.teams * L.maxActive} postes partants de la ligue.`}
        </li>
        <li>
          {`Hypothèses à confirmer par le commissaire${NBSP}: la croissance du plafond, le traitement d’un espoir sans contrat, et que les 40 places excluent l’IR.`}
        </li>
      </ul>
    </details>
  );
}
