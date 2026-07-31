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

/** Copy text and briefly report ok/err, then return to idle. */
export function copyTextWithFlash(
  text: string,
  onStatus: (status: CopyFlash) => void,
  holdMs = 1600,
): void {
  void copyText(text).then((ok) => {
    onStatus(ok ? "ok" : "err");
    globalThis.setTimeout(() => onStatus("idle"), holdMs);
  });
}
