import Link from "next/link";
import { AlertTriangle, ArrowRight, CircleAlert, ExternalLink, Info } from "lucide-react";
import type { ReactNode } from "react";
import { Countdown } from "@/components/site/Countdown";
import type { HomeAlert, HomeCardData } from "@/lib/leagues/home-summary";
import { leagueTabPath } from "@/lib/leagues/routes";

const ACCENT: Record<HomeCardData["accent"], string> = {
  cyan: "text-cyan-300",
  violet: "text-violet-300",
};

const LEVEL: Record<HomeAlert["level"], { icon: ReactNode; cls: string; sr: string }> = {
  error: {
    icon: <CircleAlert className="h-4 w-4 shrink-0 text-rose-300" aria-hidden="true" />,
    cls: "border-rose-500/40 bg-rose-500/10 text-rose-50",
    sr: "Urgent : ",
  },
  warn: {
    icon: <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />,
    cls: "border-amber-500/30 bg-amber-500/10 text-amber-50",
    sr: "À voir : ",
  },
  info: {
    icon: <Info className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />,
    cls: "border-white/10 bg-white/[0.03] text-slate-200",
    sr: "",
  },
};

/** One league on « Mes ligues »: what needs attention today and a link to each tab. */
export function LeagueHomeCard({ card, children }: { card: HomeCardData; children?: ReactNode }) {
  const headingId = `ligue-${card.slug}`;
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-4 rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-4 sm:p-6"
    >
      <div className="flex flex-col gap-1">
        <p className={`text-xs font-medium uppercase tracking-[0.18em] ${ACCENT[card.accent]}`}>
          {card.chips.map((c, i) => (
            <span key={c}>
              {i === 2 ? (
                <abbr title={card.scoringTitle} className="no-underline">
                  {c}
                </abbr>
              ) : (
                c
              )}
              {i < card.chips.length - 1 ? <span aria-hidden="true"> · </span> : null}
              {i < card.chips.length - 1 ? <span className="sr-only">, </span> : null}
            </span>
          ))}
        </p>
        <h2 id={headingId} className="text-xl font-bold tracking-tight text-white sm:text-2xl">
          <Link
            href={leagueTabPath(card.slug, card.defaultTab, card.search)}
            prefetch={false}
            className="rounded-md hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            {card.title}
          </Link>
        </h2>
        {card.myTeam ? (
          <p className="text-sm text-slate-400">
            Mon équipe : <span className="font-medium text-slate-200">{card.myTeam}</span>
          </p>
        ) : null}
      </div>

      {card.dates.length > 0 ? (
        <dl className="grid gap-1 text-sm">
          {card.dates.map((d) => (
            <div key={d.label} className="flex flex-wrap gap-x-2">
              <dt className="text-slate-400">{d.label} :</dt>
              <dd className="text-slate-100">
                <time dateTime={d.iso}>{d.text}</time>{" "}
                <Countdown iso={d.iso} pastLabel={d.pastLabel} endIso={d.endIso} endLabel={d.endLabel} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {children}

      {card.note ? (
        <p className="text-sm">
          <Link
            href={`${leagueTabPath(card.slug, card.note.tab, card.search)}${card.note.hash ? `#${card.note.hash}` : ""}`}
            prefetch={false}
            className="inline-flex min-h-11 items-start gap-2 rounded-md text-slate-200 underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            <span className="min-w-0 flex-1">{card.note.text}</span>
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
          </Link>
        </p>
      ) : null}

      {card.alerts.length > 0 ? (
        <div>
          {card.syncedText ? <p className="mb-2 text-xs text-slate-400">{card.syncedText} :</p> : null}
          <ul className="space-y-2">
            {card.alerts.map((a, i) => {
              const lv = LEVEL[a.level];
              return (
                <li key={i} className={`rounded-xl border px-3 py-2 text-sm ${lv.cls}`}>
                  <Link
                    href={`${leagueTabPath(card.slug, a.tab, card.search)}${a.hash ? `#${a.hash}` : ""}`}
                    prefetch={false}
                    className="flex min-h-11 items-start gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                  >
                    <span className="mt-0.5">{lv.icon}</span>
                    <span className="min-w-0 flex-1">
                      {lv.sr ? <span className="sr-only">{lv.sr}</span> : null}
                      {a.text}
                    </span>
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : card.syncedText ? (
        <p className="text-sm text-emerald-200">{card.syncedText} : rien d’urgent.</p>
      ) : null}

      <nav aria-label={`Onglets de ${card.title}`} className="mt-auto">
        <ul className="flex flex-wrap gap-2">
          {card.tabs.map((t) => (
            <li key={t.tab}>
              <Link
                href={leagueTabPath(card.slug, t.tab, card.search)}
                prefetch={false}
                className="inline-flex min-h-11 items-center rounded-full border border-white/10 bg-white/5 px-3 text-sm text-slate-200 transition motion-reduce:transition-none hover:border-cyan-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                {t.label}
              </Link>
            </li>
          ))}
          {card.externalUrl ? (
            <li>
              <a
                href={card.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm text-cyan-300 underline-offset-2 hover:text-cyan-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                {card.platform}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only"> (nouvel onglet)</span>
              </a>
            </li>
          ) : null}
        </ul>
      </nav>
    </section>
  );
}
