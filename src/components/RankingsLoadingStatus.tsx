import { BrandEyebrow } from "@/components/BrandEyebrow";
import { loadingRankingsCopy } from "@/lib/app-shell-copy";

interface RankingsLoadingStatusProps {
  /** Extra classes on the outer status container. */
  className?: string;
}

/** Shared busy UI for route loading and RankingsTable Suspense fallback. */
export function RankingsLoadingStatus({
  className = "",
}: RankingsLoadingStatusProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-4 text-center ${className}`.trim()}
      role="status"
      aria-busy="true"
    >
      <BrandEyebrow className="text-xs text-cyan-400/80" />
      <div
        className="h-1 w-40 overflow-hidden rounded-full bg-white/10"
        aria-hidden
      >
        <div className="h-full w-1/2 animate-pulse rounded-full bg-cyan-400/60 motion-reduce:animate-none" />
      </div>
      <p className="text-sm text-slate-400">{loadingRankingsCopy()}</p>
    </div>
  );
}
