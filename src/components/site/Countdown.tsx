"use client";

import { useEffect, useState } from "react";
import { fmtCountdown } from "@/lib/fantrax/league-copy";

const TICK_MS = 30_000;

/**
 * « dans 2 j 5 h » until `iso`, updated every 30 s. "Now" only exists in
 * effects (React purity): the prerendered HTML carries nothing, so it
 * never disagrees with the browser.
 */
export function Countdown({
  iso,
  pastLabel = "passé",
  endIso,
  endLabel,
}: {
  iso: string;
  pastLabel?: string;
  /** After this instant, `endLabel` replaces `pastLabel` (« commencé », then « terminé »). */
  endIso?: string;
  endLabel?: string;
}) {
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, TICK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);
  const target = Date.parse(iso);
  if (nowMs === null || !Number.isFinite(target)) return null;
  const end = endIso ? Date.parse(endIso) : Number.NaN;
  const text =
    target > nowMs
      ? fmtCountdown(target, nowMs)
      : endLabel && Number.isFinite(end) && end <= nowMs
        ? endLabel
        : pastLabel;
  return <span className="tabular-nums">({text})</span>;
}
