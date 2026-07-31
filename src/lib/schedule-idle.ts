/** True when the user has asked the browser to reduce data use. */
export function prefersSaveData(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  return Boolean(conn?.saveData);
}

/** Run work when the browser is idle (setTimeout fallback). */
export function scheduleIdle(cb: () => void, timeoutMs = 200): () => void {
  let cancelled = false;
  let dispose: (() => void) | null = null;

  const arm = () => {
    if (cancelled) return;
    // Prefetch/idle work can wait until the tab is foreground again.
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      const onVis = () => {
        if (document.visibilityState !== "visible") return;
        document.removeEventListener("visibilitychange", onVis);
        dispose = null;
        arm();
      };
      document.addEventListener("visibilitychange", onVis);
      dispose = () => document.removeEventListener("visibilitychange", onVis);
      return;
    }

    const ric =
      typeof window !== "undefined" && window.requestIdleCallback
        ? window.requestIdleCallback.bind(window)
        : null;
    if (ric) {
      const id = ric(() => {
        if (!cancelled) cb();
      }, { timeout: timeoutMs });
      dispose = () => {
        window.cancelIdleCallback?.(id);
      };
      return;
    }
    const id = globalThis.setTimeout(() => {
      if (!cancelled) cb();
    }, timeoutMs);
    dispose = () => globalThis.clearTimeout(id);
  };

  arm();
  return () => {
    cancelled = true;
    dispose?.();
    dispose = null;
  };
}
