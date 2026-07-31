/** Run work when the browser is idle (setTimeout fallback). */
export function scheduleIdle(cb: () => void, timeoutMs = 200): () => void {
  const ric =
    typeof window !== "undefined" && window.requestIdleCallback
      ? window.requestIdleCallback.bind(window)
      : null;
  if (ric) {
    const id = ric(() => cb());
    return () => {
      window.cancelIdleCallback?.(id);
    };
  }
  const id = globalThis.setTimeout(cb, timeoutMs);
  return () => globalThis.clearTimeout(id);
}
