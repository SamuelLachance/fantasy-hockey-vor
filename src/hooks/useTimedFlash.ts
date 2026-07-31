"use client";

import { useEffect, useRef, useState } from "react";

/** Brief non-idle label flash that auto-resets (export/copy feedback). */
export function useTimedFlash<T extends string>(
  idle: T,
  holdMs = 1400,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(idle);
  const timer = useRef<number | null>(null);
  const remainingRef = useRef(0);
  const startedAtRef = useRef(0);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (valueRef.current === idle) return;
      if (document.visibilityState === "hidden") {
        if (timer.current != null) {
          window.clearTimeout(timer.current);
          timer.current = null;
          remainingRef.current = Math.max(
            0,
            remainingRef.current - (Date.now() - startedAtRef.current),
          );
        }
        return;
      }
      if (remainingRef.current <= 0) {
        setValue(idle);
        return;
      }
      startedAtRef.current = Date.now();
      timer.current = window.setTimeout(() => {
        setValue(idle);
        timer.current = null;
        remainingRef.current = 0;
      }, remainingRef.current);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [idle]);

  function flash(next: T) {
    if (timer.current != null) window.clearTimeout(timer.current);
    setValue(next);
    if (next === idle) {
      timer.current = null;
      remainingRef.current = 0;
      return;
    }
    remainingRef.current = holdMs;
    startedAtRef.current = Date.now();
    if (document.visibilityState === "hidden") {
      timer.current = null;
      return;
    }
    timer.current = window.setTimeout(() => {
      setValue(idle);
      timer.current = null;
      remainingRef.current = 0;
    }, holdMs);
  }

  return [value, flash];
}
