import { ArrowRight } from "lucide-react";
import { LEGACY_RULES, legacyTarget, type LegacyRule } from "@/lib/leagues/legacy";
import { TAB_META, getLeague } from "@/lib/leagues/registry";
import { withBasePath } from "@/lib/site";
import { RecoveryEffect } from "./RecoveryEffect";
import { RecoveryScript } from "./RecoveryScript";

const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function legacyRule(from: LegacyRule["from"]): LegacyRule {
  const rule = LEGACY_RULES.find((r) => r.from === from);
  if (!rule) throw new Error(`No legacy rule for ${from}`);
  return rule;
}

/**
 * An old address kept alive under static export: an inline script sends
 * the visitor on at once (query and hash kept, e.g. `?team=`), a raw
 * `<noscript>` refresh covers browsers without JavaScript, `RecoveryEffect`
 * covers client-side arrivals, and the visible link covers everything else.
 */
export function LegacyRedirect({ from }: { from: LegacyRule["from"] }) {
  const rule = legacyRule(from);
  const target = legacyTarget(rule, "", "");
  const league = getLeague(rule.slug);
  const href = withBasePath(target);
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-2xl flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <RecoveryScript />
      {/* Raw HTML, so React cannot hoist the <meta> out of <noscript>. */}
      <noscript dangerouslySetInnerHTML={{ __html: `<meta http-equiv="refresh" content="0;url=${escapeAttr(href)}">` }} />
      <RecoveryEffect />
      <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Cette page a déménagé</h1>
      <p className="text-base text-slate-300">
        Elle se trouve maintenant dans{" "}
        <a
          href={href}
          className="inline-flex min-h-11 items-center gap-1 rounded-sm font-semibold text-cyan-300 underline underline-offset-2 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          {league?.shortName ?? "la ligue"} › {TAB_META[rule.tab].label}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </a>
        . Mettez votre favori à jour.
      </p>
    </div>
  );
}
