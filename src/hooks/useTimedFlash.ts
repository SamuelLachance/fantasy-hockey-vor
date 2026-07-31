"use client";

import { useEffect, useRef, useState } from "react";

/** Brief non-idle label flash that auto-resets (export/copy feedback). */
export function useTimedFlash<T extends string>(
  idle: T,
  holdMs = 1400,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(idle);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, []);

  function flash(next: T) {
    if (timer.current != null) window.clearTimeout(timer.current);
    setValue(next);
    if (next === idle) {
      timer.current = null;
      return;
    }
    timer.current = window.setTimeout(() => {
      setValue(idle);
      timer.current = null;
    }, holdMs);
  }

  return [value, flash];
}
