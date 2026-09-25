import { BookOpen } from "lucide-react";
import { FOOTER_SOURCE_HREF } from "@/lib/site-footer";
import {
  SNAKE_ATTRIBUTION_POLICY,
  SNAKE_DISCLAIMER_FULL,
  formatCountFr,
  formatSnakeDate,
  plural,
} from "@/lib/snake/copy";
import type { SnakeStats } from "@/lib/snake/types";

/** « Sources et méthode »: full disclaimer, how it is built, counts (server-rendered). */
export function SnakeMethodology({ stats, builtAt }: { stats: SnakeStats; builtAt: string }) {
  const f = stats.filtered;
  const droppedOpinions = f.opinionsUncertainAttribution + f.opinionsLowNameConfidence + f.opinionsInvalid;
  return (
    <section id="sources" aria-labelledby="sources-titre" className="scroll-mt-4 space-y-5">
      <div className="flex items-center gap-2 text-slate-200">
        <BookOpen className="h-5 w-5" aria-hidden="true" />
        <h2 id="sources-titre" tabIndex={-1} className="text-2xl font-semibold text-white focus:outline-none">
          Sources et méthode
        </h2>
      </div>

      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4 sm:p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-200">Avertissement</h3>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-200">
          {SNAKE_DISCLAIMER_FULL.map((p) => (
            <p key={p}>{p}</p>
          ))}
          <p>{SNAKE_ATTRIBUTION_POLICY}</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-2 text-sm leading-relaxed text-slate-300">
          <h3 className="text-base font-semibold text-white">Comment c&apos;est fait</h3>
          <ol className="list-decimal space-y-1.5 pl-5 marker:text-slate-500">
            <li>
              {`Les sous-titres automatiques de ${plural(stats.videos, "vidéo publique", "vidéos publiques")} de balados ont été lus automatiquement pour repérer les passages où Snake parle d'un joueur (il est présent dans ${formatCountFr(stats.videosWithSnake)} d'entre elles).`}
            </li>
            <li>
              {
                "Chaque passage est résumé en français, en paraphrase, avec son contexte, sa date, l'émission et le moment de la vidéo. Aucune transcription n'est publiée, et un contrôle écarte ou fait reformuler tout résumé qui reprend une longue suite de mots des sous-titres."
              }
            </li>
            <li>
              {
                "L'attribution de chaque passage à Snake est évaluée (certaine, probable ou incertaine), ainsi que la fiabilité du nom du joueur, souvent déformé par les sous-titres. Des cas repérés à la main (homonymes, frères confondus) sont corrigés ou retirés."
              }
            </li>
            <li>
              {
                "Une synthèse par joueur (verdict, tendance, projection, forces, faiblesses, comparables) est ensuite générée automatiquement à partir de ses opinions. Si certaines de ces opinions ne sont pas publiées, la synthèse est abrégée : tout passage qui ne repose que sur elles en est retiré. Si trop de ses sources sont écartées, elle est remplacée par une opinion publiée (la plus récente dont l'attribution est certaine)."
              }
            </li>
          </ol>
          <p className="text-xs text-slate-400">
            Données mises à jour le <time dateTime={builtAt}>{formatSnakeDate(builtAt.slice(0, 10))}</time>. Une erreur,
            un propos mal attribué ou une demande de retrait?{" "}
            <a
              href={`${FOOTER_SOURCE_HREF}/issues`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center rounded-sm text-cyan-400 underline underline-offset-2 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            >
              Signalez-le sur GitHub<span className="sr-only"> (nouvel onglet)</span>
            </a>
            .
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="text-base font-semibold text-white">En chiffres</h3>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              ["Joueurs publiés", stats.players],
              ["Opinions publiées", stats.opinions],
              ["dont attribution probable", stats.probableOpinions],
              ["Vidéos citées", stats.citedVideos],
              ["Classements", stats.rankings],
              ["Opinions retirées", droppedOpinions],
            ].map(([label, n]) => (
              <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <dt className="text-xs text-slate-400">{label}</dt>
                <dd className="text-lg font-semibold tabular-nums text-white">{formatCountFr(Number(n))}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-slate-400">
            {`Retirés par les filtres : ${plural(f.opinionsUncertainAttribution, "opinion", "opinions")} à l'attribution incertaine, ${plural(f.opinionsLowNameConfidence, "opinion", "opinions")} dont le joueur est douteux ou mal identifié, ${plural(f.playersWithoutPublishableOpinion, "joueur", "joueurs")} sans opinion publiable, ${plural(f.rankingsWithheld, "classement", "classements")} aux rangs déduits, rapportés ou imprécis; ${plural(f.synthesesTrimmed, "synthèse abrégée", "synthèses abrégées")}, ${plural(f.synthesesWithheld, "synthèse retirée", "synthèses retirées")}. Opinions publiées du ${formatSnakeDate(stats.firstDate)} au ${formatSnakeDate(stats.lastDate)}.`}
          </p>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <caption className="sr-only">Opinions publiées par émission</caption>
              <thead className="bg-white/5 text-left text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Émission
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Vidéos
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Opinions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {stats.byShow.map((s) => (
                  <tr key={s.show}>
                    <th scope="row" className="px-3 py-2 text-left font-normal text-slate-200">
                      {s.show}
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-300">{formatCountFr(s.videos)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-300">{formatCountFr(s.opinions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
