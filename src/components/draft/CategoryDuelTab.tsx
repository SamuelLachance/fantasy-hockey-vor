import Link from "next/link";
import { ArrowRight, Swords } from "lucide-react";
import { leagueTabPath } from "@/lib/leagues/routes";

/** Light the Lamp · Duel de la semaine: why it is not there yet (static). */
export function CategoryDuelTab({ slug }: { slug: string }) {
  return (
    <section
      aria-labelledby="duel-bientot"
      className="max-w-3xl space-y-4 rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-4 text-sm text-slate-300 sm:p-6"
    >
      <h2 id="duel-bientot" className="flex items-center gap-2 text-lg font-semibold text-white">
        <Swords className="h-5 w-5 text-violet-300" aria-hidden="true" />
        Bientôt
      </h2>
      <p>Votre duel, catégorie par catégorie, avec les matchs restants de chaque équipe.</p>
      <p>
        <span className="font-semibold text-white">Pourquoi pas encore ?</span> La ligue Light the Lamp est privée : pour
        lire votre adversaire et vos alignements, l’outil doit passer par l’API de Yahoo Fantasy, avec une application
        approuvée par Yahoo et votre autorisation (OAuth). Le site est statique et ne garde aucun mot de passe : une
        tâche planifiée (comme la synchronisation Fantrax) lirait la semaine et publierait un résumé sans donnée
        personnelle.
      </p>
      <p>
        En attendant : vos forces par catégorie sont dans l’onglet{" "}
        <Link
          href={leagueTabPath(slug, "mon-equipe")}
          prefetch={false}
          className="inline-flex min-h-11 items-center gap-1 rounded-md font-semibold text-cyan-300 underline-offset-2 hover:text-cyan-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          Mon équipe
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        .
      </p>
    </section>
  );
}
