"use client";

import { Link2 } from "lucide-react";
import {
  boardLinkAriaLabel,
  boardLinkButtonLabel,
  boardLinkTitle,
} from "@/lib/copy-flash";

interface RankingsBoardLinkButtonProps {
  linkCopied: boolean;
  linkCopyFailed?: boolean;
  onCopyBoardLink: () => void;
}

/** Toolbar control to copy the current board share URL (l). */
export function RankingsBoardLinkButton({
  linkCopied,
  linkCopyFailed = false,
  onCopyBoardLink,
}: RankingsBoardLinkButtonProps) {
  return (
    <button
      type="button"
      onClick={onCopyBoardLink}
      className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
      title={boardLinkTitle()}
      aria-label={boardLinkAriaLabel(linkCopied, linkCopyFailed)}
      aria-keyshortcuts="l"
      aria-live="polite"
    >
      <Link2 className="h-4 w-4" aria-hidden />
      {boardLinkButtonLabel(linkCopied, linkCopyFailed)}
    </button>
  );
}
