import { copyText } from "@/lib/clipboard";

export type CopyFlash = "idle" | "ok" | "err";

/** Board toolbar link button label from flash flags. */
export function boardLinkButtonLabel(
  copied: boolean,
  failed = false,
): string {
  if (copied) return "Copied";
  if (failed) return "Failed";
  return "Link";
}

/** Tooltip for the board share-link control. */
export function boardLinkTitle(): string {
  return "Copy link to this board view (l)";
}

/** Accessible name for the board share-link control (includes flash state). */
export function boardLinkAriaLabel(
  copied: boolean,
  failed = false,
): string {
  if (copied) return "Board link copied";
  if (failed) return "Failed to copy board link";
  return "Copy link to this board view";
}

/** Expanded-row player link button label. */
export function playerLinkButtonLabel(
  copied: boolean,
  failed = false,
): string {
  if (copied) return "Link copied";
  if (failed) return "Copy failed";
  return "Copy player link";
}

/** Accessible name for the per-player copy-link control. */
export function playerLinkAriaLabel(
  playerName: string,
  copied: boolean,
  failed = false,
): string {
  if (copied) return `Link copied for ${playerName}`;
  if (failed) return `Copy failed for ${playerName}`;
  return `Copy link for ${playerName}`;
}

/** Tooltip for the per-player copy-link control. */
export function playerLinkTitle(): string {
  return "Copy player link (p)";
}

/** Copy text and briefly report ok/err, then return to idle. */
export function copyTextWithFlash(
  text: string,
  onStatus: (status: CopyFlash) => void,
  holdMs = 1600,
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  void copyText(text).then((ok) => {
    if (cancelled) return;
    onStatus(ok ? "ok" : "err");
    timer = globalThis.setTimeout(() => {
      if (!cancelled) onStatus("idle");
    }, holdMs);
  });
  return () => {
    cancelled = true;
    if (timer != null) globalThis.clearTimeout(timer);
  };
}
