"use client";

import Link from "next/link";
import { Info } from "lucide-react";
import { SNAKE_DISCLAIMER_SHORT } from "@/lib/snake/copy";
import { SNAKE_PATH } from "@/lib/snake/url";

const LINK_CLASS =
  "rounded-sm text-cyan-400/90 underline underline-offset-2 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80";

/**
 * Short French disclaimer shown next to every piece of Snake content, with
 * a link to the full methodology on /snake. `lang="fr-CA"` so it reads
 * correctly on the English board.
 */
export function SnakeDisclaimerShort({
  className = "",
  withLink = true,
  inPage = false,
}: {
  className?: string;
  /** Link to the methodology. */
  withLink?: boolean;
  /**
   * On /snake itself: jump to the section in place. A next/link to
   * /snake#sources would soft-navigate away from `?p=` while the player
   * view stays on screen, so the address no longer matches the view.
   */
  inPage?: boolean;
}) {
  return (
    <p lang="fr-CA" className={`flex gap-1.5 text-xs leading-relaxed text-slate-400 ${className}`.trim()}>
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
      <span>
        {SNAKE_DISCLAIMER_SHORT}
        {withLink ? (
          <>
            {" "}
            {inPage ? (
              <a
                href="#sources"
                onClick={(e) => {
                  const target = document.getElementById("sources");
                  if (!target || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  target.scrollIntoView({ block: "start" });
                  const heading = document.getElementById("sources-titre");
                  heading?.focus({ preventScroll: true });
                }}
                className={LINK_CLASS}
              >
                Méthode et sources
              </a>
            ) : (
              <Link href={`${SNAKE_PATH}#sources`} prefetch={false} className={LINK_CLASS}>
                Méthode et sources
              </Link>
            )}
          </>
        ) : null}
      </span>
    </p>
  );
}
