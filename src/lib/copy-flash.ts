import { copyText } from "@/lib/clipboard";

export type CopyFlash = "idle" | "ok" | "err";

/** Copy text and briefly report ok/err, then return to idle. */
export function copyTextWithFlash(
  text: string,
  onStatus: (status: CopyFlash) => void,
  holdMs = 1600,
): void {
  void copyText(text).then((ok) => {
    onStatus(ok ? "ok" : "err");
    window.setTimeout(() => onStatus("idle"), holdMs);
  });
}
