import { boardShortcutsFooterChip } from "@/lib/board-shortcuts";
import {
  DEFAULT_PROJECTION_ENGINE,
  formatProjectionEngine,
} from "@/lib/projection-engine-label";
import {
  FOOTER_SOURCE_HREF,
  footerDraftableCopy,
  footerGeneratedPrefixCopy,
  footerNhlApiCopy,
  footerSourceLinkAriaLabel,
  footerSourceLinkCopy,
  footerSourceLinkTitle,
} from "@/lib/site-footer";

interface SiteFooterProps {
  season: string;
  generatedAt: string;
  playerCount: number;
  projectionEngine?: string;
}

/** Site-wide rankings footer: provenance, source, shortcuts, pool size. */
export function SiteFooter({
  season,
  generatedAt,
  playerCount,
  projectionEngine,
}: SiteFooterProps) {
  return (
    <footer className="border-t border-white/10 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] text-center text-xs text-slate-400">
      {footerGeneratedPrefixCopy()}{" "}
      <time dateTime={generatedAt}>
        {new Date(generatedAt).toISOString().slice(0, 10)}
      </time>{" "}
      · {season} ·{" "}
      {formatProjectionEngine(
        projectionEngine ?? DEFAULT_PROJECTION_ENGINE,
      )}{" "}
      · {footerNhlApiCopy()}
      {" · "}
      <a
        href={FOOTER_SOURCE_HREF}
        target="_blank"
        rel="noopener noreferrer"
        title={footerSourceLinkTitle()}
        aria-label={footerSourceLinkAriaLabel()}
        className="inline-flex min-h-11 items-center rounded-sm text-cyan-500/80 underline-offset-2 transition hover:text-cyan-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
      >
        {footerSourceLinkCopy()}
      </a>
      <span className="mx-2 text-slate-700">·</span>
      <span className="text-slate-400">{boardShortcutsFooterChip()}</span>
      <span className="mx-2 text-slate-700">·</span>
      <span className="tabular-nums text-slate-400">
        {footerDraftableCopy(playerCount)}
      </span>
    </footer>
  );
}
