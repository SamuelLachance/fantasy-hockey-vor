"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/** Quiet time before the result count is announced (typing a name, several clicks). */
const ANNOUNCE_DELAY_MS = 600;

/**
 * The table's one polite live region. Screen readers hear the result count
 * after the user's own changes only (`bump`), once they pause: never for
 * the 90 s draft polling or the load itself.
 */
export function useCountAnnouncer(counter: string, ready: boolean): { bump: () => void; region: ReactNode } {
  const [seq, setSeq] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const announced = useRef(0);
  const bump = useCallback(() => setSeq((n) => n + 1), []);

  useEffect(() => {
    if (seq === announced.current || !ready) return;
    const id = window.setTimeout(() => {
      announced.current = seq;
      // Same words again: a trailing space makes screen readers repeat them.
      setAnnouncement((prev) => (prev === counter ? `${counter} ` : counter));
    }, ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [seq, counter, ready]);

  return {
    bump,
    region: (
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    ),
  };
}
