import type { Metadata } from "next";
import Link from "next/link";
import { BrandEyebrow } from "@/components/BrandEyebrow";
import { RecoveryEffect } from "@/components/site/RecoveryEffect";
import { RecoveryScript } from "@/components/site/RecoveryScript";
import { errorBackHomeCopy, notFoundBody, notFoundTitle } from "@/lib/app-shell-copy";
import { LEAGUES } from "@/lib/leagues/registry";
import { homeHref, leagueTabPath } from "@/lib/leagues/routes";

export const metadata: Metadata = {
  title: notFoundTitle(),
  description: notFoundBody(),
  robots: { index: false, follow: true },
};

/**
 * `404.html`: GitHub Pages serves it for any unknown address. The recovery
 * script first sends old bookmarks on (`/league/`, `/snake/`, a league
 * without its tab…); anything else lands here.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <RecoveryScript />
      <RecoveryEffect />
      <BrandEyebrow />
      <h1 className="text-3xl font-bold text-white">{notFoundTitle()}</h1>
      <p className="max-w-md text-slate-400">{notFoundBody()}</p>
      <ul className="flex flex-wrap items-center justify-center gap-2">
        <li>
          <a
            href={homeHref()}
            className="inline-flex min-h-11 items-center rounded-full bg-cyan-500 px-5 text-sm font-semibold text-slate-950 transition motion-reduce:transition-none hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          >
            {errorBackHomeCopy()}
          </a>
        </li>
        {LEAGUES.map((l) => (
          <li key={l.slug}>
            <Link
              href={leagueTabPath(l.slug, l.defaultTab)}
              prefetch={false}
              className="inline-flex min-h-11 items-center rounded-full border border-white/15 bg-white/5 px-5 text-sm font-medium text-slate-200 transition motion-reduce:transition-none hover:border-cyan-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              {l.shortName}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
