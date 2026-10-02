import type { Metadata } from "next";
import { Suspense } from "react";
import { PlayerCardView } from "@/components/player-card/PlayerCardView";
import { LEAGUES } from "@/lib/leagues/registry";
import { SITE_BRAND } from "@/lib/site";

const title = "Fiche de joueur";
const description =
  "La fiche d’un joueur : identité, contrat, projection de la saison, carrière, et sa place dans chacune de vos ligues (propriétaire, valeur dynastie, score d’actif, contrat de ligue, rang).";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/joueur" },
  robots: { index: false, follow: false },
  openGraph: { title: `${title} | ${SITE_BRAND}`, description, url: "/joueur", siteName: SITE_BRAND, type: "website", locale: "fr_CA" },
  twitter: { card: "summary", title: `${title} | ${SITE_BRAND}`, description },
};

/** One card per player (/joueur?id=<NHL id>), filled in the browser from its data shard. */
export default function PlayerPage() {
  const leagues = LEAGUES.map((l) => ({ slug: l.slug, name: l.shortName, myTeamId: l.myTeamId, kind: l.kind }));
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 pb-[max(4rem,calc(env(safe-area-inset-bottom,0px)+3rem))] sm:px-6 lg:px-8">
      <Suspense fallback={<h1 className="text-2xl font-bold text-white">Fiche de joueur</h1>}>
        <PlayerCardView leagues={leagues} />
      </Suspense>
    </div>
  );
}
