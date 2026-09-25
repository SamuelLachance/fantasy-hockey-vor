import type { Metadata } from "next";
import { LegacyRedirect, legacyRule } from "@/components/site/LegacyRedirect";
import { legacyTarget } from "@/lib/leagues/legacy";

// The old Captains Dynasty address (bookmarked): a static stub that sends
// the visitor to the league's tab, query and hash included (`?team=`,
// `?vue=`, `#alignement`…). No server redirects on GitHub Pages.
const target = legacyTarget(legacyRule("/league"), "", "");

export const metadata: Metadata = {
  title: "Cette page a déménagé",
  description: "L’aide quotidienne Fantrax se trouve maintenant dans l’espace de la ligue Captains Dynasty.",
  alternates: { canonical: target },
  robots: { index: false, follow: true },
};

export default function LeagueLegacyPage() {
  return <LegacyRedirect from="/league" />;
}
