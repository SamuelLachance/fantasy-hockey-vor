import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { presetLinkHref, type PresetId } from "@/lib/fantrax/explorer";

/**
 * « Voir dans l'explorateur » link from another panel. A plain link to the
 * same page with the preset in the query (works without JavaScript); a
 * plain click applies the preset in place and jumps to the explorer.
 */
export function ExploreLink({
  preset,
  onExplore,
  search = "",
  children,
}: {
  preset: PresetId;
  onExplore?: (preset: PresetId) => void;
  /** Query to keep in the link (`?team=…` for a non-default team). */
  search?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={presetLinkHref(preset, search)}
      onClick={(e) => {
        if (!onExplore || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onExplore(preset);
      }}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-cyan-300 underline-offset-2 transition motion-reduce:transition-none hover:text-cyan-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
    >
      {children}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </a>
  );
}
