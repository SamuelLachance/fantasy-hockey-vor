import {
  FOOTER_SOURCE_HREF,
  footerDisclaimerCopy,
  footerSourceLinkAriaLabel,
  footerSourceLinkCopy,
  footerSourcesCopy,
} from "@/lib/site-footer";

/** Global footer on every page (French). */
export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-white/10 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] text-center text-xs text-slate-400 sm:px-6 lg:px-8">
      <p className="mx-auto max-w-4xl">
        {footerDisclaimerCopy()}
        <span className="mx-2 text-slate-600" aria-hidden="true">
          ·
        </span>
        {footerSourcesCopy()}
        <span className="mx-2 text-slate-600" aria-hidden="true">
          ·
        </span>
        <a
          href={FOOTER_SOURCE_HREF}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={footerSourceLinkAriaLabel()}
          className="inline-flex min-h-11 items-center rounded-sm text-cyan-400/90 underline-offset-2 transition motion-reduce:transition-none hover:text-cyan-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
        >
          {footerSourceLinkCopy()}
        </a>
      </p>
    </footer>
  );
}
