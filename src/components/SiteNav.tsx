import Link from "next/link";
import { siteNavAriaLabel, siteNavLinks } from "@/lib/site-nav";

/** Links to the other pages of the site (/league, /snake). */
export function SiteNav({ className = "" }: { className?: string }) {
  return (
    <nav aria-label={siteNavAriaLabel()} className={className}>
      <ul className="flex flex-wrap items-center gap-2">
        {siteNavLinks().map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              hrefLang={l.hrefLang}
              title={l.title}
              prefetch={false}
              className="inline-flex min-h-11 items-center rounded-full border border-white/10 bg-white/5 px-3 text-sm text-slate-300 transition motion-reduce:transition-none hover:border-cyan-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
