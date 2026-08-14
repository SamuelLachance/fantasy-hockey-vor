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

/** Accessible name — stable identity; flash is announced via live copy. */
export function boardLinkAriaLabel(): string {
  return "Copy link to this board view";
}

/** Polite live copy after a board-link copy attempt (empty while idle). */
export function boardLinkLiveCopy(copied: boolean, failed = false): string {
  if (copied) return "Copy link to this board view (copied)";
  if (failed) return "Copy link to this board view (failed)";
  return "";
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

/** Accessible name — stable identity; flash is announced via live copy. */
export function playerLinkAriaLabel(playerName: string): string {
  return `Copy link for ${playerName}`;
}

/** Polite live copy after a player-link copy attempt (empty while idle). */
export function playerLinkLiveCopy(
  playerName: string,
  copied: boolean,
  failed = false,
): string {
  if (copied) return `Copy link for ${playerName} (copied)`;
  if (failed) return `Copy link for ${playerName} (failed)`;
  return "";
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
  let remaining = 0;
  let startedAt = 0;
  let flashing = false;

  const clearTimer = () => {
    if (timer != null) {
      globalThis.clearTimeout(timer);
      timer = null;
    }
  };

  const armIdle = (ms: number) => {
    remaining = ms;
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      return;
    }
    startedAt = Date.now();
    timer = globalThis.setTimeout(() => {
      timer = null;
      remaining = 0;
      flashing = false;
      if (!cancelled) onStatus("idle");
    }, ms);
  };

  const onVis = () => {
    if (cancelled || !flashing) return;
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") {
      if (timer != null) {
        clearTimer();
        remaining = Math.max(0, remaining - (Date.now() - startedAt));
      }
      return;
    }
    if (remaining <= 0) {
      flashing = false;
      onStatus("idle");
      return;
    }
    armIdle(remaining);
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVis);
  }

  void copyText(text).then((ok) => {
    if (cancelled) return;
    flashing = true;
    onStatus(ok ? "ok" : "err");
    armIdle(holdMs);
  });
  return () => {
    cancelled = true;
    flashing = false;
    clearTimer();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVis);
    }
  };
}
